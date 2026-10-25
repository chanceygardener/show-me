package transport

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// testAddress is a fresh server address. Unix socket paths must stay under
// macOS's 104-byte limit, so they go in a short directory, not t.TempDir().
func testAddress(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`\\.\pipe\show-me-test-%d-%d`, os.Getpid(), time.Now().UnixNano())
	}
	dir, err := os.MkdirTemp("", "sm")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return filepath.Join(dir, "n.sock")
}

// startNvim runs headless Neovim with the fake plugin, listening on a fresh address.
func startNvim(t *testing.T) (string, *exec.Cmd) {
	t.Helper()
	if _, err := exec.LookPath("nvim"); err != nil {
		t.Skip("nvim not on PATH")
	}
	addr := testAddress(t)
	plugin, err := filepath.Abs("testdata/fakeplugin")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("nvim", "--clean", "--headless", "--listen", addr,
		"--cmd", fmt.Sprintf("lua vim.opt.rtp:prepend([[%s]])", plugin))
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if conn, err := dial(addr, time.Second); err == nil {
			_ = conn.Close()
			return addr, cmd
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("nvim never listened on %s", addr)
	return "", nil
}

func TestSendNvim(t *testing.T) {
	addr, _ := startNvim(t)
	reply, err := Send(protocol.Transport{Kind: protocol.TransportNvim, Address: addr},
		protocol.Request{Protocol: protocol.Version, Command: protocol.CommandDone, Deck: 7})
	if err != nil {
		t.Fatal(err)
	}
	var echo struct {
		Echo string `json:"echo"`
		Deck int    `json:"deck"`
	}
	if err := json.Unmarshal(reply.Result, &echo); err != nil {
		t.Fatal(err)
	}
	if !reply.OK || echo.Echo != "done" || echo.Deck != 7 {
		t.Fatalf("got %+v / %+v", reply, echo)
	}
}

func TestSendUnreachable(t *testing.T) {
	start := time.Now()
	_, err := Send(protocol.Transport{Kind: protocol.TransportNvim, Address: testAddress(t)}, protocol.Request{})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > DialTimeout+time.Second {
		t.Fatalf("took %s", elapsed)
	}
}

func TestSendUnsupportedTransport(t *testing.T) {
	_, err := Send(protocol.Transport{Kind: "ndjson", Address: "x"}, protocol.Request{})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
}
