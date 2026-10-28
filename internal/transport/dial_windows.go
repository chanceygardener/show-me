//go:build windows

package transport

import (
	"net"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
)

// Dial connects to a named pipe (Neovim's default on Windows) or host:port.
func Dial(address string, timeout time.Duration) (net.Conn, error) {
	if strings.HasPrefix(address, `\\.\pipe\`) {
		return winio.DialPipe(address, &timeout)
	}
	return net.DialTimeout("tcp", address, timeout)
}
