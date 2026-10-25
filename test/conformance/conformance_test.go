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
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

var repoRoot, cliPath string

func TestMain(m *testing.M) {
	if _, err := exec.LookPath("nvim"); err != nil {
		if os.Getenv("CI") != "" {
			fmt.Println("conformance: nvim not on PATH; CI must install it")
			os.Exit(1)
		}
		fmt.Println("conformance: nvim not on PATH; skipping")
		os.Exit(0)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		panic(err)
	}
	repoRoot = root
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

// world is one isolated show-me home plus a workspace with two text files.
type world struct {
	t               *testing.T
	home, workspace string
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

func newWorld(t *testing.T) *world {
	w := &world{t: t, home: tempDir(t), workspace: tempDir(t)}
	w.write(w.workspace, "a.txt", 5)
	w.write(w.workspace, "b.txt", 3)
	return w
}

func (w *world) write(dir, name string, lines int) {
	w.t.Helper()
	body := strings.Repeat("line\n", lines)
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

type editor struct {
	pid     int
	address string
	cmd     *exec.Cmd
}

// startNvim runs headless Neovim in dir with the plugin from this checkout.
// lateSetup calls setup() only after VimEnter, as `event = 'VeryLazy'` does.
// Each editor gets its own deck directory, so a test can tell which editor
// a request reached (same-folder editors otherwise share one by design).
func (w *world) startNvim(dir string, lateSetup bool) *editor {
	w.t.Helper()
	decks, err := os.MkdirTemp(w.home, "decks")
	if err != nil {
		w.t.Fatal(err)
	}
	setup := fmt.Sprintf("require('show_me').setup({ state_dir = [[%s]] })", decks)
	command := "lua " + setup
	if lateSetup {
		command = fmt.Sprintf("autocmd VimEnter * ++once lua vim.schedule(function() %s end)", setup)
	}
	cmd := exec.Command("nvim", "--clean", "--headless",
		"--cmd", fmt.Sprintf("lua vim.opt.rtp:prepend([[%s]])", repoRoot), "-c", command)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "SHOW_ME_HOME="+w.home)
	if err := cmd.Start(); err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })

	file := filepath.Join(w.home, "editors", fmt.Sprintf("nvim-%d.json", cmd.Process.Pid))
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var e protocol.Entry
		if json.Unmarshal(data, &e) == nil {
			return &editor{pid: e.PID, address: e.Transport.Address, cmd: cmd}
		}
	}
	w.t.Fatalf("nvim pid %d never registered at %s", cmd.Process.Pid, file)
	return nil
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

// remote evaluates a Vimscript expression in a running editor.
func (w *world) remote(e *editor, expr string) string {
	w.t.Helper()
	out, err := exec.Command("nvim", "--server", e.address, "--remote-expr", expr).CombinedOutput()
	if err != nil {
		w.t.Fatalf("--remote-expr %s: %v\n%s", expr, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestSession(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	h := fmt.Sprintf("1@%d", e.pid)
	w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "How it works")
	w.expect(w.workspace, 0, "view 1\n", "view", h, "cols2", "a.txt:1-2", "b.txt")
	w.expect(w.workspace, 0, "view 2\n", "view", h, "single", "--title", "Only a", "a.txt:5")
	w.expect(w.workspace, 0, "done "+h+"\nopen: <leader>v1\n", "done", h)
	out, _, _ := w.cli(w.workspace, "status")
	if !strings.Contains(out, fmt.Sprintf(`current: deck %s "How it works" (2 views)`, h)) {
		t.Fatalf("status: %q", out)
	}
}

func TestRejections(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	at := func(n int) string { return fmt.Sprintf("%d@%d", n, e.pid) }
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
}

func TestWorktreeReachesMainCheckout(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	w := newWorld(t)
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
	e := w.startNvim(w.workspace, false)
	w.expect(wt, 0, fmt.Sprintf("deck 1@%d\n", e.pid), "deck", "From a worktree")
	w.expect(wt, 0, "view 1\n", "view", fmt.Sprintf("1@%d", e.pid), "single", "a.txt:2")
}

func TestConcurrentViews(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	h := fmt.Sprintf("1@%d", e.pid)
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
}

func TestHandleSticksToItsEditor(t *testing.T) {
	w := newWorld(t)
	owner := w.startNvim(w.workspace, false)
	other := w.startNvim(w.workspace, false)
	w.remote(owner, "execute('doautocmd FocusGained')")
	h := fmt.Sprintf("1@%d", owner.pid)
	w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "Pinned")
	w.remote(other, "execute('doautocmd FocusGained')")
	w.expect(w.workspace, 0, "view 1\n", "view", h, "single", "a.txt")
	w.expect(w.workspace, 0, "*", "done", h)
	if got := w.remote(owner, `luaeval("require('show_me.state').current().id")`); got != "1" {
		t.Fatalf("the owner's current deck is %q, want 1", got)
	}
	if got := w.remote(other, `luaeval("require('show_me.state').current() == nil")`); got != "true" {
		t.Fatalf("the focused editor received the deck: %q", got)
	}
}

func TestLateSetupStillRegisters(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, true)
	w.expect(w.workspace, 0, fmt.Sprintf("deck 1@%d\n", e.pid), "deck", "Lazy")
}

func TestExitedEditor(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	_ = e.cmd.Process.Kill()
	_ = e.cmd.Wait()
	w.expect(w.workspace, 3, "", "deck", "Nobody home")
	entry := filepath.Join(w.home, "editors", fmt.Sprintf("nvim-%d.json", e.pid))
	if _, err := os.Stat(entry); !os.IsNotExist(err) {
		t.Fatalf("stale entry %s was not cleaned up", entry)
	}
}
