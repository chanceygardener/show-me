// Package conformance drives a real editor through the real CLI and checks
// the agent-facing contract in protocol/PROTOCOL.md: stdout, stderr and exit
// codes. Every editor show-me supports must pass it.
package conformance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
	"github.com/chanceygardener/show-me/internal/transport"
)

var (
	repoRoot, cliPath string
	// drivers holds every editor the suite knows; each driver file registers itself.
	drivers = map[string]driver{}
	// enabled holds the drivers this run tests, in SHOW_ME_CONFORMANCE_EDITORS order.
	enabled []driver
)

// driver knows how to run one kind of editor for the suite.
type driver struct {
	name     string
	openHint string
	prepare  func() error // finds what the editor needs; an error skips it locally and fails in CI
	start    func(w *world, dir string) *editor
}

// editor is one running editor, as its registry entry describes it.
type editor struct {
	entry protocol.Entry
	focus func() // as if the user switched to this editor
	kill  func() // the editor and every process it started
}

func (e *editor) pid() int { return e.entry.PID }

func TestMain(m *testing.M) {
	root, err := filepath.Abs("../..")
	if err != nil {
		panic(err)
	}
	repoRoot = root
	names := os.Getenv("SHOW_ME_CONFORMANCE_EDITORS")
	if names == "" {
		names = "nvim"
	}
	for _, name := range strings.Split(names, ",") {
		d, ok := drivers[name]
		if !ok {
			fmt.Printf("conformance: unknown editor %q\n", name)
			os.Exit(1)
		}
		if err := d.prepare(); err != nil {
			if os.Getenv("CI") != "" {
				fmt.Printf("conformance: %s: %v; CI must provide it\n", name, err)
				os.Exit(1)
			}
			fmt.Printf("conformance: skipping %s: %v\n", name, err)
			continue
		}
		enabled = append(enabled, d)
	}
	if len(enabled) == 0 {
		os.Exit(0)
	}
	bin, err := os.MkdirTemp("", "show-me-cli")
	if err != nil {
		panic(err)
	}
	cliPath = filepath.Join(bin, "show-me")
	if runtime.GOOS == "windows" {
		cliPath += ".exe"
	}
	build := exec.Command("go", "build", "-o", cliPath, "./cmd/show-me")
	build.Dir, build.Stdout, build.Stderr = root, os.Stderr, os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "conformance: building the CLI:", err)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(bin)
	os.Exit(code)
}

// eachEditor runs test once per enabled editor, each in a fresh world.
func eachEditor(t *testing.T, test func(t *testing.T, w *world, d driver)) {
	for _, d := range enabled {
		t.Run(d.name, func(t *testing.T) { test(t, newWorld(t), d) })
	}
}

// world is one isolated show-me home plus a workspace with two text files.
type world struct {
	t               *testing.T
	home, workspace string
	claimed         []string
}

// tempDir is a fresh, symlink-resolved directory (macOS's /var is a link).
func tempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// shortTempDir is tempDir under the system temp root, short enough for a Unix
// socket path inside it (macOS caps them at 104 bytes; t.TempDir() is longer).
func shortTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "sm")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if dir, err = filepath.EvalSymlinks(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

func newWorld(t *testing.T) *world {
	w := &world{t: t, home: shortTempDir(t), workspace: tempDir(t)}
	w.write(w.workspace, "a.txt", 5)
	w.write(w.workspace, "b.txt", 3)
	return w
}

// awaitEntry waits for a new registry entry whose file name starts with prefix.
func (w *world) awaitEntry(prefix string, timeout time.Duration) protocol.Entry {
	w.t.Helper()
	dir := filepath.Join(w.home, "editors")
	for deadline := time.Now().Add(timeout); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		files, _ := filepath.Glob(filepath.Join(dir, prefix+"*.json"))
		for _, file := range files {
			if slices.Contains(w.claimed, file) {
				continue
			}
			data, err := os.ReadFile(file)
			var e protocol.Entry
			if err == nil && json.Unmarshal(data, &e) == nil {
				w.claimed = append(w.claimed, file)
				return e
			}
		}
	}
	w.t.Fatalf("no %s* entry appeared in %s within %s", prefix, dir, timeout)
	return protocol.Entry{}
}

// status asks an editor directly, bypassing the CLI's choice of editor.
func (w *world) status(e *editor) protocol.StatusResult {
	w.t.Helper()
	reply, err := transport.Send(e.entry.Transport, protocol.Request{Protocol: protocol.Version, Command: protocol.CommandStatus})
	if err != nil || !reply.OK {
		w.t.Fatalf("status of pid %d: %v %+v", e.pid(), err, reply)
	}
	var result protocol.StatusResult
	if err := json.Unmarshal(reply.Result, &result); err != nil {
		w.t.Fatal(err)
	}
	return result
}

// awaitGone waits until the CLI no longer lists e, i.e. its process has exited.
func (w *world) awaitGone(e *editor) {
	w.t.Helper()
	mark := fmt.Sprintf("pid %d ", e.pid())
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if out, _, _ := w.cli(w.workspace, "editors"); !strings.Contains(out, mark) {
			return
		}
	}
	w.t.Fatalf("pid %d is still registered after being killed", e.pid())
}

func (w *world) write(dir, name string, lines int) {
	w.t.Helper()
	body := strings.Repeat("line\n", lines)
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

// cli runs the CLI in dir and returns its stdout, stderr and exit code.
func (w *world) cli(dir string, args ...string) (string, string, int) {
	w.t.Helper()
	cmd := exec.Command(cliPath, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "SHOW_ME_HOME="+w.home)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case errors.As(err, &exit):
		return out.String(), errOut.String(), exit.ExitCode()
	case err != nil:
		w.t.Fatal(err)
	}
	return out.String(), errOut.String(), 0
}

// expect runs the CLI and fails unless the exit code and stdout match.
func (w *world) expect(dir string, code int, stdout string, args ...string) string {
	w.t.Helper()
	out, errOut, got := w.cli(dir, args...)
	if got != code || (stdout != "*" && out != stdout) {
		w.t.Fatalf("show-me %v: exit %d (want %d)\nstdout %q (want %q)\nstderr %q", args, got, code, out, stdout, errOut)
	}
	return errOut
}

func TestSession(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		e := d.start(w, w.workspace)
		h := fmt.Sprintf("1@%d", e.pid())
		w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "How it works")
		w.expect(w.workspace, 0, "view 1\n", "view", h, "cols2", "a.txt:1-2", "b.txt")
		w.expect(w.workspace, 0, "view 2\n", "view", h, "single", "--title", "Only a", "a.txt:5")
		w.expect(w.workspace, 0, "done "+h+"\nopen: "+d.openHint+"\n", "done", h)
		out, _, _ := w.cli(w.workspace, "status")
		if !strings.Contains(out, fmt.Sprintf(`current: deck %s "How it works" (2 views)`, h)) {
			t.Fatalf("status: %q", out)
		}
	})
}

func TestRejections(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		e := d.start(w, w.workspace)
		at := func(n int) string { return fmt.Sprintf("%d@%d", n, e.pid()) }
		cases := []struct {
			args []string
			want string
		}{
			{[]string{"view", "99", "single", "a.txt"}, "show-me: unknown deck 99\n"},
			{[]string{"view", "1", "grid", "a.txt"}, "show-me: unknown layout \"grid\" (valid: single, cols2, cols3, main-stack)\n"},
			{[]string{"view", "1", "single", "a.txt:4-9"}, fmt.Sprintf("show-me: range 4-9 is past the end of %s (5 lines)\n", filepath.Join(w.workspace, "a.txt"))},
		}
		w.expect(w.workspace, 0, "deck "+at(1)+"\n", "deck", "One")
		for _, c := range cases {
			if got := w.expect(w.workspace, 1, "", c.args...); got != c.want {
				t.Errorf("%v: stderr %q, want %q", c.args, got, c.want)
			}
		}
		if got := w.expect(w.workspace, 1, "", "done", at(1)); got != "show-me: deck 1 has no views\n" {
			t.Errorf("empty done: %q", got)
		}
		w.expect(w.workspace, 0, "view 1\n", "view", at(1), "single", "a.txt")
		w.expect(w.workspace, 0, "*", "done", at(1))
		if got := w.expect(w.workspace, 1, "", "view", at(1), "single", "a.txt"); got != "show-me: deck 1 is already done; start a new one\n" {
			t.Errorf("view after done: %q", got)
		}
		w.expect(w.workspace, 0, "deck "+at(2)+"\n", "deck", "Full")
		for i := 1; i <= 9; i++ {
			w.expect(w.workspace, 0, fmt.Sprintf("view %d\n", i), "view", at(2), "single", "a.txt")
		}
		if got := w.expect(w.workspace, 1, "", "view", at(2), "single", "a.txt"); got != "show-me: deck 2 already has 9 views, the most an editor can open by number\n" {
			t.Errorf("tenth view: %q", got)
		}
	})
}

func TestWorktreeReachesMainCheckout(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		wt := filepath.Join(tempDir(t), "wt")
		git := func(args ...string) {
			full := append([]string{"-C", w.workspace, "-c", "user.name=t", "-c", "user.email=t@example.com"}, args...)
			if out, err := exec.Command("git", full...).CombinedOutput(); err != nil {
				t.Fatalf("git %v: %v\n%s", args, err, out)
			}
		}
		git("init", "-q")
		git("add", ".")
		git("commit", "-q", "-m", "init")
		git("worktree", "add", "-q", wt)
		e := d.start(w, w.workspace)
		w.expect(wt, 0, fmt.Sprintf("deck 1@%d\n", e.pid()), "deck", "From a worktree")
		w.expect(wt, 0, "view 1\n", "view", fmt.Sprintf("1@%d", e.pid()), "single", "a.txt:2")
	})
}

func TestConcurrentViews(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		e := d.start(w, w.workspace)
		h := fmt.Sprintf("1@%d", e.pid())
		w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "Busy")
		var mu sync.Mutex
		var got []string
		var wg sync.WaitGroup
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				out, errOut, code := w.cli(w.workspace, "view", h, "single", "a.txt")
				mu.Lock()
				defer mu.Unlock()
				if code != 0 {
					t.Errorf("exit %d: %s", code, errOut)
				}
				got = append(got, strings.TrimSpace(out))
			}()
		}
		wg.Wait()
		sort.Strings(got)
		if want := "view 1,view 2,view 3,view 4,view 5,view 6"; strings.Join(got, ",") != want {
			t.Fatalf("got %v", got)
		}
	})
}

func TestHandleSticksToItsEditor(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		owner := d.start(w, w.workspace)
		other := d.start(w, w.workspace)
		owner.focus()
		h := fmt.Sprintf("1@%d", owner.pid())
		w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "Pinned")
		other.focus()
		w.expect(w.workspace, 0, "view 1\n", "view", h, "single", "a.txt")
		w.expect(w.workspace, 0, "*", "done", h)
		if got := w.status(owner).Current; got == nil || got.Deck != 1 {
			t.Fatalf("the owner's current deck is %+v, want deck 1", got)
		}
		if got := w.status(other).Current; got != nil {
			t.Fatalf("the focused editor received the deck: %+v", got)
		}
	})
}

func TestLateSetupStillRegisters(t *testing.T) {
	if !slices.ContainsFunc(enabled, func(d driver) bool { return d.name == "nvim" }) {
		t.Skip("Neovim is not under test")
	}
	w := newWorld(t)
	e := w.startNvim(w.workspace, true)
	w.expect(w.workspace, 0, fmt.Sprintf("deck 1@%d\n", e.pid()), "deck", "Lazy")
}

func TestExitedEditor(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		e := d.start(w, w.workspace)
		e.kill()
		w.awaitGone(e)
		w.expect(w.workspace, 3, "", "deck", "Nobody home")
		entry := filepath.Join(w.home, "editors", fmt.Sprintf("%s-%d.json", e.entry.Editor, e.pid()))
		if _, err := os.Stat(entry); !os.IsNotExist(err) {
			t.Fatalf("stale entry %s was not cleaned up", entry)
		}
	})
}
