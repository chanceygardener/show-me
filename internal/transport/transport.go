// Package transport delivers one request to one editor and returns its reply.
//
// Two transports exist. `nvim` speaks to Neovim's built-in msgpack-RPC
// server: the request JSON is passed to the plugin's rpc.handle with
// nvim_exec_lua, so nothing is quoted into Vimscript. `ndjson` writes one
// request line to a socket or named pipe and reads one reply line (VS Code).
// Any other kind is reported as unreachable, and the CLI moves on.
package transport

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/neovim/go-client/nvim"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// Deadlines. They are variables so tests can shorten them.
var (
	DialTimeout    = 2 * time.Second
	RequestTimeout = 10 * time.Second
)

// Unreachable means the editor could not be asked: it isn't listening, it
// stopped answering, or it speaks a transport this build doesn't. Trying the
// next editor is reasonable.
type Unreachable struct {
	Address string
	Err     error
}

func (u *Unreachable) Error() string { return fmt.Sprintf("%s: %v", u.Address, u.Err) }
func (u *Unreachable) Unwrap() error { return u.Err }

// nvimHandler runs inside Neovim; `...` is the request JSON.
const nvimHandler = "return require('show_me.rpc').handle(...)"

// Send delivers req to the editor behind t and returns its reply.
func Send(t protocol.Transport, req protocol.Request) (protocol.Reply, error) {
	switch t.Kind {
	case protocol.TransportNvim:
		return sendNvim(t.Address, req)
	case protocol.TransportNDJSON:
		return sendNDJSON(t, req)
	default:
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: fmt.Errorf("unsupported transport %q", t.Kind)}
	}
}

func sendNvim(address string, req protocol.Request) (protocol.Reply, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return protocol.Reply{}, err
	}
	conn, err := Dial(address, DialTimeout)
	if err != nil {
		return protocol.Reply{}, &Unreachable{Address: address, Err: err}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(RequestTimeout))

	client, err := nvim.New(conn, conn, conn, func(string, ...any) {})
	if err != nil {
		return protocol.Reply{}, &Unreachable{Address: address, Err: err}
	}
	go func() { _ = client.Serve() }()

	type answer struct {
		raw string
		err error
	}
	answered := make(chan answer, 1)
	go func() {
		var raw string
		err := client.ExecLua(nvimHandler, &raw, string(body))
		answered <- answer{raw, err}
	}()

	select {
	case a := <-answered:
		if a.err != nil {
			return protocol.Reply{}, &Unreachable{Address: address, Err: a.err}
		}
		var reply protocol.Reply
		if err := json.Unmarshal([]byte(a.raw), &reply); err != nil {
			return protocol.Reply{}, fmt.Errorf("editor at %s sent an unreadable reply: %w", address, err)
		}
		return reply, nil
	case <-time.After(RequestTimeout):
		return protocol.Reply{}, &Unreachable{Address: address, Err: fmt.Errorf("no reply within %s (is the editor suspended?)", RequestTimeout)}
	}
}
