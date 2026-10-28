//go:build !windows

package registry

import (
	"errors"
	"syscall"
)

// alive reports whether pid is a running process. EPERM means it exists but
// belongs to someone else, which still counts.
func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
