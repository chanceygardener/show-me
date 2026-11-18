//go:build !windows

package conformance

import (
	"os/exec"
	"syscall"
)

// isolate starts cmd in its own process group, so killTree reaches the
// extension host VS Code spawns.
func isolate(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }

func killTree(cmd *exec.Cmd) {
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	_ = cmd.Wait()
}
