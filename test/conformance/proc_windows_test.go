//go:build windows

package conformance

import (
	"os/exec"
	"strconv"
)

func isolate(*exec.Cmd) {}

func killTree(cmd *exec.Cmd) {
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
	_ = cmd.Wait()
}
