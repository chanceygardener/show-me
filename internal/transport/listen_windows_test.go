//go:build windows

package transport

import (
	"net"

	"github.com/Microsoft/go-winio"
)

func listen(address string) (net.Listener, error) { return winio.ListenPipe(address, nil) }
