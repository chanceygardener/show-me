//go:build !windows

package transport

import (
	"errors"
	"syscall"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

func TestSendSuspendedEditor(t *testing.T) {
	addr, cmd := startNvim(t)
	old := RequestTimeout
	RequestTimeout = 500 * time.Millisecond
	t.Cleanup(func() { RequestTimeout = old })
	if err := cmd.Process.Signal(syscall.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Signal(syscall.SIGCONT) })

	start := time.Now()
	_, err := Send(protocol.Transport{Kind: protocol.TransportNvim, Address: addr}, protocol.Request{Protocol: 1, Command: "status"})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("a suspended editor held the CLI for %s", elapsed)
	}
}
