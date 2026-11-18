package transport

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// serveNDJSON is a fake NDJSON editor. handle answers each request line; an
// empty answer means "say nothing", like a suspended editor.
func serveNDJSON(t *testing.T, handle func(line []byte) string) string {
	t.Helper()
	addr := testAddress(t)
	ln, err := listen(addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				line, err := bufio.NewReader(conn).ReadBytes('\n')
				if err != nil {
					return
				}
				if answer := handle(line); answer != "" {
					_, _ = io.WriteString(conn, answer+"\n")
					return
				}
				_, _ = io.Copy(io.Discard, conn)
			}()
		}
	}()
	return addr
}

func TestNDJSONSendsTokenAsOneLine(t *testing.T) {
	var got protocol.Request
	addr := serveNDJSON(t, func(line []byte) string {
		if strings.Count(string(line), "\n") != 1 {
			return `{"ok":false,"error":"not one line"}`
		}
		_ = json.Unmarshal(line, &got)
		return `{"ok":true,"result":{"view":2}}`
	})
	reply, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: addr, Token: "secret"},
		protocol.Request{Protocol: protocol.Version, Command: protocol.CommandView, Deck: 7})
	if err != nil {
		t.Fatal(err)
	}
	if !reply.OK || string(reply.Result) != `{"view":2}` {
		t.Fatalf("reply %+v", reply)
	}
	if got.Token != "secret" || got.Command != protocol.CommandView || got.Deck != 7 {
		t.Fatalf("the editor received %+v", got)
	}
}

func TestNDJSONNobodyListening(t *testing.T) {
	_, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: testAddress(t)}, protocol.Request{})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
}

func TestNDJSONSilentEditor(t *testing.T) {
	old := RequestTimeout
	RequestTimeout = 300 * time.Millisecond
	t.Cleanup(func() { RequestTimeout = old })
	addr := serveNDJSON(t, func([]byte) string { return "" })

	start := time.Now()
	_, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: addr}, protocol.Request{Protocol: 1, Command: "status"})
	var u *Unreachable
	if !errors.As(err, &u) || !strings.Contains(err.Error(), "no reply within") {
		t.Fatalf("want *Unreachable naming the deadline, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("a silent editor held the CLI for %s", elapsed)
	}
}

func TestNDJSONUnreadableReply(t *testing.T) {
	addr := serveNDJSON(t, func([]byte) string { return "not json" })
	_, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: addr}, protocol.Request{})
	var u *Unreachable
	if err == nil || errors.As(err, &u) {
		t.Fatalf("want a plain error, got %v", err)
	}
}
