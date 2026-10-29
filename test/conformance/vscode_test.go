package conformance

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/transport"
)

// vscodeExe is the VS Code build under test, found by prepareVSCode.
var vscodeExe string

func init() {
	drivers["vscode"] = driver{
		name:     "vscode",
		openHint: "ctrl+alt+v 1",
		prepare:  prepareVSCode,
		start:    func(w *world, dir string) *editor { return w.startVSCode(dir) },
	}
}

// prepareVSCode checks the extension is built and downloads VS Code once.
func prepareVSCode() error {
	ext := filepath.Join(repoRoot, "vscode")
	if _, err := os.Stat(filepath.Join(ext, "dist", "extension.cjs")); err != nil {
		return fmt.Errorf("the extension isn't built (cd vscode && npm run build): %w", err)
	}
	out, err := os.CreateTemp("", "vscode-path")
	if err != nil {
		return err
	}
	_ = out.Close()
	defer os.Remove(out.Name())
	locate := exec.Command("node", filepath.Join("test", "conformance", "vscode-path.mjs"), out.Name())
	locate.Dir, locate.Stdout, locate.Stderr = ext, os.Stderr, os.Stderr
	if err := locate.Run(); err != nil {
		return fmt.Errorf("downloading VS Code: %w", err)
	}
	data, err := os.ReadFile(out.Name())
	vscodeExe = strings.TrimSpace(string(data))
	return err
}

// startVSCode opens dir in a fresh VS Code instance (its own user-data dir,
// so it can't attach to another) with show-me and the test harness loaded.
func (w *world) startVSCode(dir string) *editor {
	w.t.Helper()
	data := shortTempDir(w.t) // VS Code puts an IPC socket in its user-data dir
	harness := harnessAddress(w.t)
	ext := filepath.Join(repoRoot, "vscode")
	args := []string{dir,
		"--extensionDevelopmentPath=" + ext,
		"--extensionDevelopmentPath=" + filepath.Join(ext, "test", "harness"),
		"--user-data-dir=" + filepath.Join(data, "u"),
		"--extensions-dir=" + filepath.Join(data, "x"),
		"--disable-extensions", "--disable-workspace-trust", "--disable-gpu",
		"--skip-welcome", "--skip-release-notes", "--new-window",
	}
	if runtime.GOOS == "linux" {
		args = append(args, "--no-sandbox")
	}
	cmd := exec.Command(vscodeExe, args...)
	cmd.Env = append(vscodeEnv(), "SHOW_ME_HOME="+w.home, "SHOW_ME_HARNESS="+harness)
	isolate(cmd)
	if err := cmd.Start(); err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() { killTree(cmd) })
	entry := w.awaitEntry("vscode-", 120*time.Second)
	return &editor{
		entry: entry,
		focus: func() { w.harnessCall(harness, "touch") },
		kill:  func() { killTree(cmd) },
	}
}

// vscodeEnv is this process's environment without the variables that make
// VS Code hand its arguments to an already-running instance (as it does when
// the tests run from VS Code's own terminal).
func vscodeEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "VSCODE_") && !strings.HasPrefix(kv, "ELECTRON_RUN_AS_NODE=") {
			env = append(env, kv)
		}
	}
	return env
}

func harnessAddress(t *testing.T) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`\\.\pipe\show-me-harness-%d-%d`, os.Getpid(), time.Now().UnixNano())
	}
	return filepath.Join(shortTempDir(t), "h.sock")
}

// harnessCall asks the harness extension to run call, waiting for it to listen.
func (w *world) harnessCall(address, call string) {
	w.t.Helper()
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		conn, err := transport.Dial(address, transport.DialTimeout)
		if err != nil {
			continue
		}
		_, _ = fmt.Fprintf(conn, `{"call":%q}`+"\n", call)
		reply, err := bufio.NewReader(conn).ReadString('\n')
		_ = conn.Close()
		if err == nil && strings.Contains(reply, `"ok":true`) {
			return
		}
		w.t.Fatalf("harness %s: %q %v", call, reply, err)
	}
	w.t.Fatalf("the harness never listened on %s", address)
}
