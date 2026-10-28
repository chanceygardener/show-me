package check

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// fixture writes files into a fresh directory and returns its path.
func fixture(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// reason returns a rejection's message, failing if err is not a *Rejection.
func reason(t *testing.T, err error) string {
	t.Helper()
	var r *Rejection
	if !errors.As(err, &r) {
		t.Fatalf("want a *Rejection, got %v", err)
	}
	return r.Reason
}

func TestPane(t *testing.T) {
	dir := fixture(t, map[string]string{
		"five.txt":  "a\nb\nc\nd\ne\n",
		"crlf.txt":  "a\r\nb\r\n",
		"noeol.txt": "a\nb",
	})
	five := filepath.Join(dir, "five.txt")
	cases := []struct {
		name, spec string
		want       protocol.Pane
	}{
		{"relative whole file", "five.txt", protocol.Pane{Path: five}},
		// On Windows this spec starts with a drive letter, so its first colon
		// is not the range separator.
		{"absolute with range", five + ":2-4", protocol.Pane{Path: five, First: 2, Last: 4}},
		{"single line", "five.txt:3", protocol.Pane{Path: five, First: 3, Last: 3}},
		{"last line", "five.txt:5", protocol.Pane{Path: five, First: 5, Last: 5}},
		{"crlf line count", "crlf.txt:2", protocol.Pane{Path: filepath.Join(dir, "crlf.txt"), First: 2, Last: 2}},
		{"no trailing newline", "noeol.txt:2", protocol.Pane{Path: filepath.Join(dir, "noeol.txt"), First: 2, Last: 2}},
		{"dot segments cleaned", "./sub/../five.txt:1", protocol.Pane{Path: five, First: 1, Last: 1}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Pane(c.spec, dir)
			if err != nil {
				t.Fatal(err)
			}
			if got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}

func TestPaneRejections(t *testing.T) {
	dir := fixture(t, map[string]string{"five.txt": "a\nb\nc\nd\ne\n", "empty.txt": "", "bin.dat": "ab\x00cd"})
	five := filepath.Join(dir, "five.txt")
	missing := filepath.Join(dir, "missing.py")
	cases := []struct{ spec, want string }{
		{"five.txt:4-2", "range 4-2 in " + five + " has first > last"},
		{"five.txt:0-2", "range in " + five + " must start at line 1 or later"},
		{"five.txt:4-9", "range 4-9 is past the end of " + five + " (5 lines)"},
		{"five.txt:1-2-3", `malformed range "1-2-3" in five.txt:1-2-3 (use N or N-M)`},
		{"missing.py", "no readable file at " + missing},
		{"missing.py:3", "no readable file at " + missing},
		{"empty.txt:1", "range 1-1 is past the end of " + filepath.Join(dir, "empty.txt") + " (0 lines)"},
		{"bin.dat", filepath.Join(dir, "bin.dat") + " is a binary file"},
		{".", "no readable file at " + dir},
	}
	for _, c := range cases {
		t.Run(c.spec, func(t *testing.T) {
			_, err := Pane(c.spec, dir)
			if got := reason(t, err); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestPaneColonInFileName(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows file names cannot contain colons")
	}
	dir := fixture(t, map[string]string{"notes:12": "x\n"})
	got, err := Pane("notes:12", dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := (protocol.Pane{Path: filepath.Join(dir, "notes:12")}); got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestView(t *testing.T) {
	dir := fixture(t, map[string]string{"a.txt": "1\n2\n"})
	v, err := View("cols2", []string{"a.txt:1", "a.txt"}, "Compare", dir)
	if err != nil {
		t.Fatal(err)
	}
	if v.Layout != "cols2" || v.Title != "Compare" || len(v.Panes) != 2 || v.Panes[0].First != 1 {
		t.Fatalf("got %+v", v)
	}
	cases := []struct {
		layout string
		specs  []string
		want   string
	}{
		{"grid", []string{"a.txt"}, `unknown layout "grid" (valid: single, cols2, cols3, main-stack)`},
		{"cols2", []string{"a.txt"}, "cols2 takes 2 panes, got 1"},
		{"main-stack", []string{"a.txt", "a.txt"}, "main-stack takes 3-4 panes, got 2"},
		{"single", []string{"nope"}, "no readable file at " + filepath.Join(dir, "nope")},
	}
	for _, c := range cases {
		_, err := View(c.layout, c.specs, "", dir)
		if got := reason(t, err); got != c.want {
			t.Errorf("%s %v: got %q, want %q", c.layout, c.specs, got, c.want)
		}
	}
}

func TestTitle(t *testing.T) {
	for _, blank := range []string{"", "   "} {
		if got := reason(t, Title(blank)); got != "a deck needs a title" {
			t.Errorf("Title(%q) = %q", blank, got)
		}
	}
	if err := Title("Login flow"); err != nil {
		t.Errorf("Title rejected a real title: %v", err)
	}
}
