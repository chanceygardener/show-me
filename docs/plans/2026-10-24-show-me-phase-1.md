# show-me Phase 1 (Core CLI and Neovim Plugin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `show-me` Go CLI, the protocol contract, and the Neovim plugin as a standalone repository, then switch the kickstart.nvim config over to it.

**Architecture:** The Go CLI checks every stateless part of an agent's request, finds the right editor through a registry of JSON entry files, and calls the Neovim plugin's `rpc.handle` over Neovim's built-in RPC server with `nvim_exec_lua`. The plugin stores decks per workspace, enforces the checks that need deck state, and renders views in a dedicated tab, keeping sidebars such as neo-tree. Installers download a checksummed release binary, or build from the checkout, and install the agent skill.

**Tech Stack:** Go 1.24+ with `github.com/neovim/go-client` and `github.com/Microsoft/go-winio`; Lua on Neovim 0.10+; POSIX `sh` and PowerShell installers; goreleaser v2; GitHub Actions.

**Spec:** `docs/specs/2026-10-17-show-me-design.md`

## Global Constraints

- Repository `github.com/chanceygardener/show-me`, Go module `github.com/chanceygardener/show-me`, MIT license.
- Neovim floor is 0.10 (`vim.fs.joinpath`, `nvim_open_win` splits, `vim.iter`).
- Protocol version is `1`. The CLI speaks exactly one protocol version.
- Datetimes are integer epoch milliseconds (`created_at`, `started_at`, `focused_at`).
- Every data shape has a type: Go structs; Lua `---@class` annotations.
- Exit codes: `0` ok, `1` rejected, `2` usage (including an unknown subcommand), `3` no reachable editor, `4` protocol mismatch.
- Rejection messages are copied verbatim from the spec's table. Agents and the conformance suite depend on the exact text.
- `install.sh` is POSIX `sh`: no bashisms. Test scripts may use bash.
- Base directory: `$SHOW_ME_HOME`, else `$XDG_STATE_HOME/show-me`, else `~/.local/state/show-me`. On Windows it is `%LOCALAPPDATA%\show-me`. Empty variables count as unset.
- No signing or notarization. Binaries reach users only through `curl`, PowerShell, `go build` or the plugin build hook.
- Any intentional rule break gets a `RULE EXCEPTION:` comment at the point of deviation.
- Don't run stylua or gofmt across files you didn't write. Run `gofmt -w` only on the Go files you create.

## Review Focus

These are the five input classes the spec implies but that are easy to leave untested, most likely first. Each one has a test assigned to the task that owns the code.

1. **Windows paths.** Pane specs with drive letters (`C:\a.py:3-4`), backslashed workspace folders from `fs_realpath`, and case-insensitive folder matching. Covered in Task 2 (absolute-path range cases, which run on the Windows CI leg) and Task 3 (case folding).
2. **Two Neovims in one folder, with the user switching focus mid-deck.** Every `view` and `done` must reach the editor that created the deck. Covered by deck handles in Task 5 and the conformance test in Task 10.
3. **Several agents sending to one Neovim at once.** Each concurrent `view` must get a distinct number. Covered in Task 10.
4. **A show-me tab left with only a sidebar** (the user closed every pane), including a right-hand sidebar. The next view must rebuild beside it. Covered in Task 8.
5. **The plugin loaded after `VimEnter`** (`event = 'VeryLazy'`). It must still register. Covered in Task 10.

## Branches

- The show-me repo: work on `ian/feat/phase-1`, created from `main` in Task 1.
- kickstart.nvim (Task 13 only): work on `ian/chore/show-me-plugin`, created from `ian/feat/beacon-workflow`, where the prototype lives.
- Nothing in this plan pushes, creates the GitHub repository, or tags a release. Those are the user's call once phase 1 is reviewed.

## File Structure

New modules (all in `~/repos/show-me`):

| Path | Responsibility |
|---|---|
| `go.mod`, `LICENSE`, `VERSION`, `.gitignore` | Module, MIT license, release version (`0.1.0`), ignores |
| `internal/protocol/protocol.go` | Wire and registry types, constants, layout pane counts |
| `internal/check/check.go` | Stateless checks: title, layout, pane count, `path[:N[-M]]`, file and range |
| `internal/registry/registry.go` | Base dir, reading entries, targets (cwd and main checkout), ranking |
| `internal/registry/alive_unix.go`, `alive_windows.go` | Whether an editor pid is still running |
| `internal/transport/transport.go` | `Send`, deadlines, `Unreachable`, the Neovim msgpack-RPC client |
| `internal/transport/dial_unix.go`, `dial_windows.go` | Unix socket, TCP or named-pipe dialing |
| `internal/transport/testdata/fakeplugin/lua/show_me/rpc.lua` | Echoing stand-in for the plugin in transport tests |
| `cmd/show-me/main.go` | Arguments, subcommands, deck handles, output, exit codes |
| `lua/show_me/util.lua` | `now_ms()` |
| `lua/show_me/config.lua` | Option types, defaults, merging, `open_hint()` |
| `lua/show_me/store.lua` | Deck persistence, editor-side rejections, pruning |
| `lua/show_me/state.lua` | The workspace served, its store, the current deck |
| `lua/show_me/rpc.lua` | `handle(json) -> json` |
| `lua/show_me/registry.lua` | This Neovim's registry entry |
| `lua/show_me/layout.lua` | The four layouts, sidebar-aware widths |
| `lua/show_me/render.lua` | The show-me tab, sidebars, highlights, winbar |
| `lua/show_me/init.lua` | `setup()`, keymaps, `<Plug>` mappings, `:ShowMe`, autocmds, picker |
| `lua/show_me/health.lua` | `:checkhealth show_me` |
| `test/nvim/helpers.lua`, `test/nvim/run.sh`, `test/nvim/*_spec.lua` | Neovim specs |
| `test/conformance/conformance_test.go` | Real Neovim driven by the real CLI |
| `skills/show-me/SKILL.md` | Agent instructions |
| `install.sh`, `install.ps1`, `test/install/install_test.sh`, `test/install/install_test.ps1` | Installers and their tests |
| `.goreleaser.yaml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml` | Releases and CI |
| `protocol/PROTOCOL.md`, `README.md`, `doc/show-me.txt`, `CONTRIBUTING.md` | Documentation |

Rulings already made while planning, recorded so executors don't relitigate them:

- **The `ndjson` transport is phase 2.** Phase 1's `Send` returns `Unreachable` for any other kind, so the CLI skips such editors.
- **`protocol/schema.json` is phase 2.** The spec was amended to say so.
- **Every Neovim sharing a workspace folder shares its deck directory.** Because of that, two editors in one folder see each other's decks in the picker. Deck handles still route each agent request to its own editor. The cost if this is wrong: a rare id collision when two agents create decks in two same-folder editors at the same instant.

---

### Task 1: Repository scaffold and protocol types

**Files:**
- Create: `go.mod`, `LICENSE`, `VERSION`, `.gitignore`
- Create: `internal/protocol/protocol.go`
- Test: `internal/protocol/protocol_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: package `protocol` with
  - constants `Version = 1`, `CommandDeck`, `CommandView`, `CommandDone`, `CommandStatus`, `TransportNvim = "nvim"`
  - vars `Layouts []string` and `PaneCounts map[string]PaneRange`, where `type PaneRange struct{ Min, Max int }`
  - types `Request`, `View`, `Pane`, `Reply`, `DeckResult`, `ViewResult`, `DoneResult`, `StatusResult`, `CurrentDeck`, `Entry`, `Transport`, with the field names and JSON tags shown below

- [ ] **Step 1: Create the branch and the module**

```bash
cd ~/repos/show-me
git switch -c ian/feat/phase-1
go mod init github.com/chanceygardener/show-me
printf '0.1.0\n' > VERSION
printf '/dist/\n/.superpowers/\n' > .gitignore
```

Write `LICENSE` (MIT):

```
MIT License

Copyright (c) 2026 Ian Bicket

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write the failing test**

`internal/protocol/protocol_test.go`:

```go
package protocol

import (
	"encoding/json"
	"testing"
)

func TestRequestOmitsUnsetFields(t *testing.T) {
	data, err := json.Marshal(Request{Protocol: Version, Command: CommandStatus})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), `{"protocol":1,"command":"status"}`; got != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestViewRequestShape(t *testing.T) {
	req := Request{
		Protocol: Version,
		Command:  CommandView,
		Deck:     7,
		View:     &View{Layout: "cols2", Panes: []Pane{{Path: "/a", First: 2, Last: 4}, {Path: "/b"}}},
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"protocol":1,"command":"view","deck":7,"view":{"layout":"cols2","panes":[{"path":"/a","first":2,"last":4},{"path":"/b"}]}}`
	if string(data) != want {
		t.Fatalf("got %s, want %s", data, want)
	}
}

func TestReplyDecodesNullCurrent(t *testing.T) {
	var reply Reply
	body := `{"ok":true,"result":{"editor":"nvim","workspace_folders":["/w"],"current":null}}`
	if err := json.Unmarshal([]byte(body), &reply); err != nil {
		t.Fatal(err)
	}
	var status StatusResult
	if err := json.Unmarshal(reply.Result, &status); err != nil {
		t.Fatal(err)
	}
	if !reply.OK || status.Current != nil || status.WorkspaceFolders[0] != "/w" {
		t.Fatalf("decoded %+v / %+v", reply, status)
	}
}

func TestEveryLayoutHasPaneCounts(t *testing.T) {
	for _, name := range Layouts {
		if _, ok := PaneCounts[name]; !ok {
			t.Errorf("layout %q has no pane counts", name)
		}
	}
	if len(PaneCounts) != len(Layouts) {
		t.Errorf("PaneCounts has %d layouts, Layouts has %d", len(PaneCounts), len(Layouts))
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `go test ./internal/protocol/`
Expected: FAIL with `undefined: Request` (and similar). The package has no non-test files yet.

- [ ] **Step 4: Write the implementation**

`internal/protocol/protocol.go`:

```go
// Package protocol defines what the show-me CLI and editors exchange: the
// requests and replies on the wire, and the registry entries editors publish.
//
// These types are the contract in protocol/PROTOCOL.md and the source the
// editor plugins' own type annotations follow. Changing any of them bumps
// Version, in the CLI and every editor in the same release.
package protocol

import "encoding/json"

// Version is the only protocol version this build speaks.
const Version = 1

// Commands an editor understands.
const (
	CommandDeck   = "deck"
	CommandView   = "view"
	CommandDone   = "done"
	CommandStatus = "status"
)

// TransportNvim is Neovim's own msgpack-RPC server, called with nvim_exec_lua.
const TransportNvim = "nvim"

// Layouts lists the approved layouts in documented order.
var Layouts = []string{"single", "cols2", "cols3", "main-stack"}

// PaneRange is the inclusive range of pane counts a layout accepts.
type PaneRange struct{ Min, Max int }

// PaneCounts gives the pane counts each layout accepts.
var PaneCounts = map[string]PaneRange{
	"single":     {1, 1},
	"cols2":      {2, 2},
	"cols3":      {3, 3},
	"main-stack": {3, 4},
}

// Request is one CLI call to an editor.
type Request struct {
	Protocol int    `json:"protocol"`
	Token    string `json:"token,omitempty"`
	Command  string `json:"command"`
	Title    string `json:"title,omitempty"`
	Deck     int    `json:"deck,omitempty"`
	View     *View  `json:"view,omitempty"`
}

// View is one approved layout filled with panes, in reading order.
type View struct {
	Layout string `json:"layout"`
	Title  string `json:"title,omitempty"`
	Panes  []Pane `json:"panes"`
}

// Pane is a file with an optional highlighted line range.
type Pane struct {
	Path  string `json:"path"`            // absolute, cleaned
	First int    `json:"first,omitempty"` // 1-based
	Last  int    `json:"last,omitempty"`  // 1-based, inclusive
}

// Reply is an editor's answer. Result's shape depends on the command.
type Reply struct {
	OK     bool            `json:"ok"`
	Error  string          `json:"error,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
}

// DeckResult answers CommandDeck.
type DeckResult struct {
	Deck int `json:"deck"`
}

// ViewResult answers CommandView with the view's number within its deck.
type ViewResult struct {
	View int `json:"view"`
}

// DoneResult answers CommandDone.
type DoneResult struct {
	Deck     int    `json:"deck"`
	Views    int    `json:"views"`
	OpenHint string `json:"open_hint"`
}

// StatusResult answers CommandStatus. Current is nil when no deck is done yet.
type StatusResult struct {
	Editor           string       `json:"editor"`
	WorkspaceFolders []string     `json:"workspace_folders"`
	Current          *CurrentDeck `json:"current"`
}

// CurrentDeck summarizes the deck an editor's view keys act on.
type CurrentDeck struct {
	Deck  int    `json:"deck"`
	Title string `json:"title"`
	Views int    `json:"views"`
}

// Entry is the registry file a running editor publishes so the CLI can find
// it: <base>/editors/<editor>-<pid>.json.
type Entry struct {
	Protocol         int       `json:"protocol"`
	Editor           string    `json:"editor"`
	PID              int       `json:"pid"`
	WorkspaceFolders []string  `json:"workspace_folders"`
	Transport        Transport `json:"transport"`
	OpenHint         string    `json:"open_hint"`
	StartedAt        int64     `json:"started_at"` // epoch ms
	FocusedAt        int64     `json:"focused_at"` // epoch ms
}

// Transport says how to reach an editor.
type Transport struct {
	Kind    string `json:"kind"`
	Address string `json:"address"`
	Token   string `json:"token,omitempty"`
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `gofmt -l internal && go vet ./... && go test ./internal/protocol/`
Expected: no gofmt output, then `ok  	github.com/chanceygardener/show-me/internal/protocol`

- [ ] **Step 6: Commit**

```bash
git add go.mod LICENSE VERSION .gitignore internal/protocol
git commit -m "feat(protocol): scaffold the module and define the wire and registry types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stateless request checks

**Files:**
- Create: `internal/check/check.go`
- Test: `internal/check/check_test.go`

**Interfaces:**
- Consumes: `protocol.Pane`, `protocol.View`, `protocol.Layouts`, `protocol.PaneCounts`
- Produces:
  - `type Rejection struct{ Reason string }`, which implements `error`
  - `func Title(title string) error`
  - `func View(layout string, specs []string, title, cwd string) (protocol.View, error)`
  - `func Pane(spec, cwd string) (protocol.Pane, error)`
  - Every rejection these return is a `*Rejection`.

- [ ] **Step 1: Write the failing test**

`internal/check/check_test.go`:

```go
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./internal/check/`
Expected: FAIL with `undefined: Pane` (and similar).

- [ ] **Step 3: Write the implementation**

`internal/check/check.go`:

```go
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `gofmt -l internal && go test ./internal/check/`
Expected: no gofmt output, then `ok  	github.com/chanceygardener/show-me/internal/check`

- [ ] **Step 5: Commit**

```bash
git add internal/check
git commit -m "feat(check): validate titles, layouts and panes before they reach an editor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Registry reading and editor ranking

**Files:**
- Create: `internal/registry/registry.go`, `internal/registry/alive_unix.go`, `internal/registry/alive_windows.go`
- Test: `internal/registry/registry_test.go`

**Interfaces:**
- Consumes: `protocol.Entry`, `protocol.Version`
- Produces:
  - `func BaseDir() (string, error)` and `func EditorsDir(base string) string`
  - `type Candidate struct{ File string; Entry protocol.Entry }`
  - `type Ranking struct{ Dir string; Targets []string; All, Ranked, Incompatible []Candidate }`, with method `func (r Ranking) ByPID(pid int) (Candidate, bool)`
  - `func Locate(cwd string) (Ranking, error)`
  - `func Read(dir string) ([]Candidate, error)`
  - `func Targets(cwd string) []string`
  - `func Rank(all []Candidate, targets []string) (ranked, incompatible []Candidate)`

- [ ] **Step 1: Write the failing test**

`internal/registry/registry_test.go`:

```go
package registry

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chanceygardener/show-me/internal/protocol"
)

func writeEntry(t *testing.T, dir, name string, e protocol.Entry) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(e)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, name)
	if err := os.WriteFile(file, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

// deadPID returns the pid of a process that has already exited.
func deadPID(t *testing.T) int {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	return cmd.Process.Pid
}

func names(cs []Candidate) string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.File
	}
	return strings.Join(out, ",")
}

func TestBaseDir(t *testing.T) {
	t.Setenv("SHOW_ME_HOME", "/custom")
	if got, _ := BaseDir(); got != "/custom" {
		t.Fatalf("SHOW_ME_HOME: got %s", got)
	}
	t.Setenv("SHOW_ME_HOME", "")
	if runtime.GOOS == "windows" {
		t.Setenv("LOCALAPPDATA", `C:\Users\me\AppData\Local`)
		if got, _ := BaseDir(); got != `C:\Users\me\AppData\Local\show-me` {
			t.Fatalf("LOCALAPPDATA: got %s", got)
		}
		return
	}
	t.Setenv("XDG_STATE_HOME", "/xdg")
	if got, _ := BaseDir(); got != "/xdg/show-me" {
		t.Fatalf("XDG_STATE_HOME: got %s", got)
	}
	t.Setenv("XDG_STATE_HOME", "")
	t.Setenv("HOME", "/home/me")
	if got, _ := BaseDir(); got != "/home/me/.local/state/show-me" {
		t.Fatalf("default: got %s", got)
	}
}

func TestRead(t *testing.T) {
	dir := t.TempDir()
	live := writeEntry(t, dir, "nvim-1.json", protocol.Entry{Protocol: 1, Editor: "nvim", PID: os.Getpid()})
	dead := writeEntry(t, dir, "nvim-2.json", protocol.Entry{Protocol: 1, Editor: "nvim", PID: deadPID(t)})
	broken := filepath.Join(dir, "broken.json")
	if err := os.WriteFile(broken, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nvim-1.json.tmp"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if names(got) != live {
		t.Fatalf("got %s, want only %s", names(got), live)
	}
	if _, err := os.Stat(dead); !os.IsNotExist(err) {
		t.Errorf("entry of an exited editor was not deleted")
	}
	if _, err := os.Stat(broken); err != nil {
		t.Errorf("unparseable entry should be skipped, not deleted")
	}
	if got, err := Read(filepath.Join(dir, "missing")); got != nil || err != nil {
		t.Errorf("missing registry: got %v, %v", got, err)
	}
}

func TestRank(t *testing.T) {
	root := t.TempDir()
	repos := filepath.Join(root, "repos")
	foo := filepath.Join(repos, "foo")
	other := filepath.Join(root, "other")
	cand := func(name, folder string, focused int64, proto int) Candidate {
		return Candidate{File: name, Entry: protocol.Entry{Protocol: proto, WorkspaceFolders: []string{folder}, FocusedAt: focused}}
	}
	all := []Candidate{cand("A", repos, 9, 1), cand("B", foo, 1, 1), cand("C", foo, 5, 1), cand("D", other, 9, 1), cand("E", foo, 9, 2)}

	ranked, incompatible := Rank(all, []string{filepath.Join(foo, "src")})
	if names(ranked) != "C,B,A" || names(incompatible) != "E" {
		t.Fatalf("deepest folder, then focus: got %s / %s", names(ranked), names(incompatible))
	}
	if ranked, _ := Rank([]Candidate{cand("F", filepath.Join(root, "rep"), 1, 1)}, []string{repos}); len(ranked) != 0 {
		t.Errorf("a folder must contain the target at a path boundary, got %s", names(ranked))
	}
	if ranked, _ := Rank(all, []string{filepath.Join(root, "elsewhere"), other}); names(ranked) != "D" {
		t.Errorf("falls back to the second target: got %s", names(ranked))
	}
	if ranked, _ := Rank(all, []string{other, repos}); names(ranked) != "D" {
		t.Errorf("the first matching target wins: got %s", names(ranked))
	}
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		if ranked, _ := Rank(all, []string{strings.ToUpper(foo)}); names(ranked) != "C,B,A" {
			t.Errorf("case-insensitive on %s: got %s", runtime.GOOS, names(ranked))
		}
	}
}

func TestByPID(t *testing.T) {
	r := Ranking{All: []Candidate{{File: "x", Entry: protocol.Entry{PID: 42}}}}
	if c, ok := r.ByPID(42); !ok || c.File != "x" {
		t.Fatalf("ByPID(42) = %+v, %v", c, ok)
	}
	if _, ok := r.ByPID(7); ok {
		t.Fatal("ByPID(7) found something")
	}
}

func TestTargets(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	root := canonical(t.TempDir())
	repo, wt := filepath.Join(root, "repo"), filepath.Join(root, "wt")
	git := func(dir string, args ...string) {
		t.Helper()
		full := append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com"}, args...)
		if out, err := exec.Command("git", full...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.MkdirAll(filepath.Join(repo, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	git(repo, "init", "-q")
	git(repo, "commit", "-q", "--allow-empty", "-m", "init")
	git(repo, "worktree", "add", "-q", wt)
	plain := filepath.Join(root, "plain")
	if err := os.Mkdir(plain, 0o755); err != nil {
		t.Fatal(err)
	}

	cases := map[string][]string{
		wt:                         {canonical(wt), canonical(repo)},
		filepath.Join(repo, "sub"): {canonical(filepath.Join(repo, "sub")), canonical(repo)},
		repo:                       {canonical(repo)},
		plain:                      {canonical(plain)},
	}
	for cwd, want := range cases {
		if got := Targets(cwd); strings.Join(got, "|") != strings.Join(want, "|") {
			t.Errorf("Targets(%s) = %v, want %v", cwd, got, want)
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./internal/registry/`
Expected: FAIL with `undefined: BaseDir` (and similar).

- [ ] **Step 3: Write the implementation**

`internal/registry/registry.go`:

```go
// Package registry finds the running editors that can show an agent's deck.
//
// Each editor publishes one JSON file (protocol.Entry) under <base>/editors/.
// The CLI reads them all, drops editors that have exited, and ranks the rest
// by how closely their workspace folders contain the agent's directory.
package registry

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// BaseDir is show-me's home, shared with the editor plugins. SHOW_ME_HOME
// overrides it, which is how tests isolate themselves.
func BaseDir() (string, error) {
	if dir := os.Getenv("SHOW_ME_HOME"); dir != "" {
		return dir, nil
	}
	if runtime.GOOS == "windows" {
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			return "", errors.New("LOCALAPPDATA is not set")
		}
		return filepath.Join(local, "show-me"), nil
	}
	if state := os.Getenv("XDG_STATE_HOME"); state != "" {
		return filepath.Join(state, "show-me"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "state", "show-me"), nil
}

// EditorsDir holds one entry file per running editor.
func EditorsDir(base string) string { return filepath.Join(base, "editors") }

// Candidate is a live editor and the file it registered in.
type Candidate struct {
	File  string
	Entry protocol.Entry
}

// Ranking is everything the CLI needs to pick an editor or explain why none fits.
type Ranking struct {
	Dir          string      // registry directory that was read
	Targets      []string    // directories the request is about, nearest first
	All          []Candidate // every live entry
	Ranked       []Candidate // compatible editors serving the first matched target, best first
	Incompatible []Candidate // editors serving that target that speak another protocol
}

// ByPID finds the live editor with this pid, for deck handles.
func (r Ranking) ByPID(pid int) (Candidate, bool) {
	for _, c := range r.All {
		if c.Entry.PID == pid {
			return c, true
		}
	}
	return Candidate{}, false
}

// Locate reads the registry and ranks the editors for an agent working in cwd.
func Locate(cwd string) (Ranking, error) {
	base, err := BaseDir()
	if err != nil {
		return Ranking{}, err
	}
	dir := EditorsDir(base)
	all, err := Read(dir)
	if err != nil {
		return Ranking{}, err
	}
	targets := Targets(cwd)
	ranked, incompatible := Rank(all, targets)
	return Ranking{Dir: dir, Targets: targets, All: all, Ranked: ranked, Incompatible: incompatible}, nil
}

// Read returns every live entry in dir. Files whose editor has exited are
// deleted; files that don't parse are skipped and left alone.
func Read(dir string) ([]Candidate, error) {
	items, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var live []Candidate
	for _, item := range items {
		if item.IsDir() || filepath.Ext(item.Name()) != ".json" {
			continue
		}
		file := filepath.Join(dir, item.Name())
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var entry protocol.Entry
		if json.Unmarshal(data, &entry) != nil {
			continue
		}
		if !alive(entry.PID) {
			_ = os.Remove(file)
			continue
		}
		live = append(live, Candidate{File: file, Entry: entry})
	}
	return live, nil
}

// Targets lists the directories an agent in cwd is asking about, nearest
// first: cwd itself, then the repository's main checkout when cwd is inside a
// linked worktree or a subdirectory.
func Targets(cwd string) []string {
	here := canonical(cwd)
	targets := []string{here}
	if root := mainCheckout(here); root != "" && fold(root) != fold(here) {
		targets = append(targets, root)
	}
	return targets
}

// mainCheckout is the parent of the repository's common git dir, or "" when
// dir isn't in a repository or git isn't installed.
func mainCheckout(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "--git-common-dir").Output()
	if err != nil {
		return ""
	}
	common := filepath.FromSlash(strings.TrimSpace(string(out)))
	if !filepath.IsAbs(common) {
		common = filepath.Join(dir, common)
	}
	return filepath.Dir(canonical(common))
}

// Rank orders the candidates serving the first target that any candidate
// serves: deepest containing folder first, then most recently focused. Those
// speaking another protocol are returned separately so the CLI can say so.
func Rank(all []Candidate, targets []string) (ranked, incompatible []Candidate) {
	type scored struct {
		c     Candidate
		depth int
	}
	for _, target := range targets {
		var matched []scored
		for _, c := range all {
			if depth := deepestContaining(c.Entry.WorkspaceFolders, target); depth >= 0 {
				matched = append(matched, scored{c, depth})
			}
		}
		if len(matched) == 0 {
			continue
		}
		sort.SliceStable(matched, func(i, j int) bool {
			if matched[i].depth != matched[j].depth {
				return matched[i].depth > matched[j].depth
			}
			return matched[i].c.Entry.FocusedAt > matched[j].c.Entry.FocusedAt
		})
		for _, m := range matched {
			if m.c.Entry.Protocol == protocol.Version {
				ranked = append(ranked, m.c)
			} else {
				incompatible = append(incompatible, m.c)
			}
		}
		return ranked, incompatible
	}
	return nil, nil
}

// deepestContaining returns the length of the longest folder containing
// target, or -1 when none does.
func deepestContaining(folders []string, target string) int {
	best := -1
	for _, folder := range folders {
		if contains(folder, target) && len(folder) > best {
			best = len(folder)
		}
	}
	return best
}

func contains(folder, target string) bool {
	folder, target = fold(filepath.Clean(folder)), fold(filepath.Clean(target))
	if folder == target {
		return true
	}
	prefix := folder
	if !strings.HasSuffix(prefix, string(filepath.Separator)) {
		prefix += string(filepath.Separator)
	}
	return strings.HasPrefix(target, prefix)
}

// fold makes path comparisons case-insensitive where the default file system is.
func fold(path string) string {
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		return strings.ToLower(path)
	}
	return path
}

// canonical is path made absolute with symlinks resolved, matching what
// editors register (Neovim uses fs_realpath).
func canonical(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	if real, err := filepath.EvalSymlinks(path); err == nil {
		path = real
	}
	return filepath.Clean(path)
}
```

`internal/registry/alive_unix.go`:

```go
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
```

`internal/registry/alive_windows.go`:

```go
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `gofmt -l internal && GOOS=windows go vet ./internal/registry/ && go test ./internal/registry/`
Expected: no gofmt output, the Windows cross-vet passes, then `ok  	github.com/chanceygardener/show-me/internal/registry`

- [ ] **Step 5: Commit**

```bash
git add internal/registry
git commit -m "feat(registry): find live editors and rank them by workspace and focus" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Neovim transport

**Files:**
- Create: `internal/transport/transport.go`, `internal/transport/dial_unix.go`, `internal/transport/dial_windows.go`
- Create: `internal/transport/testdata/fakeplugin/lua/show_me/rpc.lua`
- Test: `internal/transport/transport_test.go`
- Modify: `go.mod`, `go.sum`

**Interfaces:**
- Consumes: `protocol.Transport`, `protocol.Request`, `protocol.Reply`, `protocol.TransportNvim`
- Produces:
  - vars `DialTimeout`, `RequestTimeout time.Duration`
  - `type Unreachable struct{ Address string; Err error }`
  - `func Send(t protocol.Transport, req protocol.Request) (protocol.Reply, error)`
  - Connection failures, timeouts and unknown transport kinds are all returned as `*Unreachable`.

- [ ] **Step 1: Add the dependencies and confirm the API**

```bash
go get github.com/neovim/go-client@latest github.com/Microsoft/go-winio@latest
go doc github.com/neovim/go-client/nvim New
go doc github.com/neovim/go-client/nvim Nvim.ExecLua
```

Expected:
- `func New(r io.Reader, w io.Writer, c io.Closer, logf func(string, ...any)) (*Nvim, error)` (the last parameter may print as `...interface{}`)
- `func (v *Nvim) ExecLua(code string, result any, args ...any) error`

If either signature differs, record a ruling and adapt `sendNvim`.

- [ ] **Step 2: Write the fake plugin and the failing test**

`internal/transport/testdata/fakeplugin/lua/show_me/rpc.lua`:

```lua
-- Stand-in for the real plugin: echoes the request so transport tests can
-- check what arrived without depending on deck storage.
local M = {}

function M.handle(json)
  local req = vim.json.decode(json)
  return vim.json.encode { ok = true, result = { echo = req.command, deck = req.deck } }
end

return M
```

`internal/transport/transport_test.go`:

```go
package transport

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// testAddress is a fresh server address. Unix socket paths must stay under
// macOS's 104-byte limit, so they go in a short directory, not t.TempDir().
func testAddress(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`\\.\pipe\show-me-test-%d-%d`, os.Getpid(), time.Now().UnixNano())
	}
	dir, err := os.MkdirTemp("", "sm")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return filepath.Join(dir, "n.sock")
}

// startNvim runs headless Neovim with the fake plugin, listening on a fresh address.
func startNvim(t *testing.T) (string, *exec.Cmd) {
	t.Helper()
	if _, err := exec.LookPath("nvim"); err != nil {
		t.Skip("nvim not on PATH")
	}
	addr := testAddress(t)
	plugin, err := filepath.Abs("testdata/fakeplugin")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("nvim", "--clean", "--headless", "--listen", addr,
		"--cmd", fmt.Sprintf("lua vim.opt.rtp:prepend([[%s]])", plugin))
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if conn, err := dial(addr, time.Second); err == nil {
			_ = conn.Close()
			return addr, cmd
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("nvim never listened on %s", addr)
	return "", nil
}

func TestSendNvim(t *testing.T) {
	addr, _ := startNvim(t)
	reply, err := Send(protocol.Transport{Kind: protocol.TransportNvim, Address: addr},
		protocol.Request{Protocol: protocol.Version, Command: protocol.CommandDone, Deck: 7})
	if err != nil {
		t.Fatal(err)
	}
	var echo struct {
		Echo string `json:"echo"`
		Deck int    `json:"deck"`
	}
	if err := json.Unmarshal(reply.Result, &echo); err != nil {
		t.Fatal(err)
	}
	if !reply.OK || echo.Echo != "done" || echo.Deck != 7 {
		t.Fatalf("got %+v / %+v", reply, echo)
	}
}

func TestSendUnreachable(t *testing.T) {
	start := time.Now()
	_, err := Send(protocol.Transport{Kind: protocol.TransportNvim, Address: testAddress(t)}, protocol.Request{})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > DialTimeout+time.Second {
		t.Fatalf("took %s", elapsed)
	}
}

func TestSendUnsupportedTransport(t *testing.T) {
	_, err := Send(protocol.Transport{Kind: "ndjson", Address: "x"}, protocol.Request{})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
}

func TestSendSuspendedEditor(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no SIGSTOP on Windows")
	}
	addr, cmd := startNvim(t)
	old := RequestTimeout
	RequestTimeout = 500 * time.Millisecond
	t.Cleanup(func() { RequestTimeout = old })
	if err := cmd.Process.Signal(syscall.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Signal(syscall.SIGCONT) })

	start := time.Now()
	_, err := Send(protocol.Transport{Kind: protocol.TransportNvim, Address: addr}, protocol.Request{Protocol: 1, Command: "status"})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("a suspended editor held the CLI for %s", elapsed)
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `go test ./internal/transport/`
Expected: FAIL with `undefined: Send` (and similar).

- [ ] **Step 4: Write the implementation**

`internal/transport/transport.go`:

```go
// Package transport delivers one request to one editor and returns its reply.
//
// Phase 1 speaks to Neovim only, over its built-in msgpack-RPC server: the
// request JSON is passed to the plugin's rpc.handle with nvim_exec_lua, so
// nothing is quoted into Vimscript. Any other transport kind is reported as
// unreachable, and the CLI moves on to the next editor.
package transport

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/neovim/go-client/nvim"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// Deadlines. They are variables so tests can shorten them.
var (
	DialTimeout    = 2 * time.Second
	RequestTimeout = 10 * time.Second
)

// Unreachable means the editor could not be asked: it isn't listening, it
// stopped answering, or it speaks a transport this build doesn't. Trying the
// next editor is reasonable.
type Unreachable struct {
	Address string
	Err     error
}

func (u *Unreachable) Error() string { return fmt.Sprintf("%s: %v", u.Address, u.Err) }
func (u *Unreachable) Unwrap() error { return u.Err }

// nvimHandler runs inside Neovim; `...` is the request JSON.
const nvimHandler = "return require('show_me.rpc').handle(...)"

// Send delivers req to the editor behind t and returns its reply.
func Send(t protocol.Transport, req protocol.Request) (protocol.Reply, error) {
	switch t.Kind {
	case protocol.TransportNvim:
		return sendNvim(t.Address, req)
	default:
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: fmt.Errorf("unsupported transport %q", t.Kind)}
	}
}

func sendNvim(address string, req protocol.Request) (protocol.Reply, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return protocol.Reply{}, err
	}
	conn, err := dial(address, DialTimeout)
	if err != nil {
		return protocol.Reply{}, &Unreachable{Address: address, Err: err}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(RequestTimeout))

	client, err := nvim.New(conn, conn, conn, func(string, ...any) {})
	if err != nil {
		return protocol.Reply{}, &Unreachable{Address: address, Err: err}
	}
	go func() { _ = client.Serve() }()

	type answer struct {
		raw string
		err error
	}
	answered := make(chan answer, 1)
	go func() {
		var raw string
		err := client.ExecLua(nvimHandler, &raw, string(body))
		answered <- answer{raw, err}
	}()

	select {
	case a := <-answered:
		if a.err != nil {
			return protocol.Reply{}, &Unreachable{Address: address, Err: a.err}
		}
		var reply protocol.Reply
		if err := json.Unmarshal([]byte(a.raw), &reply); err != nil {
			return protocol.Reply{}, fmt.Errorf("editor at %s sent an unreadable reply: %w", address, err)
		}
		return reply, nil
	case <-time.After(RequestTimeout):
		return protocol.Reply{}, &Unreachable{Address: address, Err: fmt.Errorf("no reply within %s (is the editor suspended?)", RequestTimeout)}
	}
}
```

`internal/transport/dial_unix.go`:

```go
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
```

`internal/transport/dial_windows.go`:

```go
//go:build windows

package transport

import (
	"net"
	"strings"
	"time"

	"github.com/Microsoft/go-winio"
)

// dial connects to a named pipe (Neovim's default on Windows) or host:port.
func dial(address string, timeout time.Duration) (net.Conn, error) {
	if strings.HasPrefix(address, `\\.\pipe\`) {
		return winio.DialPipe(address, &timeout)
	}
	return net.DialTimeout("tcp", address, timeout)
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `go mod tidy && gofmt -l internal && GOOS=windows go vet ./internal/transport/ && go test ./internal/transport/`
Expected: no gofmt output, the Windows cross-vet passes, then `ok  	github.com/chanceygardener/show-me/internal/transport`

- [ ] **Step 6: Commit**

```bash
git add go.mod go.sum internal/transport
git commit -m "feat(transport): call Neovim's RPC server with deadlines a suspended editor can't hold" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The `show-me` command

**Files:**
- Create: `cmd/show-me/main.go`
- Test: `cmd/show-me/main_test.go`

**Interfaces:**
- Consumes:
  - `check.Title`, `check.View`, `*check.Rejection`
  - `registry.Locate`, `registry.Ranking`, `registry.Candidate`
  - `transport.Send`, `*transport.Unreachable`
  - every `protocol` type
- Produces: the binary's behavior.
  - Stdout lines are `deck <n>@<pid>`, `view <n>`, then `done <n>@<pid>` followed by `open: <hint>`.
  - Exit codes are as listed in Global Constraints.
  - Stderr lines are prefixed `show-me: `.
  - `var version` is set with `-ldflags "-X main.version=..."`.

- [ ] **Step 1: Write the failing test**

`cmd/show-me/main_test.go`:

```go
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/chanceygardener/show-me/internal/protocol"
	"github.com/chanceygardener/show-me/internal/registry"
	"github.com/chanceygardener/show-me/internal/transport"
)

// fakeEditor stands in for an editor at the transport boundary.
type fakeEditor struct {
	pid   int
	down  bool
	reply func(protocol.Request) protocol.Reply
	got   []protocol.Request
}

func ok(result any) protocol.Reply {
	data, _ := json.Marshal(result)
	return protocol.Reply{OK: true, Result: data}
}

// accepting is an editor that accepts every request.
func accepting(pid int) *fakeEditor {
	return &fakeEditor{pid: pid, reply: func(req protocol.Request) protocol.Reply {
		switch req.Command {
		case protocol.CommandDeck:
			return ok(protocol.DeckResult{Deck: 7})
		case protocol.CommandView:
			return ok(protocol.ViewResult{View: 2})
		case protocol.CommandDone:
			return ok(protocol.DoneResult{Deck: req.Deck, Views: 2, OpenHint: "<leader>v1"})
		default:
			return ok(protocol.StatusResult{Editor: "nvim", WorkspaceFolders: []string{"/w"}, Current: &protocol.CurrentDeck{Deck: 7, Title: "T", Views: 2}})
		}
	}}
}

type harness struct {
	app          *app
	out, err     *bytes.Buffer
	editors      []*fakeEditor
	incompatible []registry.Candidate
}

func newHarness(t *testing.T, editors ...*fakeEditor) *harness {
	h := &harness{out: &bytes.Buffer{}, err: &bytes.Buffer{}, editors: editors}
	h.app = &app{
		cwd:    t.TempDir(),
		stdout: h.out,
		stderr: h.err,
		locate: func(cwd string) (registry.Ranking, error) {
			r := registry.Ranking{Dir: "/registry", Targets: []string{cwd}, Incompatible: h.incompatible}
			for _, e := range h.editors {
				c := registry.Candidate{File: "nvim-" + strconv.Itoa(e.pid) + ".json", Entry: protocol.Entry{
					Protocol: protocol.Version, Editor: "nvim", PID: e.pid, WorkspaceFolders: []string{cwd},
					Transport: protocol.Transport{Kind: protocol.TransportNvim, Address: strconv.Itoa(e.pid)},
				}}
				r.All, r.Ranked = append(r.All, c), append(r.Ranked, c)
			}
			r.All = append(r.All, h.incompatible...)
			return r, nil
		},
		send: func(t protocol.Transport, req protocol.Request) (protocol.Reply, error) {
			for _, e := range h.editors {
				if strconv.Itoa(e.pid) != t.Address {
					continue
				}
				if e.down {
					return protocol.Reply{}, &transport.Unreachable{Address: t.Address, Err: errors.New("connection refused")}
				}
				e.got = append(e.got, req)
				return e.reply(req), nil
			}
			return protocol.Reply{}, errors.New("no such editor")
		},
	}
	return h
}

func (h *harness) run(args ...string) int {
	h.out.Reset()
	h.err.Reset()
	return h.app.run(args)
}

func (h *harness) file(t *testing.T, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(h.app.cwd, name), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func expect(t *testing.T, h *harness, code, want int, stdout string) {
	t.Helper()
	if code != want || h.out.String() != stdout {
		t.Fatalf("exit %d (want %d)\nstdout %q (want %q)\nstderr %q", code, want, h.out.String(), stdout, h.err.String())
	}
}

func TestDeck(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	expect(t, h, h.run("deck", "How login works"), exitOK, "deck 7@100\n")
	if req := e.got[0]; req.Protocol != protocol.Version || req.Title != "How login works" {
		t.Fatalf("sent %+v", req)
	}
}

func TestDeckBlankTitleNeverReachesTheEditor(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	expect(t, h, h.run("deck", "  "), exitRejected, "")
	if h.err.String() != "show-me: a deck needs a title\n" || len(e.got) != 0 {
		t.Fatalf("stderr %q, sent %d", h.err.String(), len(e.got))
	}
}

func TestView(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	h.file(t, "a.txt")
	h.file(t, "-dash.txt")
	expect(t, h, h.run("view", "7@100", "cols2", "--title", "Both", "a.txt:1", "--", "-dash.txt"), exitOK, "view 2\n")
	req := e.got[0]
	if req.Deck != 7 || req.View.Title != "Both" || len(req.View.Panes) != 2 || !strings.HasSuffix(req.View.Panes[1].Path, "-dash.txt") {
		t.Fatalf("sent %+v / %+v", req, req.View)
	}
	expect(t, h, h.run("view", "7", "single", "--title=Eq", "a.txt"), exitOK, "view 2\n")
	if e.got[1].View.Title != "Eq" {
		t.Fatalf("--title=: sent %+v", e.got[1].View)
	}
}

func TestViewUsageErrors(t *testing.T) {
	h := newHarness(t, accepting(100))
	h.file(t, "-dash.txt")
	for _, args := range [][]string{
		{"view", "7", "single", "-dash.txt"},
		{"view", "seven", "single", "a.txt"},
		{"view", "7@x", "single", "a.txt"},
		{"view", "7", "single", "a.txt", "--title"},
		{"view", "7"},
	} {
		if code := h.run(args...); code != exitUsage {
			t.Errorf("%v: exit %d, stderr %q", args, code, h.err.String())
		}
	}
	h.run("view", "7", "single", "-dash.txt")
	if !strings.Contains(h.err.String(), "put -- before panes") {
		t.Errorf("leading dash hint missing: %q", h.err.String())
	}
}

func TestViewRejectedByTheCLI(t *testing.T) {
	e := accepting(100)
	h := newHarness(t, e)
	h.file(t, "a.txt")
	expect(t, h, h.run("view", "7", "grid", "a.txt"), exitRejected, "")
	if want := "show-me: unknown layout \"grid\" (valid: single, cols2, cols3, main-stack)\n"; h.err.String() != want || len(e.got) != 0 {
		t.Fatalf("stderr %q, sent %d", h.err.String(), len(e.got))
	}
}

func TestEditorRejection(t *testing.T) {
	e := accepting(100)
	e.reply = func(protocol.Request) protocol.Reply { return protocol.Reply{Error: "unknown deck 99"} }
	h := newHarness(t, e)
	expect(t, h, h.run("done", "99"), exitRejected, "")
	if h.err.String() != "show-me: unknown deck 99\n" {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestDoneAndStatus(t *testing.T) {
	h := newHarness(t, accepting(100))
	expect(t, h, h.run("done", "7@100"), exitOK, "done 7@100\nopen: <leader>v1\n")
	expect(t, h, h.run("status"), exitOK, "editor: nvim (pid 100)\nworkspace: /w\ncurrent: deck 7@100 \"T\" (2 views)\n")
}

func TestUsageAndVersion(t *testing.T) {
	h := newHarness(t)
	if code := h.run(); code != exitUsage {
		t.Errorf("no args: exit %d", code)
	}
	if code := h.run("frobnicate"); code != exitUsage || !strings.Contains(h.err.String(), `unknown command "frobnicate"`) {
		t.Errorf("unknown command: exit %d, %q", code, h.err.String())
	}
	expect(t, h, h.run("version"), exitOK, "show-me dev (protocol 1)\n")
}

func TestNoEditors(t *testing.T) {
	h := newHarness(t)
	expect(t, h, h.run("deck", "x"), exitUnreachable, "")
	if !strings.Contains(h.err.String(), "no editor is serving") {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestFallsThroughAnUnreachableEditor(t *testing.T) {
	down, up := accepting(100), accepting(200)
	down.down = true
	h := newHarness(t, down, up)
	expect(t, h, h.run("deck", "x"), exitOK, "deck 7@200\n")
}

func TestAllEditorsUnreachable(t *testing.T) {
	a, b := accepting(100), accepting(200)
	a.down, b.down = true, true
	h := newHarness(t, a, b)
	expect(t, h, h.run("deck", "x"), exitUnreachable, "")
	if !strings.Contains(h.err.String(), "no editor answered") || !strings.Contains(h.err.String(), "connection refused") {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestHandleRoutesToItsEditor(t *testing.T) {
	first, owner := accepting(100), accepting(200)
	h := newHarness(t, first, owner)
	expect(t, h, h.run("done", "7@200"), exitOK, "done 7@200\nopen: <leader>v1\n")
	if len(first.got) != 0 || len(owner.got) != 1 {
		t.Fatalf("sent to first %d, owner %d", len(first.got), len(owner.got))
	}
}

func TestHandleForAnExitedEditor(t *testing.T) {
	h := newHarness(t, accepting(100))
	expect(t, h, h.run("done", "7@999"), exitUnreachable, "")
	if !strings.Contains(h.err.String(), "no longer running") {
		t.Fatalf("stderr %q", h.err.String())
	}
}

func TestProtocolMismatch(t *testing.T) {
	h := newHarness(t)
	h.incompatible = []registry.Candidate{{File: "nvim-300.json", Entry: protocol.Entry{Protocol: 2, Editor: "nvim", PID: 300}}}
	expect(t, h, h.run("deck", "x"), exitProtocol, "")
	if !strings.Contains(h.err.String(), "update the show-me CLI") {
		t.Fatalf("stderr %q", h.err.String())
	}

	e := accepting(100)
	e.reply = func(protocol.Request) protocol.Reply {
		return protocol.Reply{Error: "unsupported protocol 1 (this editor speaks 2)"}
	}
	h = newHarness(t, e)
	expect(t, h, h.run("deck", "x"), exitProtocol, "")
}

func TestEditors(t *testing.T) {
	h := newHarness(t, accepting(100), accepting(200))
	if code := h.run("editors"); code != exitOK {
		t.Fatalf("exit %d", code)
	}
	lines := strings.Split(strings.TrimSpace(h.out.String()), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "* nvim") || !strings.HasPrefix(lines[1], "  nvim") {
		t.Fatalf("stdout %q", h.out.String())
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./cmd/show-me/`
Expected: FAIL with `undefined: app` (and similar).

- [ ] **Step 3: Write the implementation**

`cmd/show-me/main.go`:

```go
// Command show-me lets coding agents illustrate an explanation in the user's
// editor: a deck of numbered views, each a layout of files with highlighted
// ranges, which the user opens at their own pace.
//
// protocol/PROTOCOL.md is the full contract; skills/show-me/SKILL.md is how
// agents are told to use it.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/chanceygardener/show-me/internal/check"
	"github.com/chanceygardener/show-me/internal/protocol"
	"github.com/chanceygardener/show-me/internal/registry"
	"github.com/chanceygardener/show-me/internal/transport"
)

// version is set at release time with -ldflags "-X main.version=...".
var version = "dev"

// Exit codes. Agents branch on these, so they never change meaning.
const (
	exitOK          = 0
	exitRejected    = 1
	exitUsage       = 2
	exitUnreachable = 3
	exitProtocol    = 4
)

const usage = `usage:
  show-me deck <title>
  show-me view <deck> <layout> [--title T] [--] <pane>...
  show-me done <deck>
  show-me status
  show-me editors
  show-me version

layouts: single (1 pane), cols2 (2), cols3 (3), main-stack (3-4)
pane:    path, path:N, or path:N-M
deck:    the handle "deck" printed, like 7@4242
exit:    0 ok, 1 rejected, 2 usage, 3 no reachable editor, 4 protocol mismatch
`

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "show-me:", err)
		os.Exit(exitUnreachable)
	}
	a := &app{cwd: cwd, stdout: os.Stdout, stderr: os.Stderr, locate: registry.Locate, send: transport.Send}
	os.Exit(a.run(os.Args[1:]))
}

// app is one CLI invocation. locate and send are fields so tests can stand
// in for the registry and the editor.
type app struct {
	cwd    string
	stdout io.Writer
	stderr io.Writer
	locate func(cwd string) (registry.Ranking, error)
	send   func(protocol.Transport, protocol.Request) (protocol.Reply, error)
}

// failure carries an exit code and a message out of a subcommand.
type failure struct {
	code int
	msg  string
}

func (f *failure) Error() string { return f.msg }

func fail(code int, format string, args ...any) *failure {
	return &failure{code: code, msg: fmt.Sprintf(format, args...)}
}

// handle names a deck and the editor holding it, printed as "7@4242". A bare
// "7" (pid 0) leaves the choice of editor to the registry's ranking.
type handle struct{ deck, pid int }

func (h handle) String() string { return fmt.Sprintf("%d@%d", h.deck, h.pid) }

func parseHandle(text string) (handle, error) {
	num, pid, qualified := strings.Cut(text, "@")
	bad := fail(exitUsage, "deck must look like 7@4242 or 7, got %q", text)
	deck, err := strconv.Atoi(num)
	if err != nil || deck < 1 {
		return handle{}, bad
	}
	h := handle{deck: deck}
	if qualified {
		if h.pid, err = strconv.Atoi(pid); err != nil || h.pid < 1 {
			return handle{}, bad
		}
	}
	return h, nil
}

func (a *app) run(args []string) int {
	if len(args) == 0 {
		fmt.Fprint(a.stderr, usage)
		return exitUsage
	}
	var err error
	switch args[0] {
	case "deck":
		err = a.deck(args[1:])
	case "view":
		err = a.view(args[1:])
	case "done":
		err = a.done(args[1:])
	case "status":
		err = a.status(args[1:])
	case "editors":
		err = a.editors(args[1:])
	case "version":
		fmt.Fprintf(a.stdout, "show-me %s (protocol %d)\n", version, protocol.Version)
	case "help", "-h", "--help":
		fmt.Fprint(a.stdout, usage)
	default:
		err = fail(exitUsage, "unknown command %q\n\n%s", args[0], usage)
	}
	return a.report(err)
}

// report prints err for the agent and returns the exit code it maps to.
func (a *app) report(err error) int {
	if err == nil {
		return exitOK
	}
	var rejection *check.Rejection
	if errors.As(err, &rejection) {
		fmt.Fprintln(a.stderr, "show-me:", rejection.Reason)
		return exitRejected
	}
	var f *failure
	if errors.As(err, &f) {
		fmt.Fprintln(a.stderr, "show-me:", strings.TrimRight(f.msg, "\n"))
		return f.code
	}
	fmt.Fprintln(a.stderr, "show-me:", err)
	return exitUnreachable
}

func (a *app) deck(args []string) error {
	if len(args) != 1 {
		return fail(exitUsage, "usage: show-me deck <title>")
	}
	if err := check.Title(args[0]); err != nil {
		return err
	}
	var result protocol.DeckResult
	editor, err := a.call(nil, protocol.Request{Command: protocol.CommandDeck, Title: args[0]}, &result)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "deck %s\n", handle{result.Deck, editor.Entry.PID})
	return nil
}

func (a *app) view(args []string) error {
	if len(args) < 2 {
		return fail(exitUsage, "usage: show-me view <deck> <layout> [--title T] [--] <pane>...")
	}
	h, err := parseHandle(args[0])
	if err != nil {
		return err
	}
	title, specs, err := splitViewArgs(args[2:])
	if err != nil {
		return err
	}
	view, err := check.View(args[1], specs, title, a.cwd)
	if err != nil {
		return err
	}
	var result protocol.ViewResult
	if _, err := a.call(&h, protocol.Request{Command: protocol.CommandView, Deck: h.deck, View: &view}, &result); err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "view %d\n", result.View)
	return nil
}

// splitViewArgs separates --title from the panes. Anything else starting with
// "-" before "--" is a usage error, so a typo never becomes a pane.
func splitViewArgs(args []string) (title string, panes []string, err error) {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--":
			return title, append(panes, args[i+1:]...), nil
		case arg == "--title":
			if i+1 >= len(args) {
				return "", nil, fail(exitUsage, "--title needs a value")
			}
			title = args[i+1]
			i++
		case strings.HasPrefix(arg, "--title="):
			title = strings.TrimPrefix(arg, "--title=")
		case strings.HasPrefix(arg, "-") && arg != "-":
			return "", nil, fail(exitUsage, "unknown option %s (put -- before panes that start with -)", arg)
		default:
			panes = append(panes, arg)
		}
	}
	return title, panes, nil
}

func (a *app) done(args []string) error {
	if len(args) != 1 {
		return fail(exitUsage, "usage: show-me done <deck>")
	}
	h, err := parseHandle(args[0])
	if err != nil {
		return err
	}
	var result protocol.DoneResult
	editor, err := a.call(&h, protocol.Request{Command: protocol.CommandDone, Deck: h.deck}, &result)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "done %s\nopen: %s\n", handle{result.Deck, editor.Entry.PID}, result.OpenHint)
	return nil
}

func (a *app) status(args []string) error {
	if len(args) != 0 {
		return fail(exitUsage, "usage: show-me status")
	}
	var result protocol.StatusResult
	editor, err := a.call(nil, protocol.Request{Command: protocol.CommandStatus}, &result)
	if err != nil {
		return err
	}
	fmt.Fprintf(a.stdout, "editor: %s (pid %d)\n", result.Editor, editor.Entry.PID)
	fmt.Fprintf(a.stdout, "workspace: %s\n", strings.Join(result.WorkspaceFolders, ", "))
	if c := result.Current; c != nil {
		fmt.Fprintf(a.stdout, "current: deck %s %q (%d views)\n", handle{c.Deck, editor.Entry.PID}, c.Title, c.Views)
	} else {
		fmt.Fprintln(a.stdout, "current: none")
	}
	return nil
}

func (a *app) editors(args []string) error {
	if len(args) != 0 {
		return fail(exitUsage, "usage: show-me editors")
	}
	ranking, err := a.locate(a.cwd)
	if err != nil {
		return fail(exitUnreachable, "reading the editor registry: %v", err)
	}
	if len(ranking.All) == 0 {
		fmt.Fprintf(a.stdout, "no editors registered in %s\n", ranking.Dir)
		return nil
	}
	for _, c := range ranking.All {
		mark := " "
		if len(ranking.Ranked) > 0 && ranking.Ranked[0].File == c.File {
			mark = "*"
		}
		fmt.Fprintf(a.stdout, "%s %-6s pid %-7d protocol %d  %s\n", mark, c.Entry.Editor, c.Entry.PID, c.Entry.Protocol, strings.Join(c.Entry.WorkspaceFolders, ", "))
	}
	return nil
}

// call sends req to the editor the handle names, or else to the best-ranked
// editor that answers, and decodes the result into out. It returns the
// editor that replied.
func (a *app) call(h *handle, req protocol.Request, out any) (registry.Candidate, error) {
	req.Protocol = protocol.Version
	ranking, err := a.locate(a.cwd)
	if err != nil {
		return registry.Candidate{}, fail(exitUnreachable, "reading the editor registry: %v", err)
	}
	candidates := ranking.Ranked
	if h != nil && h.pid != 0 {
		c, found := ranking.ByPID(h.pid)
		if !found {
			return registry.Candidate{}, fail(exitUnreachable, "the editor holding deck %s (pid %d) is no longer running; start a new deck", *h, h.pid)
		}
		if c.Entry.Protocol != protocol.Version {
			return registry.Candidate{}, protocolMismatch(c)
		}
		candidates = []registry.Candidate{c}
	}
	if len(candidates) == 0 {
		if len(ranking.Incompatible) > 0 {
			return registry.Candidate{}, protocolMismatch(ranking.Incompatible[0])
		}
		return registry.Candidate{}, fail(exitUnreachable, "no editor is serving %s (%d registered in %s; see `show-me editors`)",
			strings.Join(ranking.Targets, " or "), len(ranking.All), ranking.Dir)
	}

	var tried []string
	for _, c := range candidates {
		reply, err := a.send(c.Entry.Transport, req)
		if err != nil {
			tried = append(tried, fmt.Sprintf("%s pid %d: %v", c.Entry.Editor, c.Entry.PID, err))
			continue
		}
		if !reply.OK {
			if strings.HasPrefix(reply.Error, "unsupported protocol") {
				return c, fail(exitProtocol, "%s; update the show-me CLI or the editor plugin so they match", reply.Error)
			}
			return c, &check.Rejection{Reason: reply.Error}
		}
		if err := json.Unmarshal(reply.Result, out); err != nil {
			return c, fail(exitUnreachable, "%s pid %d sent an unreadable result: %v", c.Entry.Editor, c.Entry.PID, err)
		}
		return c, nil
	}
	return registry.Candidate{}, fail(exitUnreachable, "no editor answered:\n  %s", strings.Join(tried, "\n  "))
}

func protocolMismatch(c registry.Candidate) error {
	side := "the show-me CLI"
	if c.Entry.Protocol < protocol.Version {
		side = "the editor plugin"
	}
	return fail(exitProtocol, "%s pid %d speaks protocol %d, this CLI speaks %d; update %s",
		c.Entry.Editor, c.Entry.PID, c.Entry.Protocol, protocol.Version, side)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `gofmt -l cmd && go vet ./... && go test ./...`
Expected: no gofmt output, then `ok` for `cmd/show-me`, `internal/check`, `internal/protocol`, `internal/registry` and `internal/transport`.

- [ ] **Step 5: Commit**

```bash
git add cmd
git commit -m "feat(cli): add the show-me command with deck handles and stable exit codes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Neovim core: spec harness, config, store, state, rpc

**Files:**
- Create: `test/nvim/helpers.lua`, `test/nvim/run.sh`
- Create: `lua/show_me/util.lua`, `lua/show_me/config.lua`, `lua/show_me/store.lua`, `lua/show_me/state.lua`, `lua/show_me/rpc.lua`
- Test: `test/nvim/config_spec.lua`, `test/nvim/store_spec.lua`, `test/nvim/rpc_spec.lua`

**Interfaces:**
- Consumes: the protocol shapes from Task 1, as JSON.
- Produces:
  - `require('show_me.util').now_ms() -> integer`
  - `require('show_me.config')`: `options: ShowMeConfig`, `defaults()`, `apply(opts)`, `open_hint() -> string`
  - `require('show_me.store')`:
    - fields `MAX_VIEWS = 9`, `KEEP = 10`
    - functions `reject(fmt, ...)`, `is_rejection(err)`, `open(root) -> ShowMeStore`, `for_workspace(state_dir, folder) -> ShowMeStore`
    - `ShowMeStore` methods: `file`, `ids`, `load`, `save`, `get`, `create(title)`, `add_view(id, view)`, `finish(id)`, `list_done()`, `latest_done()`
  - `require('show_me.state')`: `set_workspace(dir?)`, `workspace()`, `store()`, `current()`, `set_current(deck)`
  - `require('show_me.rpc')`: `PROTOCOL = 1`, `handle(json) -> json`

- [ ] **Step 1: Write the spec harness**

`test/nvim/helpers.lua`:

```lua
--- Minimal assertions for specs run with `nvim --clean -l`.
---
--- Requiring this puts the repository on 'runtimepath' (so `require 'show_me'`
--- finds lua/show_me) and points SHOW_ME_HOME at a throwaway directory, so no
--- spec ever touches the real registry.

vim.opt.rtp:prepend(vim.fn.getcwd())
vim.env.SHOW_ME_HOME = vim.fn.tempname()

local M = {}

local failures = 0
local total = 0

---@param label string
---@param passed boolean
---@param detail? string
local function record(label, passed, detail)
  total = total + 1
  if passed then
    io.write('  ok   ', label, '\n')
  else
    failures = failures + 1
    io.write('  FAIL ', label, detail and ('  -> ' .. detail) or '', '\n')
  end
end

---@param actual any
---@param expected any
---@param label string
function M.eq(actual, expected, label)
  record(label, actual == expected, ('expected %s, got %s'):format(vim.inspect(expected), vim.inspect(actual)))
end

---@param value any
---@param label string
function M.ok(value, label)
  record(label, value and true or false, ('expected truthy, got %s'):format(vim.inspect(value)))
end

---@param value any
---@param label string
function M.nil_(value, label)
  record(label, value == nil, ('expected nil, got %s'):format(vim.inspect(value)))
end

---A fresh, empty directory.
---@return string
function M.tmpdir()
  local dir = vim.fn.tempname()
  vim.fn.mkdir(dir, 'p')
  return dir
end

--- Print the summary and exit with a status the shell can act on.
function M.done()
  io.write(('  %d/%d passed\n'):format(total - failures, total))
  os.exit(failures == 0 and 0 or 1)
end

return M
```

`test/nvim/run.sh` (then `chmod +x test/nvim/run.sh`):

```bash
#!/usr/bin/env bash
# Run the Neovim specs with no user config or plugins loaded.
#
#   ./test/nvim/run.sh           # every spec
#   ./test/nvim/run.sh render    # only specs whose file name contains "render"
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 1

filter="${1:-}"
status=0
for spec in test/nvim/*_spec.lua; do
  [ -e "$spec" ] || continue
  if [ -n "$filter" ] && [[ "$spec" != *"$filter"* ]]; then continue; fi
  echo "$(basename "$spec")"
  if ! nvim --clean -l "$spec"; then status=1; fi
done
if [ "$status" -eq 0 ]; then echo "all specs passed"; else echo "SPEC FAILURES"; fi
exit "$status"
```

- [ ] **Step 2: Write the failing specs**

`test/nvim/config_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local config = require 'show_me.config'

T.eq(config.open_hint(), '<leader>v1', 'default hint')
config.apply { keys = false }
T.eq(config.options.keys, false, 'keys = false survives merging')
T.eq(config.open_hint(), ':ShowMe 1', 'hint without keys')
config.apply { keys = { view_prefix = '<leader>s' } }
T.eq(config.open_hint(), '<leader>s1', 'custom prefix')
T.eq(config.options.keys.next, ']v', 'unset keys keep their defaults')
config.apply { sidebar = { filetypes = { 'oil' } } }
T.eq(table.concat(config.options.sidebar.filetypes, ','), 'oil', 'filetypes replace the default list')
T.ok(config.options.sidebar.open['neo-tree'], 'sidebar openers keep their defaults')
T.ok(config.defaults().state_dir:find('show-me', 1, true), 'decks live under stdpath state')

T.done()
```

`test/nvim/store_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local store = require 'show_me.store'

---Run `fn` and return its rejection reason, or nil if it succeeded.
---@return string|nil
local function rejection(fn, ...)
  local ok, err = pcall(fn, ...)
  if ok then
    return nil
  end
  return store.is_rejection(err) and tostring(err) or ('NOT A REJECTION: ' .. tostring(err))
end

---@type ShowMeView
local view = { layout = 'single', panes = { { path = '/x/a.lua', first = 1, last = 2 } } }

local root = T.tmpdir()
local s = store.open(root)
local d = s:create 'First'
T.eq(d.id, 1, 'first deck is 1')
T.eq(type(d.created_at), 'number', 'created_at is a number')
T.ok(d.created_at > 1700000000000, 'created_at is epoch milliseconds')
T.eq(d.done, false, 'new deck is not done')

T.eq(s:add_view(1, view), 1, 'first view is 1')
T.eq(s:add_view('1', view), 2, 'string ids accepted')
T.eq(rejection(s.add_view, s, 99, view), 'unknown deck 99', 'unknown deck')
T.eq(rejection(s.finish, s, s:create('Empty').id), 'deck 2 has no views', 'empty deck cannot finish')

T.nil_(s:latest_done(), 'no done decks yet')
s:finish(1)
T.eq(s:latest_done().id, 1, 'finished deck is latest done')
T.eq(rejection(s.add_view, s, 1, view), 'deck 1 is already done; start a new one', 'done deck is closed')

local full = s:create 'Full'
for _ = 1, store.MAX_VIEWS do
  s:add_view(full.id, view)
end
T.eq(rejection(s.add_view, s, full.id, view), ('deck %d already has 9 views, the most an editor can open by number'):format(full.id), 'view cap')

local loaded = store.open(root):get(1)
T.eq(loaded.title, 'First', 'title persisted')
T.eq(loaded.views[1].panes[1].first, 1, 'pane range persisted')
T.eq(loaded.done, true, 'done flag persisted')

vim.fn.writefile({ '{not json' }, root .. '/50.json')
T.ok(pcall(s.list_done, s), 'a corrupt deck file does not break listing')
T.eq(rejection(s.get, s, 50), 'unknown deck 50', 'a corrupt deck reads as unknown')

for i = 1, 12 do
  s:create('Bulk ' .. i)
end
local ids = s:ids()
T.eq(#ids, store.KEEP, 'only KEEP decks kept')
T.eq(s:create('Next').id, ids[#ids] + 1, 'ids keep increasing after pruning')

local a = s:create 'A'
s:add_view(a.id, view)
s:finish(a.id)
T.eq(s:list_done()[1].id, a.id, 'list_done is newest first')

local one, two = store.for_workspace(root, '/w/one'), store.for_workspace(root, '/w/two')
T.ok(one.root ~= two.root, 'each workspace has its own directory')
T.eq(one:create('x').id, 1, 'ids are per workspace')

T.done()
```

`test/nvim/rpc_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local rpc = require 'show_me.rpc'
local state = require 'show_me.state'

config.apply { state_dir = T.tmpdir() }
local workspace = T.tmpdir()
state.set_workspace(workspace)

local notes = {}
vim.notify = function(msg)
  notes[#notes + 1] = msg
end

---@param request table
---@return table reply
local function call(request)
  request.protocol = request.protocol or rpc.PROTOCOL
  return vim.json.decode(rpc.handle(vim.json.encode(request)))
end

local pane = { path = '/x/a.lua', first = 2, last = 3 }

local r = call { command = 'deck', title = 'Login flow' }
T.eq(r.ok, true, 'deck ok')
T.eq(r.result.deck, 1, 'deck id')
r = call { command = 'view', deck = 1, view = { layout = 'cols2', title = 'Both', panes = { pane, pane } } }
T.eq(r.result.view, 1, 'view number')
r = call { command = 'done', deck = 1 }
T.eq(r.result.deck, 1, 'done deck')
T.eq(r.result.views, 1, 'done view count')
T.eq(r.result.open_hint, '<leader>v1', 'done says how to open')
vim.wait(200, function()
  return #notes > 0
end)
T.eq(notes[1], 'show-me: Login flow · 1 view · <leader>v1', 'done notifies, without moving focus')
T.eq(state.current().id, 1, 'the done deck becomes current')

r = call { command = 'status' }
T.eq(r.result.editor, 'nvim', 'status editor')
T.eq(r.result.workspace_folders[1], vim.uv.fs_realpath(workspace), 'status workspace')
T.eq(r.result.current.title, 'Login flow', 'status current deck')

r = call { command = 'view', deck = 1, view = { layout = 'single', panes = { pane } } }
T.eq(r.ok, false, 'view to a done deck fails')
T.eq(r.error, 'deck 1 is already done; start a new one', 'editor-side rejection text')
T.eq(call({ command = 'nope' }).error, 'unknown command "nope"', 'unknown command')
T.eq(call({ command = 'status', protocol = 2 }).error, 'unsupported protocol 2 (this editor speaks 1)', 'protocol mismatch')
T.eq(vim.json.decode(rpc.handle('{oops')).error, 'request is not JSON', 'malformed request')

state.set_workspace(T.tmpdir())
T.eq(call({ command = 'status' }).result.current, vim.NIL, 'no current deck is null')

T.done()
```

- [ ] **Step 3: Run them to verify they fail**

Run: `./test/nvim/run.sh`
Expected: each spec fails with `module 'show_me.config' not found` (or `show_me.store`, `show_me.rpc`), then `SPEC FAILURES`.

- [ ] **Step 4: Write the implementation**

`lua/show_me/util.lua`:

```lua
--- Helpers shared by more than one show-me module.

local M = {}

---@return integer ms Milliseconds since the epoch
function M.now_ms()
  local sec, usec = vim.uv.gettimeofday()
  return sec * 1000 + math.floor(usec / 1000)
end

return M
```

`lua/show_me/config.lua`:

```lua
--- show-me options: their types, their defaults, and the merged result.
---
--- `setup(opts)` calls `apply`; every other module reads `options`.

local M = {}

---@class ShowMeKeys
---@field view_prefix string Followed by 1-9 to open that view
---@field next string
---@field prev string
---@field pick string
---@field close string

---@class ShowMeSidebarConfig
---@field filetypes string[] Windows with these filetypes are sidebars, kept beside views
---@field open table<string, fun()> How to open each sidebar in the show-me tab

---@class ShowMeConfig
---@field keys ShowMeKeys|false false: no mappings, only the `<Plug>` ones
---@field sidebar ShowMeSidebarConfig
---@field picker 'auto'|'snacks'|'select' auto: snacks if loaded, else vim.ui.select
---@field state_dir string Where decks are stored, one directory per workspace

---@return ShowMeConfig
function M.defaults()
  return {
    keys = { view_prefix = '<leader>v', next = ']v', prev = '[v', pick = '<leader>vd', close = '<leader>vq' },
    sidebar = {
      filetypes = { 'neo-tree', 'NvimTree' },
      open = {
        ['neo-tree'] = function()
          vim.cmd 'Neotree show'
        end,
        NvimTree = function()
          vim.cmd 'NvimTreeOpen'
        end,
      },
    },
    picker = 'auto',
    state_dir = vim.fs.joinpath(vim.fn.stdpath 'state', 'show-me'),
  }
end

---@type ShowMeConfig
M.options = M.defaults()

---Merge `opts` over the defaults. Lists replace rather than merge, so
---`sidebar.filetypes = { 'oil' }` means only oil.
---@param opts? table
---@return ShowMeConfig
function M.apply(opts)
  opts = opts or {}
  local merged = vim.tbl_deep_extend('force', M.defaults(), opts)
  if opts.sidebar and opts.sidebar.filetypes then
    merged.sidebar.filetypes = opts.sidebar.filetypes
  end
  M.options = merged
  return merged
end

---How the user opens view 1, for notifications and for agents.
---@return string
function M.open_hint()
  local keys = M.options.keys
  return keys and (keys.view_prefix .. '1') or ':ShowMe 1'
end

return M
```

`lua/show_me/store.lua`:

```lua
--- show-me decks on disk: one JSON file per deck, one directory per workspace.
---
--- The CLI has already checked layouts, panes and ranges. This module enforces
--- only what needs deck state (the deck exists, isn't done, has room for
--- another view) and keeps the newest `KEEP` decks. It never touches windows.

local util = require 'show_me.util'

local M = {}

--- Views are opened by number, 1-9, so a deck holds at most 9.
M.MAX_VIEWS = 9

--- Decks kept per workspace; older ones are deleted on each `create`.
M.KEEP = 10

---@class ShowMePane
---@field path string Absolute path
---@field first? integer 1-based first highlighted line
---@field last? integer 1-based last highlighted line, inclusive

---@class ShowMeView
---@field layout 'single'|'cols2'|'cols3'|'main-stack'
---@field title? string
---@field panes ShowMePane[]

---@class ShowMeDeck
---@field id integer Monotonic per workspace
---@field title string
---@field created_at integer Epoch milliseconds
---@field done boolean Only done decks are announced and can become current
---@field views ShowMeView[]

--- A request that deck state rules out. `rpc.handle` turns it into the reply's
--- `error`, which the CLI prints for the agent verbatim.
---@class ShowMeRejection
---@field reason string
local Rejection = {}
Rejection.__index = Rejection
Rejection.__tostring = function(self)
  return self.reason
end

---@param fmt string
---@param ... any
function M.reject(fmt, ...)
  error(setmetatable({ reason = fmt:format(...) }, Rejection), 0)
end

---@param err any
---@return boolean
function M.is_rejection(err)
  return getmetatable(err) == Rejection
end

---@class ShowMeStore
---@field root string
local Store = {}
Store.__index = Store

---@param root string
---@return ShowMeStore
function M.open(root)
  vim.fn.mkdir(root, 'p')
  return setmetatable({ root = root }, Store)
end

---The store for `folder`, keyed by the first 16 hex characters of its sha256.
---@param state_dir string
---@param folder string
---@return ShowMeStore
function M.for_workspace(state_dir, folder)
  return M.open(vim.fs.joinpath(state_dir, vim.fn.sha256(folder):sub(1, 16)))
end

---@param id integer
---@return string
function Store:file(id)
  return vim.fs.joinpath(self.root, ('%d.json'):format(id))
end

---@return integer[] ids Ascending
function Store:ids()
  local ids = {}
  for name in vim.fs.dir(self.root) do
    local id = name:match '^(%d+)%.json$'
    if id then
      ids[#ids + 1] = tonumber(id)
    end
  end
  table.sort(ids)
  return ids
end

---@param id integer
---@return ShowMeDeck|nil deck nil when the file is missing or corrupt
function Store:load(id)
  local read, lines = pcall(vim.fn.readfile, self:file(id))
  if not read or #lines == 0 then
    return nil
  end
  local decoded, deck = pcall(vim.json.decode, table.concat(lines, '\n'))
  return decoded and type(deck) == 'table' and deck or nil
end

---Write atomically, so a concurrent reader never sees half a deck.
---@param d ShowMeDeck
function Store:save(d)
  local file = self:file(d.id)
  vim.fn.writefile({ vim.json.encode(d) }, file .. '.tmp')
  assert(vim.uv.fs_rename(file .. '.tmp', file))
end

---@param id string|integer
---@return ShowMeDeck
function Store:get(id)
  local d = tonumber(id) and self:load(tonumber(id))
  if not d then
    M.reject('unknown deck %s', tostring(id))
  end
  return d
end

---Start a new deck and prune the oldest beyond `M.KEEP`.
---@param title string Already checked by the CLI
---@return ShowMeDeck
function Store:create(title)
  local ids = self:ids()
  ---@type ShowMeDeck
  local d = { id = (ids[#ids] or 0) + 1, title = title, created_at = util.now_ms(), done = false, views = {} }
  self:save(d)
  for i = 1, #ids + 1 - M.KEEP do
    os.remove(self:file(ids[i]))
  end
  return d
end

---@param id string|integer
---@param view ShowMeView Already checked by the CLI
---@return integer n The view's number within the deck
function Store:add_view(id, view)
  local d = self:get(id)
  if d.done then
    M.reject('deck %d is already done; start a new one', d.id)
  elseif #d.views >= M.MAX_VIEWS then
    M.reject('deck %d already has %d views, the most an editor can open by number', d.id, M.MAX_VIEWS)
  end
  table.insert(d.views, view)
  self:save(d)
  return #d.views
end

---@param id string|integer
---@return ShowMeDeck
function Store:finish(id)
  local d = self:get(id)
  if #d.views == 0 then
    M.reject('deck %d has no views', d.id)
  end
  d.done = true
  self:save(d)
  return d
end

---@return ShowMeDeck[] decks Newest first
function Store:list_done()
  local done = {}
  local ids = self:ids()
  for i = #ids, 1, -1 do
    local d = self:load(ids[i])
    if d and d.done then
      done[#done + 1] = d
    end
  end
  return done
end

---@return ShowMeDeck|nil
function Store:latest_done()
  return self:list_done()[1]
end

return M
```

`lua/show_me/state.lua`:

```lua
--- What this Neovim's show-me session knows: the workspace it serves, that
--- workspace's deck store, and the deck the view keys act on.

local config = require 'show_me.config'
local store = require 'show_me.store'

local M = {}

---@class ShowMeState
---@field workspace string|nil Symlink-resolved folder this Neovim serves
---@field store ShowMeStore|nil
---@field current ShowMeDeck|nil

---@type ShowMeState
local state = {}

---Serve `dir` (default: the global cwd). Forgets the old store and current deck.
---@param dir? string
---@return string workspace
function M.set_workspace(dir)
  dir = dir or vim.fn.getcwd(-1, -1)
  state = { workspace = vim.uv.fs_realpath(dir) or dir }
  return state.workspace
end

---@return string
function M.workspace()
  return state.workspace or M.set_workspace()
end

---@return ShowMeStore
function M.store()
  if not state.store then
    state.store = store.for_workspace(config.options.state_dir, M.workspace())
  end
  return state.store
end

---The deck the view keys act on: the last one picked or finished, else the
---newest done deck on disk.
---@return ShowMeDeck|nil
function M.current()
  state.current = state.current or M.store():latest_done()
  return state.current
end

---@param deck ShowMeDeck
function M.set_current(deck)
  state.current = deck
end

return M
```

`lua/show_me/rpc.lua`:

```lua
--- The show-me protocol endpoint. The CLI calls `handle` over Neovim's own RPC
--- server (`nvim_exec_lua`) with one JSON request and gets back one JSON
--- reply, shaped as in protocol/PROTOCOL.md.

local config = require 'show_me.config'
local state = require 'show_me.state'
local store = require 'show_me.store'

local M = {}

--- The protocol version this plugin speaks.
M.PROTOCOL = 1

---@class ShowMeRequest
---@field protocol integer
---@field command 'deck'|'view'|'done'|'status'
---@field title? string
---@field deck? integer
---@field view? ShowMeView

---@param d ShowMeDeck
local function announce(d)
  local count = #d.views
  vim.schedule(function()
    vim.notify(('show-me: %s · %d view%s · %s'):format(d.title, count, count == 1 and '' or 's', config.open_hint()), vim.log.levels.INFO)
  end)
end

---@type table<string, fun(req: ShowMeRequest): table>
local COMMANDS = {
  deck = function(req)
    return { deck = state.store():create(req.title).id }
  end,
  view = function(req)
    return { view = state.store():add_view(req.deck, req.view) }
  end,
  done = function(req)
    local d = state.store():finish(req.deck)
    state.set_current(d)
    announce(d)
    return { deck = d.id, views = #d.views, open_hint = config.open_hint() }
  end,
  status = function()
    local d = state.current()
    return {
      editor = 'nvim',
      workspace_folders = { state.workspace() },
      current = d and { deck = d.id, title = d.title, views = #d.views } or vim.NIL,
    }
  end,
}

---@param reason string
---@return string
local function failure(reason)
  return vim.json.encode { ok = false, error = reason }
end

---Answer one request. Never raises: every failure is an `ok = false` reply.
---@param json string
---@return string
function M.handle(json)
  local decoded, req = pcall(vim.json.decode, json)
  if not decoded or type(req) ~= 'table' then
    return failure 'request is not JSON'
  end
  if req.protocol ~= M.PROTOCOL then
    return failure(('unsupported protocol %s (this editor speaks %d)'):format(tostring(req.protocol), M.PROTOCOL))
  end
  local command = COMMANDS[req.command or '']
  if not command then
    return failure(('unknown command %q'):format(tostring(req.command)))
  end
  local ok, result = pcall(command, req)
  if ok then
    return vim.json.encode { ok = true, result = result }
  elseif store.is_rejection(result) then
    return failure(tostring(result))
  end
  return failure('internal error: ' .. tostring(result))
end

return M
```

- [ ] **Step 5: Run them to verify they pass**

Run: `./test/nvim/run.sh`
Expected: every line `ok`, then `all specs passed`.

- [ ] **Step 6: Commit**

```bash
git add test/nvim lua/show_me
git commit -m "feat(nvim): store decks per workspace and answer protocol requests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Neovim registry entry

**Files:**
- Create: `lua/show_me/registry.lua`
- Test: `test/nvim/registry_spec.lua`

**Interfaces:**
- Consumes:
  - `rpc.PROTOCOL`
  - `config.open_hint()`
  - `state.workspace()`
  - `util.now_ms()`
- Produces: `require('show_me.registry')` with
  - `base_dir() -> string`
  - `file() -> string`
  - `entry() -> ShowMeEntry`
  - `write() -> string|nil, string?`
  - `touch()`
  - `remove()`

- [ ] **Step 1: Write the failing spec**

`test/nvim/registry_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local registry = require 'show_me.registry'
local state = require 'show_me.state'

config.apply { state_dir = T.tmpdir() }
if vim.v.servername == '' then
  vim.fn.serverstart()
end

local home = vim.env.SHOW_ME_HOME
T.eq(registry.base_dir(), home, 'SHOW_ME_HOME overrides the base dir')
vim.env.SHOW_ME_HOME = ''
if vim.fn.has 'win32' == 1 then
  T.eq(registry.base_dir(), vim.fs.joinpath(vim.env.LOCALAPPDATA, 'show-me'), 'Windows base dir')
else
  vim.env.XDG_STATE_HOME = '/xdg'
  T.eq(registry.base_dir(), '/xdg/show-me', 'XDG_STATE_HOME base dir')
  vim.env.XDG_STATE_HOME = ''
  T.eq(registry.base_dir(), vim.fs.joinpath(vim.uv.os_homedir(), '.local', 'state', 'show-me'), 'default base dir')
end
vim.env.SHOW_ME_HOME = home

---@return table
local function read(file)
  return vim.json.decode(table.concat(vim.fn.readfile(file), '\n'))
end

local workspace = T.tmpdir()
state.set_workspace(workspace)
local file = assert(registry.write())
T.eq(file, vim.fs.joinpath(home, 'editors', ('nvim-%d.json'):format(vim.fn.getpid())), 'entry file named by pid')
local entry = read(file)
T.eq(entry.protocol, 1, 'protocol')
T.eq(entry.editor, 'nvim', 'editor')
T.eq(entry.pid, vim.fn.getpid(), 'pid')
T.eq(entry.transport.kind, 'nvim', 'transport kind')
T.eq(entry.transport.address, vim.v.servername, 'transport is the built-in server')
T.eq(entry.workspace_folders[1], vim.uv.fs_realpath(workspace), 'workspace is symlink-resolved')
T.eq(entry.open_hint, '<leader>v1', 'open hint')
T.ok(entry.started_at > 1700000000000, 'started_at is epoch milliseconds')
T.eq(entry.focused_at, entry.started_at, 'focused_at starts at started_at')
if vim.fn.has 'win32' == 0 then
  T.eq(vim.uv.fs_stat(file).mode % 512, tonumber('600', 8), 'entry is private')
  T.eq(vim.uv.fs_stat(vim.fs.dirname(file)).mode % 512, tonumber('700', 8), 'editors dir is private')
end

vim.wait(5)
registry.touch()
local touched = read(file)
T.ok(touched.focused_at > entry.focused_at, 'touch moves focused_at')
T.eq(touched.started_at, entry.started_at, 'touch keeps started_at')

registry.remove()
T.nil_(vim.uv.fs_stat(file), 'remove deletes the entry')

T.done()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `./test/nvim/run.sh registry`
Expected: `module 'show_me.registry' not found`, then `SPEC FAILURES`.

- [ ] **Step 3: Write the implementation**

`lua/show_me/registry.lua`:

```lua
--- This Neovim's entry in the show-me registry, which is how the CLI finds it.
---
--- One JSON file per running editor under `<base>/editors/`, private to the
--- user. The entry points at Neovim's own RPC server (`v:servername`), so
--- show-me starts no server of its own.

local config = require 'show_me.config'
local rpc = require 'show_me.rpc'
local state = require 'show_me.state'
local util = require 'show_me.util'

local M = {}

---@class ShowMeTransport
---@field kind 'nvim'
---@field address string

---@class ShowMeEntry
---@field protocol integer
---@field editor 'nvim'
---@field pid integer
---@field workspace_folders string[]
---@field transport ShowMeTransport
---@field open_hint string
---@field started_at integer Epoch milliseconds
---@field focused_at integer Epoch milliseconds

---@type integer|nil
local started_at
---@type integer|nil
local focused_at

---show-me's home, shared with the CLI. Empty variables count as unset.
---@return string
function M.base_dir()
  local override = vim.env.SHOW_ME_HOME
  if override and override ~= '' then
    return override
  end
  if vim.fn.has 'win32' == 1 then
    return vim.fs.joinpath(vim.env.LOCALAPPDATA, 'show-me')
  end
  local state_home = vim.env.XDG_STATE_HOME
  if not state_home or state_home == '' then
    state_home = vim.fs.joinpath(vim.uv.os_homedir(), '.local', 'state')
  end
  return vim.fs.joinpath(state_home, 'show-me')
end

---@return string
function M.file()
  return vim.fs.joinpath(M.base_dir(), 'editors', ('nvim-%d.json'):format(vim.fn.getpid()))
end

---@return ShowMeEntry
function M.entry()
  return {
    protocol = rpc.PROTOCOL,
    editor = 'nvim',
    pid = vim.fn.getpid(),
    workspace_folders = { state.workspace() },
    transport = { kind = 'nvim', address = vim.v.servername },
    open_hint = config.open_hint(),
    started_at = started_at,
    focused_at = focused_at,
  }
end

---@param dir string
local function private_dir(dir)
  vim.fn.mkdir(dir, 'p')
  if vim.fn.has 'win32' == 0 then
    vim.uv.fs_chmod(dir, tonumber('700', 8))
  end
end

---Write (or rewrite) the entry atomically.
---@return string|nil file
---@return string|nil reason Why there is no entry
function M.write()
  if vim.v.servername == '' then
    return nil, 'Neovim has no RPC server (was it started with --listen "")?'
  end
  started_at = started_at or util.now_ms()
  focused_at = focused_at or started_at
  local file = M.file()
  private_dir(M.base_dir())
  private_dir(vim.fs.dirname(file))
  local tmp = file .. '.tmp'
  local fd = assert(vim.uv.fs_open(tmp, 'w', tonumber('600', 8)))
  vim.uv.fs_write(fd, vim.json.encode(M.entry()))
  vim.uv.fs_close(fd)
  assert(vim.uv.fs_rename(tmp, file))
  return file
end

---Record that the user is looking at this Neovim, so it wins ties.
function M.touch()
  focused_at = util.now_ms()
  M.write()
end

function M.remove()
  os.remove(M.file())
end

return M
```

- [ ] **Step 4: Run it to verify it passes**

Run: `./test/nvim/run.sh`
Expected: every line `ok`, then `all specs passed`.

- [ ] **Step 5: Commit**

```bash
git add lua/show_me/registry.lua test/nvim/registry_spec.lua
git commit -m "feat(nvim): register Neovim's own RPC server so the CLI can find it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Layouts and the show-me tab, with sidebars

**Files:**
- Create: `lua/show_me/layout.lua`, `lua/show_me/render.lua`
- Test: `test/nvim/layout_spec.lua`, `test/nvim/render_spec.lua`

**Interfaces:**
- Consumes: `config.options.sidebar`, and the `ShowMeDeck`/`ShowMeView`/`ShowMePane` shapes
- Produces:
  - `require('show_me.layout').build(name, count) -> integer[]`, the windows in pane order, split from the current window
  - `require('show_me.render')` with field `NS` and functions `tab()`, `position()`, `open(deck, n)`, `step(delta)`, `clear()`, `close()`, `on_tab_closed()`

- [ ] **Step 1: Write the failing specs**

`test/nvim/layout_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local layout = require 'show_me.layout'

---Build `name` in a fresh tab.
---@return integer[] wins
---@return table tree `winlayout()` of the tab
local function build(name, count)
  vim.cmd 'tabnew'
  local wins = layout.build(name, count)
  return wins, vim.fn.winlayout()
end

local wins, tree = build('single', 1)
T.eq(#wins, 1, 'single: one window')
T.eq(tree[1], 'leaf', 'single: one leaf')

wins, tree = build('cols3', 3)
T.eq(tree[1], 'row', 'cols3: a row')
T.eq(#tree[2], 3, 'cols3: three columns')
for i = 1, 3 do
  T.eq(tree[2][i][2], wins[i], ('cols3: pane %d is column %d'):format(i, i))
end

wins, tree = build('main-stack', 4)
T.eq(tree[1], 'row', 'main-stack: a row')
T.eq(tree[2][1][2], wins[1], 'main-stack: pane 1 is the left column')
T.eq(tree[2][2][1], 'col', 'main-stack: right side is a column')
T.eq(#tree[2][2][2], 3, 'main-stack: three stacked panes')
for i = 2, 4 do
  T.eq(tree[2][2][2][i - 1][2], wins[i], ('main-stack: pane %d is stack row %d'):format(i, i - 1))
end

-- main-stack takes 60% of the window it starts from, not of the whole screen.
vim.cmd 'tabnew'
vim.cmd 'topleft 20vnew'
local side = vim.api.nvim_get_current_win()
vim.wo[side].winfixwidth = true
vim.cmd 'wincmd l'
local available = vim.api.nvim_win_get_width(0)
wins = layout.build('main-stack', 3)
T.eq(vim.api.nvim_win_get_width(side), 20, 'main-stack leaves a fixed-width sidebar alone')
T.eq(vim.api.nvim_win_get_width(wins[1]), math.floor(available * 0.6), 'main pane is 60% of the available width')

-- Geometry must not depend on the user's split options.
vim.o.splitright, vim.o.splitbelow = false, false
wins, tree = build('cols2', 2)
T.eq(tree[2][1][2], wins[1], 'cols2: pane 1 stays left with splitright off')
wins, tree = build('main-stack', 3)
T.eq(tree[2][2][2][1][2], wins[2], 'main-stack: pane 2 stays on top with splitbelow off')

T.done()
```

`test/nvim/render_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local render = require 'show_me.render'

local function numbered(n)
  return vim.tbl_map(tostring, vim.fn.range(1, n))
end

local a = vim.fn.tempname() .. '.lua'
local b = vim.fn.tempname() .. '.lua'
vim.fn.writefile(numbered(100), a)
vim.fn.writefile(numbered(10), b) -- the deck below claims lines 15-40: the file "shrank"

---@type ShowMeDeck
local d = {
  id = 1,
  title = 'Demo 100%',
  created_at = 0,
  done = true,
  views = {
    { layout = 'cols2', title = 'Same file', panes = { { path = a, first = 10, last = 12 }, { path = a, first = 50, last = 55 } } },
    { layout = 'single', panes = { { path = b, first = 15, last = 40 } } },
  },
}

local home = vim.api.nvim_get_current_tabpage()
render.open(d, 1)
local tab = render.tab()
T.ok(tab and tab ~= home, 'views open in their own tab')

local wins = vim.api.nvim_tabpage_list_wins(tab)
T.eq(#wins, 2, 'cols2 has two panes')
local buf = vim.api.nvim_win_get_buf(wins[1])
T.eq(vim.api.nvim_win_get_buf(wins[2]), buf, 'both panes show the same buffer')
T.eq(#vim.api.nvim_buf_get_extmarks(buf, render.NS, 0, -1, {}), 2, 'both ranges in a shared buffer stay highlighted')
T.eq(vim.api.nvim_win_get_cursor(wins[1])[1], 10, 'pane 1 cursor at its range')
T.eq(vim.api.nvim_win_get_cursor(wins[2])[1], 50, 'pane 2 cursor at its range')
T.ok(vim.wo[wins[1]].winbar:find('1/2', 1, true), 'winbar shows position')
T.ok(vim.wo[wins[1]].winbar:find('Same file', 1, true), 'winbar shows view title')
T.eq(vim.api.nvim_get_current_win(), wins[1], 'focus lands on pane 1')

render.step(1)
T.eq(render.position().view, 2, ']v moves to view 2')
wins = vim.api.nvim_tabpage_list_wins(render.tab())
T.eq(#wins, 1, 'single has one pane')
T.eq(vim.api.nvim_win_get_cursor(wins[1])[1], 10, 'range past EOF clamps to the last line')
T.ok(vim.wo[wins[1]].winbar:find('Demo 100%%', 1, true), 'falls back to deck title, with % escaped')

render.step(1)
T.eq(render.position().view, 2, ']v at the last view stays put')

vim.api.nvim_set_current_tabpage(home)
render.step(-1)
T.eq(render.position().view, 2, '[v does nothing outside the show-me tab')

render.open(d, 1)
local count = 0
for _, t in ipairs(vim.api.nvim_list_tabpages()) do
  count = count + (vim.t[t].show_me and 1 or 0)
end
T.eq(count, 1, 'reopening reuses the single show-me tab')

render.close()
T.nil_(render.tab(), 'close removes the show-me tab')
T.nil_(render.position(), 'close forgets the position')
T.eq(#vim.api.nvim_buf_get_extmarks(buf, render.NS, 0, -1, {}), 0, 'close clears highlights')

-- Sidebars ---------------------------------------------------------------

local mirror_side = 'topleft'

---Open a 30-column fake sidebar on `side` of the current tab.
---@param side 'topleft'|'botright'
---@return integer win
local function open_tree(side)
  vim.cmd(side .. ' 30vnew')
  vim.bo.buftype = 'nofile'
  vim.bo.bufhidden = 'wipe'
  vim.bo.filetype = 'fake-tree'
  return vim.api.nvim_get_current_win()
end

config.apply {
  sidebar = {
    filetypes = { 'fake-tree' },
    open = {
      ['fake-tree'] = function()
        open_tree(mirror_side)
      end,
    },
  },
}

---@param t integer
---@return integer[] sidebars
---@return integer[] panes
local function split_wins(t)
  local sidebars, panes = {}, {}
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(t)) do
    local list = vim.bo[vim.api.nvim_win_get_buf(w)].filetype == 'fake-tree' and sidebars or panes
    list[#list + 1] = w
  end
  return sidebars, panes
end

---@param t integer
local function close_panes(t)
  for _, w in ipairs(select(2, split_wins(t))) do
    vim.api.nvim_win_close(w, true)
  end
end

---@type ShowMeDeck
local three = {
  id = 2,
  title = 'Three',
  created_at = 0,
  done = true,
  views = {
    { layout = 'cols3', panes = { { path = a }, { path = a }, { path = b } } },
    { layout = 'single', panes = { { path = b } } },
  },
}

vim.api.nvim_set_current_tabpage(home)
open_tree 'topleft'
vim.cmd 'wincmd l'
render.open(three, 1)
local sidebars, panes = split_wins(render.tab())
T.eq(#sidebars, 1, 'a sidebar in the user tab is mirrored into the show-me tab')
T.eq(#panes, 3, 'cols3 still has three panes beside the sidebar')
T.eq(vim.api.nvim_win_get_width(sidebars[1]), 30, 'the sidebar keeps its width')
local widths = vim.tbl_map(vim.api.nvim_win_get_width, panes)
T.ok(math.max(unpack(widths)) - math.min(unpack(widths)) <= 1, 'cols3 splits the remaining width evenly')
T.ok(not vim.tbl_contains(sidebars, vim.api.nvim_get_current_win()), 'focus lands on a pane, not the sidebar')

render.step(1)
sidebars, panes = split_wins(render.tab())
T.eq(#sidebars, 1, 'the sidebar survives switching views')
T.eq(#panes, 1, 'single has one pane beside the sidebar')

close_panes(render.tab())
render.step(-1)
sidebars, panes = split_wins(render.tab())
T.eq(#panes, 3, 'a tab left with only a sidebar gets its panes back')
T.eq(vim.api.nvim_win_get_position(sidebars[1])[2], 0, 'a left sidebar stays on the left')

-- A right-hand sidebar: rebuilt panes open to its left.
render.close()
vim.api.nvim_set_current_tabpage(home)
for _, w in ipairs((split_wins(home))) do
  vim.api.nvim_win_close(w, true)
end
mirror_side = 'botright'
open_tree 'botright'
vim.cmd 'wincmd h'
render.open(three, 2)
close_panes(render.tab())
render.step(-1)
sidebars, panes = split_wins(render.tab())
local side_col = vim.api.nvim_win_get_position(sidebars[1])[2]
T.ok(
  vim.iter(panes):all(function(w)
    return vim.api.nvim_win_get_position(w)[2] < side_col
  end),
  'panes open left of a right-hand sidebar'
)

-- No sidebar in the user tab means none in the show-me tab.
render.close()
vim.api.nvim_set_current_tabpage(home)
for _, w in ipairs((split_wins(home))) do
  vim.api.nvim_win_close(w, true)
end
render.open(three, 1)
sidebars = split_wins(render.tab())
T.eq(#sidebars, 0, 'no sidebar in the user tab means none in the show-me tab')

T.done()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `./test/nvim/run.sh layout && ./test/nvim/run.sh render`
Expected: `module 'show_me.layout' not found` / `module 'show_me.render' not found`, then `SPEC FAILURES`.

- [ ] **Step 3: Write the implementation**

`lua/show_me/layout.lua`:

```lua
--- The four show-me layouts, and how to build each from the current window.
---
--- The CLI has already checked names and pane counts. Splits name their
--- direction explicitly so 'splitright'/'splitbelow' never change the
--- geometry, and widths are shares of the window the layout starts from, so a
--- fixed-width sidebar beside it keeps its space.

local M = {}

--- Share of the available width the primary pane of `main-stack` takes.
local MAIN_SHARE = 0.6

---@param win integer
---@param direction 'right'|'below'
---@return integer
local function split(win, direction)
  return vim.api.nvim_open_win(0, false, { split = direction, win = win })
end

---@param count integer
---@return integer[]
local function columns(count)
  local wins = { vim.api.nvim_get_current_win() }
  for i = 2, count do
    wins[i] = split(wins[i - 1], 'right')
  end
  vim.cmd 'wincmd ='
  return wins
end

---@param count integer
---@return integer[]
local function main_stack(count)
  local main = vim.api.nvim_get_current_win()
  local available = vim.api.nvim_win_get_width(main)
  local wins = { main, split(main, 'right') }
  for i = 3, count do
    wins[i] = split(wins[i - 1], 'below')
  end
  vim.cmd 'wincmd ='
  vim.api.nvim_win_set_width(main, math.floor(available * MAIN_SHARE))
  return wins
end

---@type table<string, fun(count: integer): integer[]>
local BUILDERS = { single = columns, cols2 = columns, cols3 = columns, ['main-stack'] = main_stack }

---Split the current window into layout `name`.
---@param name string
---@param count integer
---@return integer[] wins Window ids in pane order
function M.build(name, count)
  local builder = assert(BUILDERS[name], 'show-me: unknown layout ' .. tostring(name))
  return builder(count)
end

return M
```

`lua/show_me/render.lua`:

```lua
--- Draws show-me views in one dedicated tab, rebuilt per view.
---
--- Panes hold real file buffers, so LSP, `gd` and edits work as usual. Ranges
--- are marked with `ShowMeRange` (linked to Visual by default) and scrolled to
--- the top of their pane. Sidebars (`config.sidebar`) are mirrored from the
--- user's tab when the show-me tab is created and kept across view switches.
--- The user's own tabs are never touched.

local config = require 'show_me.config'
local layout = require 'show_me.layout'

local M = {}

M.NS = vim.api.nvim_create_namespace 'show_me'

---@class ShowMePosition
---@field deck ShowMeDeck
---@field view integer

---@type ShowMePosition|nil
local position

---@return integer|nil
function M.tab()
  for _, tab in ipairs(vim.api.nvim_list_tabpages()) do
    if vim.t[tab].show_me then
      return tab
    end
  end
end

---@return ShowMePosition|nil
function M.position()
  return position
end

---@param win integer
---@return boolean
local function is_sidebar(win)
  return vim.tbl_contains(config.options.sidebar.filetypes, vim.bo[vim.api.nvim_win_get_buf(win)].filetype)
end

---Filetypes of the sidebars shown in `tab`, in window order, without repeats.
---@param tab integer
---@return string[]
local function sidebars_in(tab)
  local found = {}
  for _, win in ipairs(vim.api.nvim_tabpage_list_wins(tab)) do
    local ft = vim.bo[vim.api.nvim_win_get_buf(win)].filetype
    if is_sidebar(win) and not vim.tbl_contains(found, ft) then
      found[#found + 1] = ft
    end
  end
  return found
end

--- Create the show-me tab and open in it the sidebars the user's tab shows.
local function create_tab()
  local wanted = sidebars_in(vim.api.nvim_get_current_tabpage())
  vim.cmd 'tabnew'
  vim.bo.bufhidden = 'wipe'
  vim.t.show_me = true
  for _, ft in ipairs(wanted) do
    local open = config.options.sidebar.open[ft]
    if open then
      local ok, err = pcall(open)
      if not ok then
        vim.notify(('show-me: could not open the %s sidebar: %s'):format(ft, err), vim.log.levels.DEBUG)
      end
    end
  end
end

---A fresh, empty pane beside `side`, for a tab that only has sidebars left.
---@param side integer
---@return integer win
local function pane_beside(side)
  local leftmost = vim.api.nvim_win_get_position(side)[2] == 0
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].bufhidden = 'wipe'
  return vim.api.nvim_open_win(buf, true, { split = leftmost and 'right' or 'left', win = side })
end

--- Switch to the show-me tab (creating it if needed) and reduce it to its
--- sidebars plus one pane, which becomes current for the layout to split.
local function reset_tab()
  local tab = M.tab()
  if tab then
    vim.api.nvim_set_current_tabpage(tab)
  else
    create_tab()
  end
  local sidebars, panes = {}, {}
  for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if is_sidebar(win) then
      sidebars[#sidebars + 1] = win
    else
      panes[#panes + 1] = win
    end
  end
  for _, win in ipairs(sidebars) do
    vim.wo[win].winfixwidth = true
  end
  local main = panes[1] or pane_beside(sidebars[1])
  for i = 2, #panes do
    vim.api.nvim_win_close(panes[i], true)
  end
  vim.api.nvim_set_current_win(main)
  vim.wo[main].winfixwidth = false
end

---@param deck ShowMeDeck
---@param n integer
---@param pane ShowMePane
---@return string
local function winbar(deck, n, pane)
  local where = vim.fn.fnamemodify(pane.path, ':~:.')
  if pane.first then
    where = ('%s:%d-%d'):format(where, pane.first, pane.last)
  end
  local text = ('%d/%d · %s · %s'):format(n, #deck.views, deck.views[n].title or deck.title, where)
  return (text:gsub('%%', '%%%%'))
end

---Load `pane` into `win`, highlight its range and scroll it to the top.
---@param win integer
---@param pane ShowMePane
local function show_pane(win, pane)
  -- bufload, unlike :edit, never stops on a swap-file prompt.
  local buf = vim.fn.bufadd(pane.path)
  vim.fn.bufload(buf)
  vim.bo[buf].buflisted = true
  vim.api.nvim_win_set_buf(win, buf)
  if not pane.first then
    return
  end

  -- The file may have shrunk since the agent made the deck.
  local first = math.min(pane.first, vim.api.nvim_buf_line_count(buf))
  vim.api.nvim_buf_set_extmark(buf, M.NS, first - 1, 0, {
    end_row = pane.last,
    hl_group = 'ShowMeRange',
    hl_eol = true,
    strict = false,
  })
  vim.api.nvim_win_set_cursor(win, { first, 0 })
  vim.api.nvim_win_call(win, function()
    vim.cmd 'normal! zt'
  end)
end

---@param deck ShowMeDeck
---@param n integer
function M.open(deck, n)
  local view = assert(deck.views[n], 'show-me: no such view')
  vim.api.nvim_set_hl(0, 'ShowMeRange', { link = 'Visual', default = true })
  M.clear()
  reset_tab()
  local wins = layout.build(view.layout, #view.panes)
  for i, pane in ipairs(view.panes) do
    show_pane(wins[i], pane)
    vim.wo[wins[i]].winbar = winbar(deck, n, pane)
  end
  vim.api.nvim_set_current_win(wins[1])
  position = { deck = deck, view = n }
end

---Move `delta` views through the deck on screen. Only acts in the show-me tab.
---@param delta integer
function M.step(delta)
  if not position or vim.api.nvim_get_current_tabpage() ~= M.tab() then
    return
  end
  local n = position.view + delta
  if position.deck.views[n] then
    M.open(position.deck, n)
  end
end

--- Remove every show-me highlight.
function M.clear()
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) then
      vim.api.nvim_buf_clear_namespace(buf, M.NS, 0, -1)
    end
  end
end

function M.close()
  local tab = M.tab()
  if not tab then
    return
  end
  if #vim.api.nvim_list_tabpages() == 1 then
    vim.cmd 'tabnew'
  end
  vim.cmd('tabclose ' .. vim.api.nvim_tabpage_get_number(tab))
  M.on_tab_closed()
end

--- TabClosed handler: once the show-me tab is gone, however it was closed,
--- drop its highlights so they don't linger in the user's own windows.
function M.on_tab_closed()
  if not M.tab() then
    M.clear()
    position = nil
  end
end

return M
```

- [ ] **Step 4: Run them to verify they pass**

Run: `./test/nvim/run.sh`
Expected: every line `ok`, then `all specs passed`.

- [ ] **Step 5: Commit**

```bash
git add lua/show_me/layout.lua lua/show_me/render.lua test/nvim/layout_spec.lua test/nvim/render_spec.lua
git commit -m "feat(nvim): render views in their own tab, keeping sidebars beside them" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `setup()`, keys, commands, picker, sessions, health

**Files:**
- Create: `lua/show_me/init.lua`, `lua/show_me/health.lua`
- Test: `test/nvim/init_spec.lua`, `test/nvim/keys_spec.lua`, `test/nvim/session_spec.lua`

**Interfaces:**
- Consumes: everything from Tasks 6–8
- Produces: `require('show_me')` with
  - `setup(opts)`, `open(n)`, `step(delta)`, `pick()`, `close()`, `status()`
  - augroup `show_me`
  - `<Plug>(show-me-view-1)` through `<Plug>(show-me-view-9)`, plus `<Plug>(show-me-next)`, `<Plug>(show-me-prev)`, `<Plug>(show-me-pick)` and `<Plug>(show-me-close)`
  - `:ShowMe [n]`
  - `:checkhealth show_me`

- [ ] **Step 1: Write the failing specs**

`test/nvim/init_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local registry = require 'show_me.registry'
local show_me = require 'show_me'

if vim.v.servername == '' then
  vim.fn.serverstart()
end
show_me.setup { state_dir = T.tmpdir() }
if vim.v.vim_did_enter == 0 then
  vim.api.nvim_exec_autocmds('VimEnter', { group = 'show_me' })
end

---@return table
local function entry()
  return vim.json.decode(table.concat(vim.fn.readfile(registry.file()), '\n'))
end

T.ok(vim.uv.fs_stat(registry.file()), 'setup registers this Neovim')
T.ok(vim.fn.maparg('<leader>v1', 'n') ~= '', 'default keys map <leader>v1')
T.ok(vim.fn.maparg('<leader>v9', 'n') ~= '', 'default keys map <leader>v9')
T.ok(vim.fn.maparg(']v', 'n') ~= '', 'default keys map ]v')
T.ok(vim.fn.maparg('<leader>vq', 'n') ~= '', 'default keys map <leader>vq')
T.ok(vim.fn.maparg('<Plug>(show-me-view-9)', 'n') ~= '', '<Plug> mappings exist')
T.eq(vim.fn.exists ':ShowMe', 2, ':ShowMe exists')

local dir = T.tmpdir()
vim.cmd.cd(dir)
T.eq(entry().workspace_folders[1], vim.uv.fs_realpath(dir), ':cd updates the registered workspace')

local before = entry().focused_at
vim.wait(5)
vim.api.nvim_exec_autocmds('FocusGained', { group = 'show_me' })
T.ok(entry().focused_at > before, 'FocusGained updates focused_at')
vim.api.nvim_exec_autocmds('FocusGained', { group = 'show_me' })
T.ok(#vim.api.nvim_get_autocmds { group = 'show_me', event = 'FocusGained' } == 1, 'the FocusGained handler survives being run')

T.ok(show_me.status():find('current: none', 1, true), 'status reports no deck yet')

vim.api.nvim_exec_autocmds('VimLeavePre', { group = 'show_me' })
T.nil_(vim.uv.fs_stat(registry.file()), 'leaving Neovim removes the entry')

T.done()
```

`test/nvim/keys_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local config = require 'show_me.config'
local show_me = require 'show_me'

show_me.setup { state_dir = T.tmpdir(), keys = false }
T.eq(vim.fn.maparg('<leader>v1', 'n'), '', 'keys = false defines no mappings')
T.ok(vim.fn.maparg('<Plug>(show-me-view-1)', 'n') ~= '', '<Plug> mappings still exist')
T.eq(config.open_hint(), ':ShowMe 1', 'the hint names the command instead')

T.done()
```

`test/nvim/session_spec.lua`:

```lua
local T = require 'test.nvim.helpers'
local render = require 'show_me.render'
local show_me = require 'show_me'

show_me.setup { state_dir = T.tmpdir() }

local file = vim.fn.tempname() .. '.lua'
vim.fn.writefile({ 'one', 'two' }, file)
render.open({ id = 1, title = 'S', created_at = 0, done = true, views = { { layout = 'single', panes = { { path = file } } } } }, 1)
T.ok(render.tab(), 'the show-me tab is open')

-- The show-me tab is transient and t:show_me isn't saved, so a restored copy
-- would be an orphan. Any session plugin built on :mksession fires this.
vim.cmd('mksession! ' .. vim.fn.fnameescape(vim.fn.tempname() .. '.vim'))
T.nil_(render.tab(), 'writing a session closes the show-me tab first')

T.done()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `./test/nvim/run.sh init && ./test/nvim/run.sh keys && ./test/nvim/run.sh session`
Expected: `module 'show_me' not found`, then `SPEC FAILURES`.

- [ ] **Step 3: Write the implementation**

`lua/show_me/init.lua`:

```lua
--- show-me: lets terminal coding agents illustrate explanations in this Neovim.
---
--- An agent runs the `show-me` CLI, which finds this Neovim through its
--- registry entry (`registry.lua`) and calls `rpc.handle` over Neovim's own
--- RPC server. Agents build a *deck* of numbered *views*; the user opens them
--- at their own pace. Nothing here ever moves focus on its own.

local config = require 'show_me.config'
local registry = require 'show_me.registry'
local render = require 'show_me.render'
local state = require 'show_me.state'

local M = {}

---Open view `n` of the current deck.
---@param n integer
function M.open(n)
  local d = state.current()
  if not d then
    vim.notify('show-me: no deck yet; ask an agent to show you something', vim.log.levels.WARN)
  elseif not d.views[n] then
    vim.notify(('show-me: "%s" has %d view%s'):format(d.title, #d.views, #d.views == 1 and '' or 's'), vim.log.levels.WARN)
  else
    render.open(d, n)
  end
end

---@param delta integer
function M.step(delta)
  render.step(delta)
end

function M.close()
  render.close()
end

---@param decks ShowMeDeck[]
---@param choose fun(deck: ShowMeDeck|nil)
local function snacks_pick(decks, choose)
  local items = vim.tbl_map(function(d)
    local lines = {}
    for i, v in ipairs(d.views) do
      lines[#lines + 1] = ('%d. %s  [%s]'):format(i, v.title or '', v.layout)
      for _, p in ipairs(v.panes) do
        lines[#lines + 1] = '     ' .. vim.fn.fnamemodify(p.path, ':~:.') .. (p.first and (':%d-%d'):format(p.first, p.last) or '')
      end
    end
    return { text = d.title, deck = d, preview = { text = table.concat(lines, '\n') } }
  end, decks)
  _G.Snacks.picker {
    title = 'Show-me decks',
    items = items,
    preview = 'preview',
    format = function(item)
      return {
        { ('%3d  '):format(item.deck.id), 'SnacksPickerComment' },
        { item.deck.title, 'SnacksPickerLabel' },
        { ('  %d views'):format(#item.deck.views), 'SnacksPickerComment' },
      }
    end,
    confirm = function(picker, item)
      picker:close()
      choose(item and item.deck)
    end,
  }
end

---Pick a recent deck; it becomes current and opens at view 1.
function M.pick()
  local decks = state.store():list_done()
  if #decks == 0 then
    vim.notify('show-me: no decks yet', vim.log.levels.WARN)
    return
  end
  local function choose(d)
    if d then
      state.set_current(d)
      render.open(d, 1)
    end
  end
  local picker = config.options.picker
  local snacks = rawget(_G, 'Snacks')
  if picker == 'snacks' or (picker == 'auto' and snacks and snacks.picker) then
    snacks_pick(decks, choose)
  else
    vim.ui.select(decks, {
      prompt = 'Show-me decks',
      format_item = function(d)
        return ('%d  %s  (%d views)'):format(d.id, d.title, #d.views)
      end,
    }, choose)
  end
end

---@return string
function M.status()
  local d = state.current()
  return table.concat({
    'workspace: ' .. state.workspace(),
    'server: ' .. (vim.v.servername ~= '' and vim.v.servername or 'none'),
    'registry: ' .. registry.file(),
    'current: ' .. (d and ('deck %d "%s" (%d views)'):format(d.id, d.title, #d.views) or 'none'),
  }, '\n')
end

local function start()
  state.set_workspace()
  local file, reason = registry.write()
  if not file then
    vim.notify('show-me: agents cannot reach this Neovim: ' .. reason, vim.log.levels.WARN)
  end
end

local function define_plugs()
  for n = 1, 9 do
    vim.keymap.set('n', ('<Plug>(show-me-view-%d)'):format(n), function()
      M.open(n)
    end, { desc = ('show-me: open view %d'):format(n) })
  end
  vim.keymap.set('n', '<Plug>(show-me-next)', function()
    M.step(1)
  end, { desc = 'show-me: next view' })
  vim.keymap.set('n', '<Plug>(show-me-prev)', function()
    M.step(-1)
  end, { desc = 'show-me: previous view' })
  vim.keymap.set('n', '<Plug>(show-me-pick)', M.pick, { desc = 'show-me: pick a deck' })
  vim.keymap.set('n', '<Plug>(show-me-close)', M.close, { desc = 'show-me: close the view tab' })
end

---@param keys ShowMeKeys
local function map_keys(keys)
  for n = 1, 9 do
    vim.keymap.set('n', keys.view_prefix .. n, ('<Plug>(show-me-view-%d)'):format(n), { desc = ('show-me: [v]iew %d'):format(n) })
  end
  vim.keymap.set('n', keys.next, '<Plug>(show-me-next)', { desc = 'show-me: next view' })
  vim.keymap.set('n', keys.prev, '<Plug>(show-me-prev)', { desc = 'show-me: previous view' })
  vim.keymap.set('n', keys.pick, '<Plug>(show-me-pick)', { desc = 'show-me: pick a [d]eck' })
  vim.keymap.set('n', keys.close, '<Plug>(show-me-close)', { desc = 'show-me: [q]uit the view tab' })
end

---@param opts? table See `ShowMeConfig`
function M.setup(opts)
  config.apply(opts)
  vim.api.nvim_set_hl(0, 'ShowMeRange', { link = 'Visual', default = true })
  define_plugs()
  if config.options.keys then
    map_keys(config.options.keys)
  end

  -- Callbacks are wrapped so they return nil: an autocmd callback that
  -- returns a truthy value is deleted after its first run.
  local group = vim.api.nvim_create_augroup('show_me', { clear = true })
  if vim.v.vim_did_enter == 1 then
    start()
  else
    vim.api.nvim_create_autocmd('VimEnter', { group = group, once = true, callback = start })
  end
  vim.api.nvim_create_autocmd('DirChanged', {
    group = group,
    pattern = 'global',
    callback = function()
      state.set_workspace()
      registry.write()
    end,
  })
  vim.api.nvim_create_autocmd('FocusGained', {
    group = group,
    callback = function()
      registry.touch()
    end,
  })
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function()
      registry.remove()
    end,
  })
  vim.api.nvim_create_autocmd('TabClosed', {
    group = group,
    callback = function()
      render.on_tab_closed()
    end,
  })
  vim.api.nvim_create_autocmd('SessionWritePre', {
    group = group,
    callback = function()
      render.close()
    end,
  })

  vim.api.nvim_create_user_command('ShowMe', function(o)
    local n = tonumber(o.args)
    if o.args == '' then
      M.pick()
    elseif n then
      M.open(n)
    else
      vim.notify('show-me: usage :ShowMe [view number]', vim.log.levels.WARN)
    end
  end, { nargs = '?', desc = 'Open show-me view N of the current deck, or pick a deck' })
end

return M
```

`lua/show_me/health.lua`:

```lua
--- `:checkhealth show_me`: can agents reach this Neovim, and is the CLI installed?

local M = {}

function M.check()
  local registry = require 'show_me.registry'
  vim.health.start 'show-me'

  if vim.fn.has 'nvim-0.10' == 1 then
    vim.health.ok 'Neovim 0.10 or later'
  else
    vim.health.error 'show-me needs Neovim 0.10 or later'
  end

  if vim.v.servername ~= '' then
    vim.health.ok('RPC server: ' .. vim.v.servername)
  else
    vim.health.error('no RPC server, so agents cannot reach this Neovim', { 'Do not start Neovim with --listen ""' })
  end

  local file = registry.file()
  if vim.uv.fs_stat(file) then
    vim.health.ok('registered: ' .. file)
  else
    vim.health.warn('not registered', { "Call require('show_me').setup()" })
  end

  local exe = vim.fn.exepath 'show-me'
  if exe == '' then
    local installed = vim.fs.joinpath(registry.base_dir(), 'bin', vim.fn.has 'win32' == 1 and 'show-me.exe' or 'show-me')
    exe = vim.uv.fs_stat(installed) and installed or ''
  end
  if exe == '' then
    vim.health.warn('show-me CLI not found', { 'Run install.sh (install.ps1 on Windows) from the plugin directory' })
  else
    local result = vim.system({ exe, 'version' }, { text = true }):wait()
    vim.health.ok(('%s (%s)'):format(vim.trim(result.stdout or ''), exe))
  end
end

return M
```

- [ ] **Step 4: Run them to verify they pass**

Run: `./test/nvim/run.sh`
Expected: every line `ok`, then `all specs passed`.

- [ ] **Step 5: Commit**

```bash
git add lua/show_me/init.lua lua/show_me/health.lua test/nvim/init_spec.lua test/nvim/keys_spec.lua test/nvim/session_spec.lua
git commit -m "feat(nvim): add setup, keys, :ShowMe, session safety and checkhealth" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Conformance suite

**Files:**
- Test: `test/conformance/conformance_test.go`

**Interfaces:**
- Consumes: the built `show-me` binary, the plugin from the checkout, and `protocol.Entry`
- Produces: the contract check that later editors also run (phase 2 adds VS Code)

- [ ] **Step 1: Write the test**

`test/conformance/conformance_test.go`:

```go
// Package conformance drives a real editor through the real CLI and checks
// the agent-facing contract in protocol/PROTOCOL.md: stdout, stderr and exit
// codes. Every editor show-me supports must pass it.
package conformance

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

var repoRoot, cliPath string

func TestMain(m *testing.M) {
	if _, err := exec.LookPath("nvim"); err != nil {
		fmt.Println("conformance: nvim not on PATH; skipping")
		os.Exit(0)
	}
	root, err := filepath.Abs("../..")
	if err != nil {
		panic(err)
	}
	repoRoot = root
	bin, err := os.MkdirTemp("", "show-me-cli")
	if err != nil {
		panic(err)
	}
	cliPath = filepath.Join(bin, "show-me")
	if runtime.GOOS == "windows" {
		cliPath += ".exe"
	}
	build := exec.Command("go", "build", "-o", cliPath, "./cmd/show-me")
	build.Dir, build.Stdout, build.Stderr = root, os.Stderr, os.Stderr
	if err := build.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "conformance: building the CLI:", err)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(bin)
	os.Exit(code)
}

// world is one isolated show-me home plus a workspace with two text files.
type world struct {
	t               *testing.T
	home, workspace string
}

// tempDir is a fresh, symlink-resolved directory (macOS's /var is a link).
func tempDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func newWorld(t *testing.T) *world {
	w := &world{t: t, home: tempDir(t), workspace: tempDir(t)}
	w.write(w.workspace, "a.txt", 5)
	w.write(w.workspace, "b.txt", 3)
	return w
}

func (w *world) write(dir, name string, lines int) {
	w.t.Helper()
	body := strings.Repeat("line\n", lines)
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
		w.t.Fatal(err)
	}
}

type editor struct {
	pid     int
	address string
	cmd     *exec.Cmd
}

// startNvim runs headless Neovim in dir with the plugin from this checkout.
// lateSetup calls setup() only after VimEnter, as `event = 'VeryLazy'` does.
// Each editor gets its own deck directory, so a test can tell which editor
// a request reached (same-folder editors otherwise share one by design).
func (w *world) startNvim(dir string, lateSetup bool) *editor {
	w.t.Helper()
	decks, err := os.MkdirTemp(w.home, "decks")
	if err != nil {
		w.t.Fatal(err)
	}
	setup := fmt.Sprintf("require('show_me').setup({ state_dir = [[%s]] })", decks)
	command := "lua " + setup
	if lateSetup {
		command = fmt.Sprintf("autocmd VimEnter * ++once lua vim.schedule(function() %s end)", setup)
	}
	cmd := exec.Command("nvim", "--clean", "--headless",
		"--cmd", fmt.Sprintf("lua vim.opt.rtp:prepend([[%s]])", repoRoot), "-c", command)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "SHOW_ME_HOME="+w.home)
	if err := cmd.Start(); err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })

	file := filepath.Join(w.home, "editors", fmt.Sprintf("nvim-%d.json", cmd.Process.Pid))
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var e protocol.Entry
		if json.Unmarshal(data, &e) == nil {
			return &editor{pid: e.PID, address: e.Transport.Address, cmd: cmd}
		}
	}
	w.t.Fatalf("nvim pid %d never registered at %s", cmd.Process.Pid, file)
	return nil
}

// cli runs the CLI in dir and returns its stdout, stderr and exit code.
func (w *world) cli(dir string, args ...string) (string, string, int) {
	w.t.Helper()
	cmd := exec.Command(cliPath, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "SHOW_ME_HOME="+w.home)
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case errors.As(err, &exit):
		return out.String(), errOut.String(), exit.ExitCode()
	case err != nil:
		w.t.Fatal(err)
	}
	return out.String(), errOut.String(), 0
}

// expect runs the CLI and fails unless the exit code and stdout match.
func (w *world) expect(dir string, code int, stdout string, args ...string) string {
	w.t.Helper()
	out, errOut, got := w.cli(dir, args...)
	if got != code || (stdout != "*" && out != stdout) {
		w.t.Fatalf("show-me %v: exit %d (want %d)\nstdout %q (want %q)\nstderr %q", args, got, code, out, stdout, errOut)
	}
	return errOut
}

// remote evaluates a Vimscript expression in a running editor.
func (w *world) remote(e *editor, expr string) string {
	w.t.Helper()
	out, err := exec.Command("nvim", "--server", e.address, "--remote-expr", expr).CombinedOutput()
	if err != nil {
		w.t.Fatalf("--remote-expr %s: %v\n%s", expr, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestSession(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	h := fmt.Sprintf("1@%d", e.pid)
	w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "How it works")
	w.expect(w.workspace, 0, "view 1\n", "view", h, "cols2", "a.txt:1-2", "b.txt")
	w.expect(w.workspace, 0, "view 2\n", "view", h, "single", "--title", "Only a", "a.txt:5")
	w.expect(w.workspace, 0, "done "+h+"\nopen: <leader>v1\n", "done", h)
	out, _, _ := w.cli(w.workspace, "status")
	if !strings.Contains(out, fmt.Sprintf(`current: deck %s "How it works" (2 views)`, h)) {
		t.Fatalf("status: %q", out)
	}
}

func TestRejections(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	at := func(n int) string { return fmt.Sprintf("%d@%d", n, e.pid) }
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"view", "99", "single", "a.txt"}, "show-me: unknown deck 99\n"},
		{[]string{"view", "1", "grid", "a.txt"}, "show-me: unknown layout \"grid\" (valid: single, cols2, cols3, main-stack)\n"},
		{[]string{"view", "1", "single", "a.txt:4-9"}, fmt.Sprintf("show-me: range 4-9 is past the end of %s (5 lines)\n", filepath.Join(w.workspace, "a.txt"))},
	}
	w.expect(w.workspace, 0, "deck "+at(1)+"\n", "deck", "One")
	for _, c := range cases {
		if got := w.expect(w.workspace, 1, "", c.args...); got != c.want {
			t.Errorf("%v: stderr %q, want %q", c.args, got, c.want)
		}
	}
	if got := w.expect(w.workspace, 1, "", "done", at(1)); got != "show-me: deck 1 has no views\n" {
		t.Errorf("empty done: %q", got)
	}
	w.expect(w.workspace, 0, "view 1\n", "view", at(1), "single", "a.txt")
	w.expect(w.workspace, 0, "*", "done", at(1))
	if got := w.expect(w.workspace, 1, "", "view", at(1), "single", "a.txt"); got != "show-me: deck 1 is already done; start a new one\n" {
		t.Errorf("view after done: %q", got)
	}
	w.expect(w.workspace, 0, "deck "+at(2)+"\n", "deck", "Full")
	for i := 1; i <= 9; i++ {
		w.expect(w.workspace, 0, fmt.Sprintf("view %d\n", i), "view", at(2), "single", "a.txt")
	}
	if got := w.expect(w.workspace, 1, "", "view", at(2), "single", "a.txt"); got != "show-me: deck 2 already has 9 views, the most an editor can open by number\n" {
		t.Errorf("tenth view: %q", got)
	}
}

func TestWorktreeReachesMainCheckout(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	w := newWorld(t)
	wt := filepath.Join(tempDir(t), "wt")
	git := func(args ...string) {
		full := append([]string{"-C", w.workspace, "-c", "user.name=t", "-c", "user.email=t@example.com"}, args...)
		if out, err := exec.Command("git", full...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	git("init", "-q")
	git("add", ".")
	git("commit", "-q", "-m", "init")
	git("worktree", "add", "-q", wt)
	e := w.startNvim(w.workspace, false)
	w.expect(wt, 0, fmt.Sprintf("deck 1@%d\n", e.pid), "deck", "From a worktree")
	w.expect(wt, 0, "view 1\n", "view", fmt.Sprintf("1@%d", e.pid), "single", "a.txt:2")
}

func TestConcurrentViews(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	h := fmt.Sprintf("1@%d", e.pid)
	w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "Busy")
	var mu sync.Mutex
	var got []string
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, errOut, code := w.cli(w.workspace, "view", h, "single", "a.txt")
			mu.Lock()
			defer mu.Unlock()
			if code != 0 {
				t.Errorf("exit %d: %s", code, errOut)
			}
			got = append(got, strings.TrimSpace(out))
		}()
	}
	wg.Wait()
	sort.Strings(got)
	if want := "view 1,view 2,view 3,view 4,view 5,view 6"; strings.Join(got, ",") != want {
		t.Fatalf("got %v", got)
	}
}

func TestHandleSticksToItsEditor(t *testing.T) {
	w := newWorld(t)
	owner := w.startNvim(w.workspace, false)
	other := w.startNvim(w.workspace, false)
	w.remote(owner, "execute('doautocmd FocusGained')")
	h := fmt.Sprintf("1@%d", owner.pid)
	w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "Pinned")
	w.remote(other, "execute('doautocmd FocusGained')")
	w.expect(w.workspace, 0, "view 1\n", "view", h, "single", "a.txt")
	w.expect(w.workspace, 0, "*", "done", h)
	if got := w.remote(owner, `luaeval("require('show_me.state').current().id")`); got != "1" {
		t.Fatalf("the owner's current deck is %q, want 1", got)
	}
	if got := w.remote(other, `luaeval("require('show_me.state').current() == nil")`); got != "v:true" {
		t.Fatalf("the focused editor received the deck: %q", got)
	}
}

func TestLateSetupStillRegisters(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, true)
	w.expect(w.workspace, 0, fmt.Sprintf("deck 1@%d\n", e.pid), "deck", "Lazy")
}

func TestExitedEditor(t *testing.T) {
	w := newWorld(t)
	e := w.startNvim(w.workspace, false)
	_ = e.cmd.Process.Kill()
	_ = e.cmd.Wait()
	w.expect(w.workspace, 3, "", "deck", "Nobody home")
	entry := filepath.Join(w.home, "editors", fmt.Sprintf("nvim-%d.json", e.pid))
	if _, err := os.Stat(entry); !os.IsNotExist(err) {
		t.Fatalf("stale entry %s was not cleaned up", entry)
	}
}
```

- [ ] **Step 2: Run it**

Run: `go test ./test/conformance/ -v -count=1 2>&1 | tail -20`
Expected: `--- PASS` for `TestSession`, `TestRejections`, `TestWorktreeReachesMainCheckout`, `TestConcurrentViews`, `TestHandleSticksToItsEditor`, `TestLateSetupStillRegisters` and `TestExitedEditor`, then `ok`.

This suite tests code that already exists. To prove it catches failures, break one thing on purpose: change `'deck %d has no views'` in `lua/show_me/store.lua` to `'deck %d is empty'`, rerun the suite, and confirm `TestRejections` fails with the `empty done` message. Then revert the change and rerun to green.

- [ ] **Step 3: Commit**

```bash
git add test/conformance
git commit -m "test(conformance): drive real Neovim through the real CLI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Agent skill and installers

**Files:**
- Create: `skills/show-me/SKILL.md`, `install.sh`, `install.ps1`
- Test: `test/install/install_test.sh`, `test/install/install_test.ps1`

**Interfaces:**
- Consumes: `cmd/show-me`, the release archive layout from Task 12 (`show-me[.exe]`, `LICENSE`, `README.md` and `skills/show-me/SKILL.md` at the archive root), and the asset names `show-me_<os>_<arch>.tar.gz` (`.zip` on Windows) plus `checksums.txt`
- Produces: `<base>/bin/show-me[.exe]`, a link or copy of it in `--bin-dir`, and `~/.{claude,codex,cursor}/skills/show-me`

- [ ] **Step 1: Write the skill**

`skills/show-me/SKILL.md`:

````markdown
---
name: show-me
description: Show code in the user's editor (Neovim or VS Code) while explaining it. Use when answering questions about a codebase where the explanation spans more than one location (call chains, data flow, before/after, two branches), or when the user asks to be shown, pointed at, or walked through code. Builds a deck of numbered multi-pane views the user opens at their own pace.
---

# show-me

The user reads your explanation in the terminal and has their editor open in
another window. With `show-me` you prepare **views** there (files side by
side, scrolled to and highlighting the lines you mean) and refer to them in
your answer. Nothing pops up: the user gets a notification and opens each view
by number as they read.

Run `show-me` from the repository you are discussing. If it is not on `PATH`,
use the installed copy:

- macOS and Linux: `${XDG_STATE_HOME:-$HOME/.local/state}/show-me/bin/show-me`
- Windows: `%LOCALAPPDATA%\show-me\bin\show-me.exe`

## When to use it

- The explanation touches **two or more locations**: a caller and its callee, a
  pipeline, a type and where it's built, the same function on two branches.
- The user says "show me", "point me to", "walk me through", "where is".

Skip it for a single short snippet you can quote inline, or when no repository
is involved.

## Workflow

1. `show-me deck "<what this explanation is about>"` prints `deck <handle>`,
   for example `deck 4@81234`. Use that handle, exactly as printed, in the
   next steps.
2. One `show-me view <handle> <layout> <pane>... --title "<short caption>"` per
   illustration. Each call prints `view <n>`, and those numbers are what you cite.
3. `show-me done <handle>` prints `done <handle>` and `open: <keys>`. The user is
   notified only now, so send it after the last view and before you write your
   answer.
4. Start your answer with one line saying the views are ready and how to open
   them, using the `open:` keys (for example "Views 1–3 are ready in your
   editor: `<leader>v1`"). Then cite views by number and pane position:
   *"the token is minted in `mint()` (**view 1**, top-right pane)…"*

## Panes

`path`, `path:N` (highlight line N), or `path:N-M`. Paths are relative to your
working directory or absolute. A path into another worktree
(`../repo-feature/src/x.py`) works, which is how you compare branches. Put `--`
before any pane whose path starts with `-`.

Keep ranges to **about 60 lines or fewer** so they fit in a pane. Highlight
the lines that matter, not the whole file.

## Layouts

Only these four exist:

| Layout | Panes | Use for |
|---|---|---|
| `single` | 1 | one focal piece of code |
| `cols2` | 2 | compare/contrast; caller and callee; before and after |
| `cols3` | 3 | a three-stage pipeline, read left to right |
| `main-stack` | 3-4 | one primary file (left, wide) plus 2-3 helpers stacked on the right |

Pane 1 is always left (and top-left in `main-stack`); the rest follow in
reading order. Prefer **one idea per view** and more views over packed panes.
A deck holds at most 9 views.

## Example

```sh
show-me deck "How a login request is authenticated"            # deck 4@81234
show-me view 4@81234 main-stack src/auth.py:40-88 src/token.py:10-30 src/db.py:5-19 --title "Login path"
show-me view 4@81234 cols2 ../app-feature/src/auth.py:40-90 src/auth.py:40-88 --title "Feature branch vs main"
show-me done 4@81234                                           # done 4@81234 / open: <leader>v1
```

## Errors

| Exit | Meaning | What to do |
|---|---|---|
| 1 | Request rejected; stderr says why (bad layout, pane count, missing file, range past end of file, deck already done) | Fix that view and resend it. Earlier views in the deck are kept |
| 2 | Usage error | Check the argument order above |
| 3 | No editor reachable | If you are sandboxed, ask the user to approve running `show-me` outside the sandbox. Otherwise tell the user their editor isn't serving this directory (`show-me editors` lists what is registered), and continue without views |
| 4 | The CLI and the editor plugin speak different protocol versions | Tell the user to update whichever stderr names, and continue without views |

Never send `done` twice, and never rebuild a deck to "refresh" it. If you need
different views, start a new deck.
````

- [ ] **Step 2: Write the failing installer tests**

`test/install/install_test.sh` (then `chmod +x test/install/install_test.sh`):

```bash
#!/usr/bin/env bash
# Exercise install.sh against a fake release on disk, served over file:// URLs.
# shellcheck disable=SC2016  # check() evals its single-quoted conditions on purpose
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
root=$PWD
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "$(uname -s)" in Darwin) os=darwin ;; *) os=linux ;; esac
case "$(uname -m)" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
asset="show-me_${os}_${arch}.tar.gz"

stage="$work/stage"
mkdir -p "$stage/skills/show-me"
go build -ldflags "-X main.version=9.9.9" -o "$stage/show-me" ./cmd/show-me
cp skills/show-me/SKILL.md "$stage/skills/show-me/"
release="$work/releases/latest/download"
mkdir -p "$release"
tar -czf "$release/$asset" -C "$stage" .
(cd "$release" && { sha256sum "$asset" 2>/dev/null || shasum -a 256 "$asset"; } >checksums.txt)

fail=0
check() {
  if eval "$2"; then echo "  ok   $1"; else
    echo "  FAIL $1"
    fail=1
  fi
}

home="$work/home"
mkdir -p "$home/.claude"
install() {
  HOME="$home" SHOW_ME_HOME="$home/state" SHOW_ME_RELEASE_URL="file://$work/releases" \
    sh "$root/install.sh" --bin-dir "$home/bin" "$@"
}

install >/dev/null
check "binary installed and runs" '[ "$("$home/state/bin/show-me" version)" = "show-me 9.9.9 (protocol 1)" ]'
check "linked into --bin-dir" '[ -L "$home/bin/show-me" ]'
check "skill linked for an installed agent" '[ -f "$home/.claude/skills/show-me/SKILL.md" ]'
check "nothing created for agents that are not installed" '[ ! -e "$home/.codex" ]'
install >/dev/null
check "re-running is safe" '[ -x "$home/state/bin/show-me" ] && [ -f "$home/.claude/skills/show-me/SKILL.md" ]'

install --no-skill >/dev/null
check "--no-skill leaves the skill alone" '[ -f "$home/.claude/skills/show-me/SKILL.md" ]'

echo tampered >>"$release/$asset"
before=$(cksum <"$home/state/bin/show-me")
status=0
install >/dev/null 2>"$work/err" || status=$?
check "a checksum mismatch fails" '[ "$status" -ne 0 ] && grep -q "checksum mismatch" "$work/err"'
check "a checksum mismatch leaves the binary alone" '[ "$(cksum <"$home/state/bin/show-me")" = "$before" ]'

exit "$fail"
```

`test/install/install_test.ps1`:

```powershell
# Exercise install.ps1 against a fake release on disk, served over file:// URLs.
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Work = Join-Path ([IO.Path]::GetTempPath()) ("show-me-test-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Work | Out-Null
$Fail = 0
function Check($Label, [scriptblock]$Condition) {
  if (& $Condition) { Write-Host "  ok   $Label" } else { Write-Host "  FAIL $Label"; $script:Fail = 1 }
}
try {
  $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  $Asset = "show-me_windows_$Arch.zip"
  $Stage = Join-Path $Work 'stage'
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'skills\show-me') | Out-Null
  Push-Location $Root
  try { go build -ldflags "-X main.version=9.9.9" -o (Join-Path $Stage 'show-me.exe') ./cmd/show-me } finally { Pop-Location }
  Copy-Item (Join-Path $Root 'skills\show-me\SKILL.md') (Join-Path $Stage 'skills\show-me')
  $Release = Join-Path $Work 'releases\latest\download'
  New-Item -ItemType Directory -Force -Path $Release | Out-Null
  Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath (Join-Path $Release $Asset)
  $Hash = (Get-FileHash -Algorithm SHA256 (Join-Path $Release $Asset)).Hash.ToLower()
  Set-Content -Path (Join-Path $Release 'checksums.txt') -Value "$Hash  $Asset"

  $AgentHome = Join-Path $Work 'home'
  New-Item -ItemType Directory -Force -Path (Join-Path $AgentHome '.claude') | Out-Null
  $env:SHOW_ME_HOME = Join-Path $AgentHome 'state'
  $env:SHOW_ME_RELEASE_URL = ([Uri](Join-Path $Work 'releases')).AbsoluteUri
  $Install = { & (Join-Path $Root 'install.ps1') -AgentHome $AgentHome -BinDir (Join-Path $AgentHome 'bin') | Out-Null }

  & $Install
  $Exe = Join-Path $env:SHOW_ME_HOME 'bin\show-me.exe'
  Check 'binary installed and runs' { (& $Exe version) -eq 'show-me 9.9.9 (protocol 1)' }
  Check 'copied into -BinDir' { Test-Path (Join-Path $AgentHome 'bin\show-me.exe') }
  Check 'skill copied for an installed agent' { Test-Path (Join-Path $AgentHome '.claude\skills\show-me\SKILL.md') }
  Check 'nothing created for agents that are not installed' { -not (Test-Path (Join-Path $AgentHome '.codex')) }
  & $Install
  Check 're-running is safe' { Test-Path (Join-Path $AgentHome '.claude\skills\show-me\SKILL.md') }

  Add-Content -Path (Join-Path $Release $Asset) -Value 'tampered'
  $Before = (Get-FileHash $Exe).Hash
  $Failed = $false
  try { & $Install } catch { $Failed = $_.Exception.Message -like '*checksum mismatch*' }
  Check 'a checksum mismatch fails' { $Failed }
  Check 'a checksum mismatch leaves the binary alone' { (Get-FileHash $Exe).Hash -eq $Before }
} finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}
exit $Fail
```

- [ ] **Step 3: Run the POSIX test to verify it fails**

Run: `./test/install/install_test.sh`
Expected: it exits non-zero with `sh: …/install.sh: No such file or directory`.

- [ ] **Step 4: Write the installers**

`install.sh` (then `chmod +x install.sh`):

```sh
#!/bin/sh
# Install the show-me CLI and its agent skill (macOS, Linux).
#
#   curl -fsSL https://github.com/chanceygardener/show-me/releases/latest/download/install.sh | sh
#   sh install.sh [--version vX.Y.Z] [--for-plugin DIR] [--no-skill] [--bin-dir DIR]
#
# The binary goes to <base>/bin/show-me, where <base> is $SHOW_ME_HOME or
# ${XDG_STATE_HOME:-~/.local/state}/show-me, and is linked into --bin-dir
# (default ~/.local/bin). Downloads use curl, which never sets macOS's
# quarantine attribute, so Gatekeeper doesn't prompt. --for-plugin installs
# the version in that checkout's VERSION file, building it with go when no
# such release exists. Re-running upgrades in place.
set -eu

releases="${SHOW_ME_RELEASE_URL:-https://github.com/chanceygardener/show-me/releases}"
version=latest
plugin_dir=
skill=1
bin_dir="$HOME/.local/bin"

say() { printf 'show-me: %s\n' "$*"; }
die() {
  printf 'show-me: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
  --version)
    [ $# -ge 2 ] || die "--version needs a value"
    version=$2
    shift 2
    ;;
  --for-plugin)
    [ $# -ge 2 ] || die "--for-plugin needs a directory"
    plugin_dir=$2
    shift 2
    ;;
  --no-skill)
    skill=0
    shift
    ;;
  --bin-dir)
    [ $# -ge 2 ] || die "--bin-dir needs a directory"
    bin_dir=$2
    shift 2
    ;;
  -h | --help)
    echo "usage: install.sh [--version vX.Y.Z] [--for-plugin DIR] [--no-skill] [--bin-dir DIR]"
    exit 0
    ;;
  *) die "unknown option $1" ;;
  esac
done

base="${SHOW_ME_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/show-me}"

case "$(uname -s)" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) die "unsupported OS $(uname -s); on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*) die "unsupported CPU $(uname -m)" ;;
esac
asset="show-me_${os}_${arch}.tar.gz"

if [ -n "$plugin_dir" ]; then
  plugin_dir=$(cd "$plugin_dir" && pwd -P)
  version="v$(tr -d ' \n' <"$plugin_dir/VERSION")"
fi

url() {
  if [ "$version" = latest ]; then
    echo "$releases/latest/download/$1"
  else
    echo "$releases/download/$version/$1"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

fetch_release() {
  curl -fsSL "$(url "$asset")" -o "$tmp/$asset" 2>/dev/null || return 1
  curl -fsSL "$(url checksums.txt)" -o "$tmp/checksums.txt" || die "downloaded $asset but not checksums.txt"
  expected=$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/checksums.txt")
  [ -n "$expected" ] || die "checksums.txt has no entry for $asset"
  actual=$(sha256 "$tmp/$asset")
  [ "$expected" = "$actual" ] || die "checksum mismatch for $asset (expected $expected, got $actual); nothing was installed"
  mkdir -p "$tmp/release"
  tar -xzf "$tmp/$asset" -C "$tmp/release"
}

build_from_checkout() {
  [ -n "$plugin_dir" ] && command -v go >/dev/null 2>&1 || return 1
  say "no $version release found; building from $plugin_dir"
  mkdir -p "$tmp/release"
  (cd "$plugin_dir" && go build -ldflags "-X main.version=${version#v}-dev" -o "$tmp/release/show-me" ./cmd/show-me)
}

if fetch_release; then
  say "downloaded $version ($asset)"
elif build_from_checkout; then
  :
else
  die "could not download $(url "$asset")"
fi

mkdir -p "$base/bin"
chmod 700 "$base" 2>/dev/null || true
cp "$tmp/release/show-me" "$base/bin/show-me.new"
chmod 755 "$base/bin/show-me.new"
mv -f "$base/bin/show-me.new" "$base/bin/show-me"
say "installed $base/bin/show-me"

mkdir -p "$bin_dir"
ln -sf "$base/bin/show-me" "$bin_dir/show-me"
case ":$PATH:" in
*":$bin_dir:"*) say "linked $bin_dir/show-me" ;;
*) say "linked $bin_dir/show-me; add it to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac

[ "$skill" = 1 ] || exit 0
if [ -n "$plugin_dir" ]; then
  skill_src="$plugin_dir/skills/show-me"
else
  rm -rf "$base/skill"
  mkdir -p "$base/skill"
  cp -R "$tmp/release/skills/show-me/." "$base/skill/"
  skill_src="$base/skill"
fi
for agent in .claude .codex .cursor; do
  agent_home="$HOME/$agent"
  [ -d "$agent_home" ] || continue
  target="$agent_home/skills/show-me"
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    say "skipped $target: a real directory is there; remove it to let show-me manage it"
    continue
  fi
  mkdir -p "$agent_home/skills"
  ln -sfn "$skill_src" "$target"
  say "linked $target"
done
```

`install.ps1`:

```powershell
# Install the show-me CLI and its agent skill (Windows).
#
#   irm https://github.com/chanceygardener/show-me/releases/latest/download/install.ps1 | iex
#   .\install.ps1 [-Version vX.Y.Z] [-ForPlugin DIR] [-NoSkill] [-BinDir DIR] [-AgentHome DIR]
#
# The binary goes to <base>\bin\show-me.exe, where <base> is $env:SHOW_ME_HOME
# or %LOCALAPPDATA%\show-me, and is copied into -BinDir (default
# ~\.local\bin). Unblock-File clears any Mark-of-the-Web so SmartScreen
# doesn't prompt. The skill is copied, not linked: Windows symlinks need
# Developer Mode or admin rights. Re-running upgrades in place.
param(
  [string]$Version = 'latest',
  [string]$ForPlugin = '',
  [switch]$NoSkill,
  [string]$AgentHome = $HOME,
  [string]$BinDir = ''
)
$ErrorActionPreference = 'Stop'
if (-not $BinDir) { $BinDir = Join-Path $AgentHome '.local\bin' }

$Releases = if ($env:SHOW_ME_RELEASE_URL) { $env:SHOW_ME_RELEASE_URL } else { 'https://github.com/chanceygardener/show-me/releases' }
$Base = if ($env:SHOW_ME_HOME) { $env:SHOW_ME_HOME } else { Join-Path $env:LOCALAPPDATA 'show-me' }

function Say($Message) { Write-Host "show-me: $Message" }

$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'amd64' }
  'ARM64' { 'arm64' }
  default { throw "show-me: unsupported CPU $($env:PROCESSOR_ARCHITECTURE)" }
}
$Asset = "show-me_windows_$Arch.zip"

if ($ForPlugin) {
  $ForPlugin = (Resolve-Path $ForPlugin).Path
  $Version = 'v' + (Get-Content (Join-Path $ForPlugin 'VERSION') -Raw).Trim()
}

function Get-AssetUrl($Name) {
  if ($Version -eq 'latest') { "$Releases/latest/download/$Name" } else { "$Releases/download/$Version/$Name" }
}

# file:// URLs (used by the installer tests) are copied rather than downloaded.
function Get-Asset($Url, $OutFile) {
  if ($Url -like 'file://*') { Copy-Item -LiteralPath ([Uri]$Url).LocalPath -Destination $OutFile }
  else { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile }
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('show-me-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Release = Join-Path $Tmp 'release'
  $Downloaded = $true
  try { Get-Asset (Get-AssetUrl $Asset) (Join-Path $Tmp $Asset) } catch { $Downloaded = $false }

  if ($Downloaded) {
    Get-Asset (Get-AssetUrl 'checksums.txt') (Join-Path $Tmp 'checksums.txt')
    $Line = Get-Content (Join-Path $Tmp 'checksums.txt') | Where-Object { ($_ -split '\s+')[1] -eq $Asset } | Select-Object -First 1
    if (-not $Line) { throw "show-me: checksums.txt has no entry for $Asset" }
    $Expected = ($Line -split '\s+')[0]
    $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLower()
    if ($Expected -ne $Actual) { throw "show-me: checksum mismatch for $Asset (expected $Expected, got $Actual); nothing was installed" }
    Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath $Release
    Say "downloaded $Version ($Asset)"
  } elseif ($ForPlugin -and (Get-Command go -ErrorAction SilentlyContinue)) {
    Say "no $Version release found; building from $ForPlugin"
    New-Item -ItemType Directory -Path $Release | Out-Null
    Push-Location $ForPlugin
    try {
      go build -ldflags "-X main.version=$($Version.TrimStart('v'))-dev" -o (Join-Path $Release 'show-me.exe') ./cmd/show-me
      if ($LASTEXITCODE) { throw 'show-me: go build failed' }
    } finally { Pop-Location }
  } else {
    throw "show-me: could not download $(Get-AssetUrl $Asset)"
  }

  $Bin = Join-Path $Base 'bin'
  New-Item -ItemType Directory -Force -Path $Bin | Out-Null
  $Exe = Join-Path $Bin 'show-me.exe'
  Copy-Item -Force (Join-Path $Release 'show-me.exe') $Exe
  Unblock-File $Exe
  Say "installed $Exe"

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Copy-Item -Force $Exe (Join-Path $BinDir 'show-me.exe')
  if (($env:Path -split ';') -contains $BinDir) {
    Say "copied to $BinDir"
  } else {
    Say "copied to $BinDir; add it to your user PATH to run show-me from anywhere"
  }

  if (-not $NoSkill) {
    $SkillSrc = if ($ForPlugin) { Join-Path $ForPlugin 'skills\show-me' } else { Join-Path $Release 'skills\show-me' }
    foreach ($Agent in '.claude', '.codex', '.cursor') {
      $AgentDir = Join-Path $AgentHome $Agent
      if (-not (Test-Path $AgentDir)) { continue }
      $Target = Join-Path $AgentDir 'skills\show-me'
      if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
      New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
      Copy-Item -Recurse $SkillSrc $Target
      Say "copied the skill to $Target"
    }
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `sh -n install.sh && ./test/install/install_test.sh`
Expected: every line `ok`, exit 0. If `pwsh` is installed locally, also run `pwsh -NoProfile -File test/install/install_test.ps1`. Otherwise the Windows CI leg covers it (Task 12).

- [ ] **Step 6: Commit**

```bash
git add skills install.sh install.ps1 test/install
git commit -m "feat(install): one installer per OS for the CLI and the agent skill" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Documentation, CI and releases

**Files:**
- Create: `protocol/PROTOCOL.md`, `README.md`, `doc/show-me.txt`, `CONTRIBUTING.md`
- Create: `.goreleaser.yaml`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Consumes: everything above
- Produces: the release asset names Task 11's installers expect (`show-me_<os>_<arch>.tar.gz`, `.zip` on Windows, plus `checksums.txt`, `install.sh` and `install.ps1`)

- [ ] **Step 1: Write a failing check for the Vim help**

Run: `nvim --clean --headless -c 'helptags doc' -c 'help show-me' -c 'qa!' 2>&1`
Expected: an error. Either `E150: Not a directory: doc` or `E149: Sorry, no help for show-me`.

- [ ] **Step 2: Write the docs**

`protocol/PROTOCOL.md`:

````markdown
# show-me protocol, version 1

The contract between agents, the `show-me` CLI, and editors. The Go types in
`internal/protocol` are its source; the conformance suite (`test/conformance`)
checks every editor against it. Changing anything here bumps the version, in
the CLI and every editor, in one release.

## Agents and the CLI

```
show-me deck <title>                                         → deck <n>@<pid>
show-me view <deck> <layout> [--title T] [--] <pane>...      → view <n>
show-me done <deck>                                          → done <n>@<pid>
                                                               open: <how the user opens view 1>
show-me status                                               → editor, workspace, current deck
show-me editors                                              → registry entries; * marks the one chosen
show-me version                                              → show-me <version> (protocol 1)
```

`<deck>` is the handle `deck` printed (`7@4242`: deck 7 in the editor with pid
4242) or a bare deck number, which is routed by the rules under "Choosing an
editor". `<pane>` is `path`, `path:N` or `path:N-M`, relative to the CLI's cwd
or absolute. The range is read from the right and only when the part before it
is a file. `--` ends options. Diagnostics go to stderr as `show-me: <message>`.

| Exit | Meaning |
|---|---|
| 0 | ok |
| 1 | rejected: the message says what to fix |
| 2 | usage error, including an unknown subcommand |
| 3 | no reachable editor |
| 4 | editors found, but none speaks this CLI's protocol version |

### Rejections (exit 1), verbatim

| Check | Raised by | Message |
|---|---|---|
| Blank deck title | CLI | `a deck needs a title` |
| Unknown layout | CLI | `unknown layout "grid" (valid: single, cols2, cols3, main-stack)` |
| Pane count | CLI | `cols2 takes 2 panes, got 3` · `main-stack takes 3-4 panes, got 2` |
| Missing or unreadable file | CLI | `no readable file at <path>` |
| Binary file (NUL in the first 8 KB) | CLI | `<path> is a binary file` |
| Malformed range | CLI | `malformed range "1-2-3" in <spec> (use N or N-M)` |
| Range starts below 1 | CLI | `range in <path> must start at line 1 or later` |
| Reversed range | CLI | `range 4-2 in <path> has first > last` |
| Range past EOF | CLI | `range 4-9 is past the end of <path> (5 lines)` |
| Unknown deck | Editor | `unknown deck 99` |
| View sent to a done deck | Editor | `deck 7 is already done; start a new one` |
| Tenth view | Editor | `deck 7 already has 9 views, the most an editor can open by number` |
| `done` with no views | Editor | `deck 7 has no views` |

Line counts follow editor convention: a trailing newline does not start a new
line, and an empty file has 0 lines.

## Layouts

| Layout | Panes | Geometry |
|---|---|---|
| `single` | 1 | one pane |
| `cols2` | 2 | two equal columns |
| `cols3` | 3 | three equal columns |
| `main-stack` | 3-4 | pane 1 takes the left 60% of the available width; the rest stack on the right |

## The CLI and editors

### Base directory

`$SHOW_ME_HOME`; else `$XDG_STATE_HOME/show-me`; else `~/.local/state/show-me`.
On Windows, `%LOCALAPPDATA%\show-me`. Empty variables count as unset. Mode 0700
on POSIX. It holds `editors/` (the registry) and `bin/` (the installed CLI).

### Registry

Each running editor writes `editors/<editor>-<pid>.json`, mode 0600, atomically
(temp file and rename), and deletes it on exit:

```json
{
  "protocol": 1,
  "editor": "nvim",
  "pid": 4242,
  "workspace_folders": ["/Users/me/repos"],
  "transport": { "kind": "nvim", "address": "/var/folders/…/nvim.4242.0" },
  "open_hint": "<leader>v1",
  "started_at": 1792224000000,
  "focused_at": 1792224310000
}
```

Workspace folders are absolute and symlink-resolved. Times are epoch
milliseconds. `focused_at` is updated whenever the editor gains focus.

### Choosing an editor

1. Targets: the CLI's cwd (symlink-resolved), then the git main checkout (the
   parent of `git rev-parse --git-common-dir`) when that differs.
2. Entries whose pid is not running are deleted. Entries with another
   `protocol` are set aside for the exit-4 message.
3. For the first target any entry serves (a workspace folder equal to it or
   containing it), order the entries by deepest containing folder, then most
   recent `focused_at`. Comparison is case-insensitive on macOS and Windows.
4. Try each in order: connect within 2 s, and expect a reply within 10 s.

A deck handle skips steps 1–3 and goes straight to its pid's entry.

### Requests and replies

One JSON request, one JSON reply:

```json
{ "protocol": 1, "command": "view", "deck": 7,
  "view": { "layout": "cols2", "title": "Both",
            "panes": [ { "path": "/abs/a.py", "first": 2, "last": 4 }, { "path": "/abs/b.py" } ] } }
```

```json
{ "ok": true, "result": { "view": 2 } }
{ "ok": false, "error": "deck 7 is already done; start a new one" }
```

| Command | Request fields | Result |
|---|---|---|
| `deck` | `title` | `{"deck": 7}` |
| `view` | `deck`, `view` | `{"view": 2}` |
| `done` | `deck` | `{"deck": 7, "views": 3, "open_hint": "<leader>v1"}` |
| `status` | — | `{"editor": "nvim", "workspace_folders": […], "current": {"deck": 7, "title": "…", "views": 3}}`, with `current` `null` when there is no deck |

An editor that doesn't speak the request's `protocol` replies
`unsupported protocol <n> (this editor speaks <m>)`, and the CLI exits 4.

### Transports

- **`nvim`:** the address is Neovim's own server (`v:servername`: a Unix socket,
  a Windows named pipe, or host:port). The CLI calls
  `nvim_exec_lua("return require('show_me.rpc').handle(...)", [request_json])`
  and gets the reply JSON back as a string.
- **`ndjson`** (VS Code, phase 2): one request line, one reply line, then close.
  Every request carries the entry's `token`.

### What every editor does

- Stores decks as JSON, one file per deck, in a directory per workspace folder
  named by the first 16 hex characters of the folder's sha256. Ids are monotonic
  from 1, it keeps the newest 10 decks, and a deck holds at most 9 views. A
  corrupt deck file is skipped.
- Keeps the current deck: the last `done` or picked deck, else the newest done
  deck on disk.
- On `done`, notifies without moving focus:
  `show-me: <title> · <n> views · <open_hint>`.
- Renders the four layouts. Each pane is a real file editor, scrolled so
  `first` is at the top, with `first`–`last` highlighted, and captioned
  `n/N · <view title or deck title> · <relative path>:<range>`.
- Lets the user open a view by number, step to the next or previous view, pick
  a recent deck, and close.
````

`README.md`:

````markdown
# show-me

Let terminal coding agents (Claude Code, Codex, Cursor, …) illustrate an
explanation in your editor. An agent builds a **deck** of numbered **views**:
up to four files side by side, scrolled to and highlighting the lines it means.
You open the views at your own pace while you read its answer. Nothing pops up
uninvited; you get a notification.

Works with Neovim 0.10+ on macOS, Linux and Windows. VS Code support is next.

## Install

### Neovim (lazy.nvim)

```lua
{
  'chanceygardener/show-me',
  event = 'VeryLazy',
  build = function(plugin)
    local installer = vim.fn.has 'win32' == 1
        and { 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', plugin.dir .. '/install.ps1', '-ForPlugin', plugin.dir }
      or { 'sh', plugin.dir .. '/install.sh', '--for-plugin', plugin.dir }
    local result = vim.system(installer, { text = true }):wait()
    assert(result.code == 0, result.stderr)
  end,
  opts = {},
}
```

The build step installs the matching `show-me` CLI and the agent skill, so
that's all Neovim users need.

### CLI and skill on their own

```sh
curl -fsSL https://github.com/chanceygardener/show-me/releases/latest/download/install.sh | sh
```

```powershell
irm https://github.com/chanceygardener/show-me/releases/latest/download/install.ps1 | iex
```

The installer:
- puts `show-me` in `~/.local/state/show-me/bin` (`%LOCALAPPDATA%\show-me\bin` on Windows);
- links it into `~/.local/bin`, or copies it there on Windows;
- installs the skill for Claude Code, Codex and Cursor, if they're installed;
- verifies every download against the release checksums.

Install with the script, not by downloading from the Releases page in a
browser. Browser downloads get quarantined by macOS Gatekeeper and Windows
SmartScreen, and these binaries aren't notarized.

## Use

Ask an agent to explain or show you something in the repository open in your
editor. When its views are ready you'll get a notification.

| Keys | Action |
|---|---|
| `<leader>v1`…`<leader>v9` | Open view N of the current deck |
| `]v` / `[v` | Next / previous view (in the show-me tab) |
| `<leader>vd` | Pick a recent deck |
| `<leader>vq` | Close the show-me tab |
| `:ShowMe [n]` | Open view n, or pick a deck |

Views open in their own tab. If your tab has neo-tree or nvim-tree open, the
show-me tab opens it too. Run `:checkhealth show_me` if agents can't reach you.

## Configure

```lua
opts = {
  keys = { view_prefix = '<leader>v', next = ']v', prev = '[v', pick = '<leader>vd', close = '<leader>vq' },
  -- keys = false defines none; map the <Plug>(show-me-…) mappings yourself
  sidebar = { filetypes = { 'neo-tree', 'NvimTree' } }, -- plus `open` functions per filetype
  picker = 'auto', -- 'snacks' | 'select'
}
```

See `:help show-me` for everything.

## Agent sandboxes

`show-me` connects to a local socket, which agent sandboxes may block. Allow it explicitly:

- **Claude Code:** add `"Bash(show-me:*)"` to `permissions.allow`. If sandboxing
  is on, also list it in `sandbox.excludedCommands`.
- **Codex:** approve `show-me` when prompted, or run with a sandbox mode that
  allows local sockets.
- **Cursor:** add `show-me` to the terminal command allowlist.

## How agents find your editor

Each editor registers itself in `~/.local/state/show-me/editors/`. The CLI
picks the editor whose working directory is closest to the agent's. Inside a
git worktree, it also considers the repository's main checkout. So an agent
anywhere under `~/repos` reaches a Neovim started in `~/repos`. Run
`show-me editors` to see what's registered. The full contract is in
[`protocol/PROTOCOL.md`](protocol/PROTOCOL.md).

## License

MIT
````

`doc/show-me.txt`:

```
*show-me.txt*  Let terminal agents show you code while they explain it

==============================================================================
CONTENTS                                                     *show-me*

  1. Introduction ........................... |show-me-intro|
  2. Setup .................................. |show-me-setup|
  3. Options ................................ |show-me-options|
  4. Mappings ............................... |show-me-mappings|
  5. Commands ............................... |show-me-commands|
  6. Highlights ............................. |show-me-highlights|

==============================================================================
1. INTRODUCTION                                              *show-me-intro*

A coding agent in another terminal runs the `show-me` CLI to build a deck of
numbered views: one of four layouts (single, cols2, cols3, main-stack), each
pane a file scrolled to and highlighting a line range. When the deck is done
you get a notification; you open the views when you're ready. show-me never
moves focus on its own.

Agents find this Neovim through a registry entry pointing at Neovim's own RPC
server (|v:servername|). See protocol/PROTOCOL.md in the plugin directory.

==============================================================================
2. SETUP                                                     *show-me-setup*

>lua
    require('show_me').setup({})
<
setup() registers this Neovim (at |VimEnter|, or at once if that has already
happened), defines the mappings and |:ShowMe|, and closes the show-me tab
before any |:mksession| (|SessionWritePre|), so sessions never restore it.

==============================================================================
3. OPTIONS                                                   *show-me-options*

keys            Table, or false for no mappings (only |show-me-<Plug>|).
                  view_prefix  '<leader>v'   followed by 1-9
                  next         ']v'
                  prev         '[v'
                  pick         '<leader>vd'
                  close        '<leader>vq'

sidebar         filetypes  { 'neo-tree', 'NvimTree' }
                  Windows of these filetypes are sidebars: mirrored into the
                  show-me tab when it opens and kept, at their width, across
                  view switches. A list you give replaces this one.
                open       { [filetype] = function() ... end }
                  How to open each sidebar in the show-me tab.

picker          'auto' (snacks if loaded, else |vim.ui.select()|),
                'snacks' or 'select'.

state_dir       Where decks are stored. Default: stdpath('state')/show-me.

==============================================================================
4. MAPPINGS                                   *show-me-mappings* *show-me-<Plug>*

<Plug>(show-me-view-1) ... <Plug>(show-me-view-9)   Open view N
<Plug>(show-me-next)                                Next view (show-me tab only)
<Plug>(show-me-prev)                                Previous view (show-me tab only)
<Plug>(show-me-pick)                                Pick a recent deck
<Plug>(show-me-close)                               Close the show-me tab

==============================================================================
5. COMMANDS                                                  *:ShowMe*

:ShowMe {n}     Open view {n} of the current deck.
:ShowMe         Pick a recent deck; it becomes current and opens at view 1.

:checkhealth show_me   Check the RPC server, the registry entry and the CLI.

==============================================================================
6. HIGHLIGHTS                                            *show-me-highlights*

ShowMeRange     The highlighted line range. Linked to |hl-Visual| by default.

 vim:tw=78:ts=8:ft=help:norl:
```

`CONTRIBUTING.md`:

````markdown
# Contributing

## Setup

You need Go (the version in `go.mod`), Neovim 0.10+ and git.

```sh
go test ./...                  # unit tests, plus the conformance suite against Neovim
./test/nvim/run.sh             # Neovim specs (nvim --clean -l)
./test/install/install_test.sh # installer against a fake local release
```

## Adding an editor

An editor port stores decks and renders them. The CLI already checks
everything stateless. To add one:

1. Implement everything in "What every editor does" in
   [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md).
2. Write the registry entry on start, rewrite it when the workspace changes,
   update `focused_at` on focus, and delete it on exit.
3. Serve a transport the CLI speaks, or add one to `internal/transport`.
4. Add the editor to `test/conformance` and make the whole suite pass.

## Releasing

1. Bump `VERSION`; protocol changes also bump `protocol.Version` and every
   editor's protocol constant in the same commit.
2. Tag `v$(cat VERSION)` and push the tag; `.github/workflows/release.yml` runs
   goreleaser.
````

- [ ] **Step 3: Write the release and CI configuration**

`.goreleaser.yaml`:

```yaml
# Release builds: six binaries, archives named without the version so
# install.sh can fetch releases/latest/download/<asset>, and checksums.
version: 2
project_name: show-me

builds:
  - main: ./cmd/show-me
    binary: show-me
    env: [CGO_ENABLED=0]
    goos: [darwin, linux, windows]
    goarch: [amd64, arm64]
    ldflags: ["-s -w -X main.version={{ .Version }}"]

archives:
  - name_template: "show-me_{{ .Os }}_{{ .Arch }}"
    formats: [tar.gz]
    format_overrides:
      - goos: windows
        formats: [zip]
    files:
      - LICENSE
      - README.md
      - src: skills/show-me/*
        dst: skills/show-me

checksum:
  name_template: checksums.txt

release:
  extra_files:
    - glob: ./install.sh
    - glob: ./install.ps1
```

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - uses: rhysd/action-setup-vim@v1
        with:
          neovim: true
          version: stable
      - run: go vet ./...
      - run: go test ./...
      - run: ./test/nvim/run.sh
        shell: bash
      - run: ./test/install/install_test.sh
        if: runner.os != 'Windows'
        shell: bash
      - run: ./test/install/install_test.ps1
        if: runner.os == 'Windows'
        shell: pwsh
      - run: shellcheck install.sh test/nvim/run.sh test/install/install_test.sh
        if: runner.os == 'Linux'

  goreleaser-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: goreleaser/goreleaser-action@v6
        with:
          version: "~> v2"
          args: check
```

`.github/workflows/release.yml`:

```yaml
name: release
on:
  push:
    tags: ["v*"]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: VERSION matches the tag
        run: test "v$(cat VERSION)" = "$GITHUB_REF_NAME"
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - uses: goreleaser/goreleaser-action@v6
        with:
          version: "~> v2"
          args: release --clean
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 4: Verify**

Run:

```bash
nvim --clean --headless -c 'helptags doc' -c 'help show-me' -c 'qa!' 2>&1 && echo HELP_OK
ruby -ryaml -e 'ARGV.each { |f| YAML.load_file(f) }; puts "YAML_OK"' .goreleaser.yaml .github/workflows/ci.yml .github/workflows/release.yml
go test ./... && ./test/nvim/run.sh && ./test/install/install_test.sh
```

Expected: `HELP_OK`, `YAML_OK`, and all three suites green. The real check of
`.goreleaser.yaml` is the `goreleaser-check` CI job, because goreleaser isn't
installed locally. Leave the generated `doc/tags` file untracked; plugin
managers generate it themselves.

- [ ] **Step 5: Commit**

```bash
printf 'doc/tags\n' >> .gitignore
git add protocol README.md doc/show-me.txt CONTRIBUTING.md .goreleaser.yaml .github .gitignore
git commit -m "docs: protocol contract, README, Vim help, CI and release pipeline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Switch kickstart.nvim to the plugin

Everything in this task happens in `~/repos/kickstart.nvim`. One step changes the real home directory (prototype symlinks and the installed CLI), and the step says so.

**Files (kickstart.nvim):**
- Create: `lua/custom/plugins/show-me.lua`
- Modify:
  - `init.lua`: delete the block from `-- show-me: terminal agents` through `-- stylua: ignore end`. Keep the which-key `<leader>v` group.
  - `lua/custom/plugins/auto-session.lua`: delete the `pre_save_cmds` block and its comment.
  - `README.md`: replace the `### show-me: agents point at code` section, and drop the two `show_me` and `show-me-nvim` lines from `### Layout`.
  - `CHEATSHEET.md`: replace the line under `## Agent Views (show-me)`.
- Delete:
  - `lua/custom/show_me/`
  - `skills/show-me-nvim/`
  - `test/spec/show_me_*_spec.lua`
  - `.github/workflows/specs.yml`, which existed only to run the show-me specs
- Keep the old spec and plan under `docs/superpowers/` as history.

- [ ] **Step 1: Branch, and write the failing check**

```bash
cd ~/repos/kickstart.nvim
git switch -c ian/chore/show-me-plugin ian/feat/beacon-workflow
cat > /tmp/claude-show-me-check.lua <<'EOF'
vim.defer_fn(function()
  local ok, registry = pcall(require, 'show_me.registry')
  local registered = ok and vim.uv.fs_stat(registry.file()) ~= nil
  io.stdout:write(registered and 'registered\n' or 'missing\n')
  vim.cmd 'qa!'
end, 3000)
EOF
nvim --headless -c 'luafile /tmp/claude-show-me-check.lua'
```

Expected: `missing`. The config still uses `custom.show_me` and doesn't have the plugin yet.

- [ ] **Step 2: Add the plugin spec**

`lua/custom/plugins/show-me.lua`:

```lua
-- show-me: terminal agents (Claude Code, Codex, Cursor) open code here while
-- they explain it. It lives in its own repository; the build hook installs the
-- matching `show-me` CLI and links the agent skill. Switch `dir` to
-- 'chanceygardener/show-me' once it is published.
return {
  dir = '~/repos/show-me',
  name = 'show-me',
  event = 'VeryLazy',
  build = function(plugin)
    local result = vim.system({ 'sh', plugin.dir .. '/install.sh', '--for-plugin', plugin.dir }, { text = true }):wait()
    assert(result.code == 0, result.stderr)
  end,
  opts = {},
}
```

- [ ] **Step 3: Remove the prototype wiring and files**

- In `init.lua`, delete everything from the line `-- show-me: terminal agents (Claude Code, Codex, Cursor) show code here through` through `-- stylua: ignore end` (the `require('custom.show_me').setup()` call and the `<leader>v` mappings). Leave `{ '<leader>v', group = '[V]iew (show-me)' },` in the which-key spec.
- In `lua/custom/plugins/auto-session.lua`, delete the comment starting `-- The show-me tab is transient` and the `pre_save_cmds = { … },` table under it. The plugin's `SessionWritePre` autocmd replaces them.

```bash
git rm -r lua/custom/show_me skills/show-me-nvim .github/workflows/specs.yml test/spec/show_me_*_spec.lua
grep -rn "custom.show_me\|show-me-nvim\|show_me_" --include='*.lua' --include='*.md' --include='*.sh' . | grep -v '^./docs/superpowers/'
```

Expected: the only `grep` hits are in `README.md` and `CHEATSHEET.md`, which Step 4 rewrites.

- [ ] **Step 4: Update the docs**

In `README.md`, replace the whole `### show-me: agents point at code` section (up to `### Layout`) with:

```markdown
### show-me: agents point at code

Terminal agents (Claude Code, Codex, Cursor) can show code in this Neovim while
they explain it, through the [show-me](https://github.com/chanceygardener/show-me)
plugin (`lua/custom/plugins/show-me.lua`). Its build step installs the `show-me`
CLI and agent skill. Keys are under `Space v` (see the CHEATSHEET), and
`:checkhealth show_me` diagnoses an agent that can't reach Neovim.
```

In the `### Layout` block, delete these two lines:

```
lua/custom/show_me/         show-me: agent-built views, the socket agents reach it by
skills/show-me-nvim/        the show-me agent skill: SKILL.md, the CLI, install.sh
```

In `CHEATSHEET.md`, replace `Views a terminal agent prepared with the `show-me` skill. See the README.` with:

```markdown
Views a terminal agent prepared with the show-me plugin. `:checkhealth show_me` if an agent can't reach Neovim.
```

- [ ] **Step 5: Install from the checkout (this changes your home directory)**

This step removes the prototype's symlinks and installs the new CLI and skill. No release exists yet, so the installer builds the binary with Go.

```bash
for d in ~/.claude/skills ~/.codex/skills ~/.cursor/skills; do [ -L "$d/show-me-nvim" ] && rm "$d/show-me-nvim"; done
[ -L ~/.local/bin/show-me ] && rm ~/.local/bin/show-me
nvim --headless '+Lazy! build show-me' +qa
~/.local/bin/show-me version
```

Expected: `show-me 0.1.0-dev (protocol 1)`. If lazy.nvim doesn't run `build` for a `dir` plugin, run `sh ~/repos/show-me/install.sh --for-plugin ~/repos/show-me` directly and expect the same output. Record a ruling either way.

- [ ] **Step 6: Verify**

```bash
nvim --headless -c 'luafile /tmp/claude-show-me-check.lua'
./test/run.sh
nvim --headless -c 'checkhealth show_me' -c 'w! /tmp/claude-show-me-health.txt' -c 'qa!' && grep -E 'OK|WARNING|ERROR' /tmp/claude-show-me-health.txt
```

Expected:
- `registered`
- `all specs passed`, with no `show_me_*` specs listed
- checkhealth shows `OK` for the Neovim version, RPC server, registration and CLI lines

- [ ] **Step 7: Commit**

```bash
git add -A lua/custom/plugins/show-me.lua init.lua lua/custom/plugins/auto-session.lua README.md CHEATSHEET.md
git commit -m "chore(show-me): use the standalone show-me plugin instead of the in-config prototype" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final step: tests and docs checklist

Before finishing the branch, confirm:

- **Tests:**
  - `go test ./...` passes, which includes the conformance suite.
  - `./test/nvim/run.sh` passes.
  - `./test/install/install_test.sh` passes.
  - kickstart.nvim's `./test/run.sh` passes.
- **Docs:**
  - `protocol/PROTOCOL.md`, `README.md`, `doc/show-me.txt`, `CONTRIBUTING.md` and `skills/show-me/SKILL.md` describe the shipped behaviour.
  - Each Lua and Go file has a module docstring.
  - The spec's Testing section matches what exists. Note any differences as rulings.
- **Not done here, and the user's decision:**
  - creating `github.com/chanceygardener/show-me`
  - pushing either repository
  - tagging `v0.1.0`
  - switching the kickstart plugin spec from `dir` to the GitHub name
