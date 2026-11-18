package transport

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// sendNDJSON writes req, carrying t's token, as one line and reads one reply
// line. The editor closes the connection after replying.
func sendNDJSON(t protocol.Transport, req protocol.Request) (protocol.Reply, error) {
	req.Token = t.Token
	body, err := json.Marshal(req)
	if err != nil {
		return protocol.Reply{}, err
	}
	conn, err := Dial(t.Address, DialTimeout)
	if err != nil {
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: err}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(RequestTimeout))

	if _, err := conn.Write(append(body, '\n')); err != nil {
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: err}
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil && !(errors.Is(err, io.EOF) && len(line) > 0) {
		var timeout net.Error
		if errors.As(err, &timeout) && timeout.Timeout() {
			err = fmt.Errorf("no reply within %s (is the editor suspended?)", RequestTimeout)
		}
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: err}
	}
	var reply protocol.Reply
	if err := json.Unmarshal(line, &reply); err != nil {
		return protocol.Reply{}, fmt.Errorf("editor at %s sent an unreadable reply: %w", t.Address, err)
	}
	return reply, nil
}
