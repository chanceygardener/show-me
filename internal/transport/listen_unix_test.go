//go:build !windows

package transport

import "net"

func listen(address string) (net.Listener, error) { return net.Listen("unix", address) }
