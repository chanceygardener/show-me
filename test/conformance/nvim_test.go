package conformance

import (
	"fmt"
	"os"
	"os/exec"
	"time"

	"github.com/neovim/go-client/nvim"

	"github.com/chanceygardener/show-me/internal/transport"
)

func init() {
	drivers["nvim"] = driver{
		name:     "nvim",
		openHint: "<leader>v1",
		prepare:  func() error { _, err := exec.LookPath("nvim"); return err },
		start:    func(w *world, dir string) *editor { return w.startNvim(dir, false) },
	}
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
	entry := w.awaitEntry(fmt.Sprintf("nvim-%d", cmd.Process.Pid), 20*time.Second)
	e := &editor{entry: entry}
	e.focus = func() { w.nvimEval(e, "execute('doautocmd FocusGained')") }
	e.kill = func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }
	return e
}

// nvimEval evaluates a Vimscript expression over RPC. `nvim --remote-expr` is
// not used: on Windows that client writes terminal setup sequences into its output.
func (w *world) nvimEval(e *editor, expr string) string {
	w.t.Helper()
	conn, err := transport.Dial(e.entry.Transport.Address, transport.DialTimeout)
	if err != nil {
		w.t.Fatalf("dial %s: %v", e.entry.Transport.Address, err)
	}
	defer conn.Close()
	client, err := nvim.New(conn, conn, conn, func(string, ...any) {})
	if err != nil {
		w.t.Fatalf("rpc %s: %v", e.entry.Transport.Address, err)
	}
	go func() { _ = client.Serve() }()
	var result any
	if err := client.Eval(expr, &result); err != nil {
		w.t.Fatalf("eval %s: %v", expr, err)
	}
	return fmt.Sprint(result)
}
