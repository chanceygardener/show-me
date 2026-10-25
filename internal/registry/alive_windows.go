//go:build windows

package registry

import "os"

// alive reports whether pid is a running process. On Windows FindProcess
// opens a handle, which fails once the process is gone.
func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = p.Release()
	return true
}
