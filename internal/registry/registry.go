// Package registry finds the running editors that can show an agent's deck.
//
// Each editor publishes one JSON file (protocol.Entry) under <base>/editors/.
// The CLI reads them all, drops editors that have exited, and ranks the rest
// by how closely their workspace folders contain the agent's directory.
package registry

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// BaseDir is show-me's home, shared with the editor plugins. SHOW_ME_HOME
// overrides it, which is how tests isolate themselves.
func BaseDir() (string, error) {
	if dir := os.Getenv("SHOW_ME_HOME"); dir != "" {
		return dir, nil
	}
	if runtime.GOOS == "windows" {
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			return "", errors.New("LOCALAPPDATA is not set")
		}
		return filepath.Join(local, "show-me"), nil
	}
	if state := os.Getenv("XDG_STATE_HOME"); state != "" {
		return filepath.Join(state, "show-me"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state", "show-me"), nil
}

// EditorsDir holds one entry file per running editor.
func EditorsDir(base string) string { return filepath.Join(base, "editors") }

// Candidate is a live editor and the file it registered in.
type Candidate struct {
	File  string
	Entry protocol.Entry
}

// Ranking is everything the CLI needs to pick an editor or explain why none fits.
type Ranking struct {
	Dir          string      // registry directory that was read
	Targets      []string    // directories the request is about, nearest first
	All          []Candidate // every live entry
	Ranked       []Candidate // compatible editors serving the first matched target, best first
	Incompatible []Candidate // editors serving that target that speak another protocol
}

// ByPID finds the live editor with this pid, for deck handles.
func (r Ranking) ByPID(pid int) (Candidate, bool) {
	for _, c := range r.All {
		if c.Entry.PID == pid {
			return c, true
		}
	}
	return Candidate{}, false
}

// Locate reads the registry and ranks the editors for an agent working in cwd.
func Locate(cwd string) (Ranking, error) {
	base, err := BaseDir()
	if err != nil {
		return Ranking{}, err
	}
	dir := EditorsDir(base)
	all, err := Read(dir)
	if err != nil {
		return Ranking{}, err
	}
	targets := Targets(cwd)
	ranked, incompatible := Rank(all, targets)
	return Ranking{Dir: dir, Targets: targets, All: all, Ranked: ranked, Incompatible: incompatible}, nil
}

// Read returns every live entry in dir. Files whose editor has exited are
// deleted; files that don't parse are skipped and left alone.
func Read(dir string) ([]Candidate, error) {
	items, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var live []Candidate
	for _, item := range items {
		if item.IsDir() || filepath.Ext(item.Name()) != ".json" {
			continue
		}
		file := filepath.Join(dir, item.Name())
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var entry protocol.Entry
		if json.Unmarshal(data, &entry) != nil {
			continue
		}
		if !alive(entry.PID) {
			_ = os.Remove(file)
			continue
		}
		live = append(live, Candidate{File: file, Entry: entry})
	}
	return live, nil
}

// Targets lists the directories an agent in cwd is asking about, nearest
// first: cwd itself, then the repository's main checkout when cwd is inside a
// linked worktree or a subdirectory.
func Targets(cwd string) []string {
	here := canonical(cwd)
	targets := []string{here}
	if root := mainCheckout(here); root != "" && fold(root) != fold(here) {
		targets = append(targets, root)
	}
	return targets
}

// mainCheckout is the parent of the repository's common git dir, or "" when
// dir isn't in a repository or git isn't installed.
func mainCheckout(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "--git-common-dir").Output()
	if err != nil {
		return ""
	}
	common := filepath.FromSlash(strings.TrimSpace(string(out)))
	if !filepath.IsAbs(common) {
		common = filepath.Join(dir, common)
	}
	return filepath.Dir(canonical(common))
}

// Rank orders the candidates serving the first target that any candidate
// serves: deepest containing folder first, then most recently focused. Those
// speaking another protocol are returned separately so the CLI can say so.
func Rank(all []Candidate, targets []string) (ranked, incompatible []Candidate) {
	type scored struct {
		c     Candidate
		depth int
	}
	for _, target := range targets {
		var matched []scored
		for _, c := range all {
			if depth := deepestContaining(c.Entry.WorkspaceFolders, target); depth >= 0 {
				matched = append(matched, scored{c, depth})
			}
		}
		if len(matched) == 0 {
			continue
		}
		sort.SliceStable(matched, func(i, j int) bool {
			if matched[i].depth != matched[j].depth {
				return matched[i].depth > matched[j].depth
			}
			return matched[i].c.Entry.FocusedAt > matched[j].c.Entry.FocusedAt
		})
		for _, m := range matched {
			if m.c.Entry.Protocol == protocol.Version {
				ranked = append(ranked, m.c)
			} else {
				incompatible = append(incompatible, m.c)
			}
		}
		return ranked, incompatible
	}
	return nil, nil
}

// deepestContaining returns the length of the longest folder containing
// target, or -1 when none does.
func deepestContaining(folders []string, target string) int {
	best := -1
	for _, folder := range folders {
		if contains(folder, target) && len(folder) > best {
			best = len(folder)
		}
	}
	return best
}

func contains(folder, target string) bool {
	folder, target = fold(filepath.Clean(folder)), fold(filepath.Clean(target))
	if folder == target {
		return true
	}
	prefix := folder
	if !strings.HasSuffix(prefix, string(filepath.Separator)) {
		prefix += string(filepath.Separator)
	}
	return strings.HasPrefix(target, prefix)
}

// fold makes path comparisons case-insensitive where the default file system is.
func fold(path string) string {
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}

// canonical is path made absolute with symlinks resolved, matching what
// editors register (Neovim uses fs_realpath).
func canonical(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	if real, err := filepath.EvalSymlinks(path); err == nil {
		path = real
	}
	return filepath.Clean(path)
}
