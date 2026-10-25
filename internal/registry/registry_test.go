package registry

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chanceygardener/show-me/internal/protocol"
)

func writeEntry(t *testing.T, dir, name string, e protocol.Entry) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, name)
	if err := os.WriteFile(file, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

// deadPID returns the pid of a process that has already exited.
func deadPID(t *testing.T) int {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	return cmd.Process.Pid
}

func names(cs []Candidate) string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.File
	}
	return strings.Join(out, ",")
}

func TestBaseDir(t *testing.T) {
	t.Setenv("SHOW_ME_HOME", "/custom")
	if got, _ := BaseDir(); got != "/custom" {
		t.Fatalf("SHOW_ME_HOME: got %s", got)
	}
	t.Setenv("SHOW_ME_HOME", "")
	if runtime.GOOS == "windows" {
		t.Setenv("LOCALAPPDATA", `C:\Users\me\AppData\Local`)
		if got, _ := BaseDir(); got != `C:\Users\me\AppData\Local\show-me` {
			t.Fatalf("LOCALAPPDATA: got %s", got)
		}
		return
	}
	t.Setenv("XDG_STATE_HOME", "/xdg")
	if got, _ := BaseDir(); got != "/xdg/show-me" {
		t.Fatalf("XDG_STATE_HOME: got %s", got)
	}
	t.Setenv("XDG_STATE_HOME", "")
	t.Setenv("HOME", "/home/me")
	if got, _ := BaseDir(); got != "/home/me/.local/state/show-me" {
		t.Fatalf("default: got %s", got)
	}
}

func TestRead(t *testing.T) {
	dir := t.TempDir()
	live := writeEntry(t, dir, "nvim-1.json", protocol.Entry{Protocol: 1, Editor: "nvim", PID: os.Getpid()})
	dead := writeEntry(t, dir, "nvim-2.json", protocol.Entry{Protocol: 1, Editor: "nvim", PID: deadPID(t)})
	broken := filepath.Join(dir, "broken.json")
	if err := os.WriteFile(broken, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nvim-1.json.tmp"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if names(got) != live {
		t.Fatalf("got %s, want only %s", names(got), live)
	}
	if _, err := os.Stat(dead); !os.IsNotExist(err) {
		t.Errorf("entry of an exited editor was not deleted")
	}
	if _, err := os.Stat(broken); err != nil {
		t.Errorf("unparseable entry should be skipped, not deleted")
	}
	if got, err := Read(filepath.Join(dir, "missing")); got != nil || err != nil {
		t.Errorf("missing registry: got %v, %v", got, err)
	}
}

func TestRank(t *testing.T) {
	root := t.TempDir()
	repos := filepath.Join(root, "repos")
	foo := filepath.Join(repos, "foo")
	other := filepath.Join(root, "other")
	cand := func(name, folder string, focused int64, proto int) Candidate {
		return Candidate{File: name, Entry: protocol.Entry{Protocol: proto, WorkspaceFolders: []string{folder}, FocusedAt: focused}}
	}
	all := []Candidate{cand("A", repos, 9, 1), cand("B", foo, 1, 1), cand("C", foo, 5, 1), cand("D", other, 9, 1), cand("E", foo, 9, 2)}

	ranked, incompatible := Rank(all, []string{filepath.Join(foo, "src")})
	if names(ranked) != "C,B,A" || names(incompatible) != "E" {
		t.Fatalf("deepest folder, then focus: got %s / %s", names(ranked), names(incompatible))
	}
	if ranked, _ := Rank([]Candidate{cand("F", filepath.Join(root, "rep"), 1, 1)}, []string{repos}); len(ranked) != 0 {
		t.Errorf("a folder must contain the target at a path boundary, got %s", names(ranked))
	}
	if ranked, _ := Rank(all, []string{filepath.Join(root, "elsewhere"), other}); names(ranked) != "D" {
		t.Errorf("falls back to the second target: got %s", names(ranked))
	}
	if ranked, _ := Rank(all, []string{other, repos}); names(ranked) != "D" {
		t.Errorf("the first matching target wins: got %s", names(ranked))
	}
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		if ranked, _ := Rank(all, []string{strings.ToUpper(foo)}); names(ranked) != "C,B,A" {
			t.Errorf("case-insensitive on %s: got %s", runtime.GOOS, names(ranked))
		}
	}
}

func TestByPID(t *testing.T) {
	r := Ranking{All: []Candidate{{File: "x", Entry: protocol.Entry{PID: 42}}}}
	if c, ok := r.ByPID(42); !ok || c.File != "x" {
		t.Fatalf("ByPID(42) = %+v, %v", c, ok)
	}
	if _, ok := r.ByPID(7); ok {
		t.Fatal("ByPID(7) found something")
	}
}

func TestTargets(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	root := canonical(t.TempDir())
	repo, wt := filepath.Join(root, "repo"), filepath.Join(root, "wt")
	git := func(dir string, args ...string) {
		t.Helper()
		full := append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com"}, args...)
		if out, err := exec.Command("git", full...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.MkdirAll(filepath.Join(repo, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	git(repo, "init", "-q")
	git(repo, "commit", "-q", "--allow-empty", "-m", "init")
	git(repo, "worktree", "add", "-q", wt)
	plain := filepath.Join(root, "plain")
	if err := os.Mkdir(plain, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := map[string][]string{
		wt:                         {canonical(wt), canonical(repo)},
		filepath.Join(repo, "sub"): {canonical(filepath.Join(repo, "sub")), canonical(repo)},
		repo:                       {canonical(repo)},
		plain:                      {canonical(plain)},
	}
	for cwd, want := range cases {
		if got := Targets(cwd); strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("Targets(%s) = %v, want %v", cwd, got, want)
		}
	}
}
