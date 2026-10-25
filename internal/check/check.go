// Package check validates an agent's request before it reaches an editor:
// deck titles, layouts, pane counts and `path[:N[-M]]` panes. Every check here
// is stateless. Checks that need deck state (the deck exists, isn't done, has
// room) belong to the editor that stores it.
package check

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// Rejection is a request the agent got wrong. Its message reaches the agent
// verbatim on stderr, so it says what to fix.
type Rejection struct{ Reason string }

func (r *Rejection) Error() string { return r.Reason }

func reject(format string, args ...any) *Rejection {
	return &Rejection{Reason: fmt.Sprintf(format, args...)}
}

// binaryProbe is how much of a file is searched for a NUL byte.
const binaryProbe = 8 << 10

var (
	rangeSuffix = regexp.MustCompile(`^(.*):([0-9-]+)$`)
	rangeForm   = regexp.MustCompile(`^([0-9]+)(?:-([0-9]+))?$`)
)

// Title checks a deck title.
func Title(title string) error {
	if strings.TrimSpace(title) == "" {
		return reject("a deck needs a title")
	}
	return nil
}

// View checks a layout and its panes, resolving pane paths against cwd.
func View(layout string, specs []string, title, cwd string) (protocol.View, error) {
	counts, ok := protocol.PaneCounts[layout]
	if !ok {
		return protocol.View{}, reject("unknown layout %q (valid: %s)", layout, strings.Join(protocol.Layouts, ", "))
	}
	if n := len(specs); n < counts.Min || n > counts.Max {
		accepted := strconv.Itoa(counts.Min)
		if counts.Min != counts.Max {
			accepted = fmt.Sprintf("%d-%d", counts.Min, counts.Max)
		}
		return protocol.View{}, reject("%s takes %s panes, got %d", layout, accepted, n)
	}
	panes := make([]protocol.Pane, 0, len(specs))
	for _, spec := range specs {
		pane, err := Pane(spec, cwd)
		if err != nil {
			return protocol.View{}, err
		}
		panes = append(panes, pane)
	}
	return protocol.View{Layout: layout, Title: title, Panes: panes}, nil
}

// Pane parses `path`, `path:N` or `path:N-M`. The range is read from the
// right and only when the part before it is a file, so drive letters
// (C:\a.py:3) and colons in file names keep working.
func Pane(spec, cwd string) (protocol.Pane, error) {
	if m := rangeSuffix.FindStringSubmatch(spec); m != nil {
		prefix := resolve(m[1], cwd)
		if isFile(prefix) {
			return withRange(prefix, m[2], spec)
		}
		if !isFile(resolve(spec, cwd)) {
			return protocol.Pane{}, reject("no readable file at %s", prefix)
		}
	}
	path := resolve(spec, cwd)
	if !isFile(path) {
		return protocol.Pane{}, reject("no readable file at %s", path)
	}
	if _, err := lines(path); err != nil {
		return protocol.Pane{}, err
	}
	return protocol.Pane{Path: path}, nil
}

func withRange(path, text, spec string) (protocol.Pane, error) {
	m := rangeForm.FindStringSubmatch(text)
	if m == nil {
		return protocol.Pane{}, reject("malformed range %q in %s (use N or N-M)", text, spec)
	}
	first, err := strconv.Atoi(m[1])
	last := first
	if err == nil && m[2] != "" {
		last, err = strconv.Atoi(m[2])
	}
	if err != nil {
		return protocol.Pane{}, reject("malformed range %q in %s (use N or N-M)", text, spec)
	}
	count, err := lines(path)
	if err != nil {
		return protocol.Pane{}, err
	}
	switch {
	case first < 1:
		return protocol.Pane{}, reject("range in %s must start at line 1 or later", path)
	case first > last:
		return protocol.Pane{}, reject("range %d-%d in %s has first > last", first, last, path)
	case last > count:
		return protocol.Pane{}, reject("range %d-%d is past the end of %s (%d lines)", first, last, path, count)
	}
	return protocol.Pane{Path: path, First: first, Last: last}, nil
}

// lines counts lines the way editors do: a trailing newline doesn't start a
// new line, and an empty file has none. Binary files are rejected.
func lines(path string) (int, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, reject("no readable file at %s", path)
	}
	if bytes.IndexByte(data[:min(len(data), binaryProbe)], 0) >= 0 {
		return 0, reject("%s is a binary file", path)
	}
	if len(data) == 0 {
		return 0, nil
	}
	n := bytes.Count(data, []byte{'\n'})
	if data[len(data)-1] != '\n' {
		n++
	}
	return n, nil
}

func resolve(path, cwd string) string {
	if !filepath.IsAbs(path) {
		path = filepath.Join(cwd, path)
	}
	return filepath.Clean(path)
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}
