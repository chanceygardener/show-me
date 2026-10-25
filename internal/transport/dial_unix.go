//go:build !windows

package transport

import (
	"net"
	"strings"
	"time"
)

// dial connects to a Unix socket path, or to host:port when Neovim was
// started with a TCP --listen address.
func dial(address string, timeout time.Duration) (net.Conn, error) {
	network := "unix"
	if !strings.Contains(address, "/") && strings.Contains(address, ":") {
		network = "tcp"
	}
	return net.DialTimeout(network, address, timeout)
}
