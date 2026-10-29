# show-me Phase 2 (VS Code, `currentWindow`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code extension that stores and renders show-me decks in the current window, the Go `ndjson` transport that reaches it, protocol types generated from Go for TypeScript, and a conformance suite that runs unchanged against Neovim and VS Code.

**Architecture:** The CLI keeps validating every request; the extension only stores and renders, as the Neovim plugin does. The extension is split into a `src/core/` layer with no `vscode` import (paths, store, session, RPC, registry, NDJSON server, layout maths, tab ledger, formatting), unit-tested with `node:test`, and a thin `src/` layer that touches the VS Code API (rendering, commands, activation), tested inside VS Code with `@vscode/test-cli`. The Go conformance suite gains an editor-driver abstraction; its VS Code driver launches a downloaded VS Code with the extension plus a dev-only harness extension that lets the Go test fake window focus.

**Tech Stack:** Go 1.26 with `github.com/invopop/jsonschema` v0.14.0 (generator only); TypeScript 7.0.2 (type-check only), esbuild 0.28.2, Node 24 in CI (native type stripping runs `.ts` unit tests); `@types/vscode` 1.90.0 with `engines.vscode` `^1.90.0`; `json-schema-to-typescript` 16.0.0; `@vscode/test-electron` 3.1.0, `@vscode/test-cli` 0.0.15, mocha 12.0.3; `@vscode/vsce` 4.0.0, `ovsx` 1.2.0; npm.

**Spec:** `docs/specs/2026-10-17-show-me-design.md` (sections *VS Code extension (phase 2)*, *Editor responsibilities*, *Testing*, *Releases and CI*), `protocol/PROTOCOL.md`, and GitHub issue chanceygardener/show-me#2, the starting brief for this phase.

## Global Constraints

- Protocol version stays `1`. Nothing in this plan changes a request or reply shape, so Neovim needs no change.
- Rejection messages are verbatim from PROTOCOL.md, plus `bad token` (ndjson only). The conformance suite depends on the exact text.
- Reply shapes match the Neovim plugin exactly (`lua/show_me/rpc.lua`): `{"deck":n}`, `{"view":n}`, `{"deck":n,"views":n,"open_hint":s}`, `{"editor":"vscode","workspace_folders":[…],"current":{…}|null}`.
- Datetimes are integer epoch milliseconds (`created_at`, `started_at`, `focused_at`).
- Every data shape has a type: Go structs; TypeScript `type`s. Wire shapes come only from `vscode/src/core/protocol.gen.ts`, which is generated and never hand-edited.
- Nothing under `vscode/src/core/` imports `vscode`. A unit test enforces it.
- TypeScript uses erasable syntax only (no `enum`, no `namespace`, no constructor parameter properties), so Node runs the unit tests without a build. Relative imports carry their `.ts` extension.
- Base directory: `$SHOW_ME_HOME`, else `$XDG_STATE_HOME/show-me`, else `~/.local/state/show-me`; `%LOCALAPPDATA%\show-me` on Windows. Empty variables count as unset.
- Registry entry `<base>/editors/vscode-<pid>.json`, mode 0600, temp file then rename. Socket `<base>/sock/vscode-<pid>.sock` (POSIX, dir 0700) or `\\.\pipe\show-me-vscode-<pid>-<8 hex>` (Windows). Token: 32 random bytes, hex (64 characters).
- `<pid>` is the extension host's `process.pid`: one per window, and the process whose exit makes the entry stale.
- Default keys are chords: `ctrl+alt+v 1`…`9`, `ctrl+alt+v ]`, `ctrl+alt+v [`, `ctrl+alt+v d`, `ctrl+alt+v q`. `open_hint` is `ctrl+alt+v 1`.
- File identity in VS Code is always `vscode.Uri.file(path).toString()`, on both sides of a comparison. This normalises Windows drive-letter case.
- `showTextDocument` is never called with `preview: true` for a file the user didn't already have open as a preview. A preview open would replace the user's preview tab.
- The extension never writes the CLI binary. It only offers to run the installer one-liner in a terminal.
- Any intentional rule break gets a `RULE EXCEPTION:` comment at the point of deviation.
- Don't run stylua, gofmt or prettier across files you didn't write. Run `gofmt -w` only on Go files you create or edit.

## Decisions made before planning

These were settled with the user on 2026-10-28. Executors should not relitigate them.

- **Multi-root store:** new decks go into the store of the **first** workspace folder. `status` and the registry list every folder.
- **Conformance driver for VS Code:** a dev-only **harness extension** (`vscode/test/harness/`) is loaded alongside the real one. It exposes a socket the Go driver uses to fake window focus; it calls the real extension's exported API (`activate()` returns `{ touch() }`).
- **Tooling:** npm and esbuild.
- **Publishing:** gated. The release workflow builds the `.vsix`, attaches it to the GitHub release, and publishes only when the `VSCE_PAT` and `OVSX_PAT` secrets exist. `package.json`'s `publisher` is the placeholder `chanceygardener` until the user confirms an id.

## Rulings made while planning

- **`extensionKind: ["workspace"]`.** On a local window this behaves the same as `ui`; on Remote it puts the registry entry and socket next to the CLI. Remote isn't tested in this phase (the spec's non-goals rule it out); record the choice in `vscode/README.md`.
- **Never shrink, judged against the user's own groups.** A view's layout is applied when the user's group count *at snapshot time* is ≤ the view's pane count. Otherwise the view fills groups 1…N of the user's layout and its geometry is the user's. Counting the snapshot, not the current window, means stepping from a `cols3` view to a `cols2` view still gives two columns.
- **Restore check.** At `close`, the snapshot's layout and active tabs are restored only if the window's group count still equals the count show-me left after its last view. The count is taken before show-me closes anything, because `workbench.editor.closeEmptyGroups` removes groups as their last tab closes.
- **Switching order.** Open the new view's panes first, then close the created tabs the new view doesn't reuse. That order avoids empty-group collapse and flicker.
- **A created tab the user has since edited** (`isDirty`) is the user's: it is left open and logged, never closed.
- **Borrowed preview tabs stay preview tabs.** A borrowed tab is reopened with its own `isPreview`.
- **Active tabs that aren't text editors** (diffs, notebooks, webviews) can't be re-activated through the API, so restoring skips them.
- **A window with no folder open** registers with `workspace_folders: []` (the CLI never picks it). If a request reaches it anyway (via `SHOW_ME_EDITOR`), it is rejected with `this VS Code window has no folder open`.
- **Highlight colour.** `showMe.rangeBackground` defaults to `editor.rangeHighlightBackground`, the colour VS Code uses for its own range highlights. Lines are highlighted whole, like Neovim's `hl_eol`.
- **Caption.** One status-bar item shows the caption of the pane whose editor is active, falling back to pane 1.
- **The invopop dependency** lands in the main `go.mod`, but only `internal/protocol/schemagen` imports it, so the CLI binary is unchanged.
- **Unit tests run TypeScript directly** with Node 24's type stripping (`node --test "test/unit/*.test.ts"`). TypeScript itself is used only for `tsc --noEmit`.
- **The extension bundle is `dist/extension.cjs`**, because `vscode/package.json` is `"type": "module"` so that Node treats the `.ts` unit tests and scripts as ESM. Task 8 checks that VS Code 1.90 loads a `.cjs` main; if it doesn't, see the fallback in Task 8.

## Review Focus

Five input classes the spec implies but no requirement line tests, most likely first. Each has a test in the task that owns the code.

1. **The user's dirty tab, or their preview tab, in a group a view uses.** It must never be closed (closing opens a save dialog) and never turned into a pinned tab. Covered in Task 7: "never closes or pins a user tab".
2. **A deep `SHOW_ME_HOME` or `XDG_STATE_HOME`** pushes the socket path past the 103-byte Unix limit. The extension must say so in a warning, not fail silently. Covered in Task 5: `refuses a socket path over the limit`.
3. **Workspace folders change while a deck is unfinished.** Later `view` and `done` calls must reach the deck's original store, which is the VS Code version of Neovim's `:cd` bug. Covered in Task 4: `keeps an unfinished deck in its store when folders change`.
4. **The user reshapes the window while a view is open** (splits, or drags a tab to a new group). `close` must not force the old layout back, and it must close only show-me's own tabs. Covered in Task 7: "leaves a reshaped layout alone".
5. **A stale socket file left by a crashed window whose pid was reused.** `listen` must replace it, not fail with `EADDRINUSE`. Covered in Task 5: `replaces a stale socket file`.

## Branches

- The show-me repo: work on `ian/feat/phase-2`, created from `main`. The branch already exists and holds this plan.
- Nothing in this plan pushes, opens a PR, tags, creates a Marketplace publisher, or adds secrets. Those are the user's call.

## File Structure

New and changed files (all in `~/repos/show-me`):

| Path | Responsibility |
|---|---|
| `internal/protocol/protocol.go` | + `EditorNvim`, `EditorVSCode`, `TransportNDJSON`; `jsonschema` enum/nullable tags; `//go:generate` |
| `internal/protocol/schemagen/main.go` | **New.** Writes `protocol/schema.json` from the protocol types |
| `protocol/schema.json` | **New, generated.** JSON Schema for requests, replies, results, registry entries |
| `internal/transport/transport.go` | Routes `ndjson` to the new client |
| `internal/transport/ndjson.go` | **New.** The NDJSON client |
| `internal/transport/ndjson_test.go`, `listen_unix_test.go`, `listen_windows_test.go` | **New.** Fake NDJSON editor and its tests |
| `test/conformance/conformance_test.go` | Editor-neutral tests over a driver list |
| `test/conformance/nvim_test.go` | **New.** The Neovim driver (moved out of `conformance_test.go`) |
| `test/conformance/vscode_test.go`, `proc_unix_test.go`, `proc_windows_test.go` | **New.** The VS Code driver and process-tree kill |
| `vscode/package.json`, `package-lock.json`, `tsconfig.json`, `.vscodeignore`, `.gitignore`, `.vscode-test.mjs` | **New.** Manifest, tooling config |
| `vscode/scripts/gen-types.mjs`, `vscode/scripts/build.mjs` | **New.** Type generation and esbuild bundling |
| `vscode/src/core/protocol.gen.ts` | **New, generated.** Wire types |
| `vscode/src/core/paths.ts` | **New.** Base dir, socket address, private dirs, folder resolution, finding the CLI |
| `vscode/src/core/format.ts` | **New.** Open hint, captions, notices, picker items |
| `vscode/src/core/store.ts` | **New.** Decks on disk, editor-side rejections, pruning |
| `vscode/src/core/session.ts` | **New.** Folders served, their store, unfinished decks, current deck |
| `vscode/src/core/rpc.ts` | **New.** `Rpc.handle(line) → line` |
| `vscode/src/core/registry.ts` | **New.** This window's registry entry |
| `vscode/src/core/server.ts` | **New.** NDJSON server on a socket or pipe |
| `vscode/src/core/layout.ts` | **New.** Layout → `setEditorLayout` argument; never-shrink rule; snapshot type |
| `vscode/src/core/tabs.ts` | **New.** Created and borrowed tab ledger |
| `vscode/src/render.ts` | **New.** `currentWindow` rendering over editor groups |
| `vscode/src/navigator.ts` | **New.** Commands, notification, picker |
| `vscode/src/installer.ts` | **New.** "Run installer" offer |
| `vscode/src/extension.ts` | **New.** Activation wiring and the exported test API |
| `vscode/test/unit/*.test.ts` | **New.** `node:test` unit tests |
| `vscode/test/integration/render.test.ts`, `vscode/test/fixtures/workspace/*` | **New.** In-editor rendering tests |
| `vscode/test/harness/package.json`, `extension.cjs` | **New.** Dev-only harness extension |
| `vscode/test/conformance/vscode-path.mjs` | **New.** Downloads VS Code for the Go driver |
| `vscode/README.md` | **New.** Marketplace page |
| `.github/workflows/ci.yml`, `release.yml` | Extension job; vsix build and gated publish |
| `protocol/PROTOCOL.md`, `README.md`, `CONTRIBUTING.md`, `skills/show-me/SKILL.md`, `docs/specs/2026-10-17-show-me-design.md`, `.gitignore` | Docs |

---

### Task 1: The `ndjson` transport

**Files:**
- Modify: `internal/protocol/protocol.go:22-23`
- Modify: `internal/transport/transport.go:1-48`
- Create: `internal/transport/ndjson.go`
- Create: `internal/transport/ndjson_test.go`, `internal/transport/listen_unix_test.go`, `internal/transport/listen_windows_test.go`
- Modify: `internal/transport/transport_test.go:92-98`

**Interfaces:**
- Consumes: `transport.Dial(address string, timeout time.Duration) (net.Conn, error)`, `DialTimeout`, `RequestTimeout`, `*Unreachable`, `testAddress(t)` (all existing).
- Produces: `protocol.TransportNDJSON = "ndjson"`, `protocol.EditorNvim = "nvim"`, `protocol.EditorVSCode = "vscode"`; `Send` handles `Kind: "ndjson"` and copies `t.Token` into the request.

- [ ] **Step 1: Write the fake editor's listener helpers**

`internal/transport/listen_unix_test.go`:

```go
//go:build !windows

package transport

import "net"

func listen(address string) (net.Listener, error) { return net.Listen("unix", address) }
```

`internal/transport/listen_windows_test.go`:

```go
//go:build windows

package transport

import (
	"net"

	"github.com/Microsoft/go-winio"
)

func listen(address string) (net.Listener, error) { return winio.ListenPipe(address, nil) }
```

- [ ] **Step 2: Write the failing tests**

`internal/transport/ndjson_test.go`:

```go
package transport

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// serveNDJSON is a fake NDJSON editor. handle answers each request line; an
// empty answer means "say nothing", like a suspended editor.
func serveNDJSON(t *testing.T, handle func(line []byte) string) string {
	t.Helper()
	addr := testAddress(t)
	ln, err := listen(addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				line, err := bufio.NewReader(conn).ReadBytes('\n')
				if err != nil {
					return
				}
				if answer := handle(line); answer != "" {
					_, _ = io.WriteString(conn, answer+"\n")
					return
				}
				_, _ = io.Copy(io.Discard, conn)
			}()
		}
	}()
	return addr
}

func TestNDJSONSendsTokenAsOneLine(t *testing.T) {
	var got protocol.Request
	addr := serveNDJSON(t, func(line []byte) string {
		if strings.Count(string(line), "\n") != 1 {
			return `{"ok":false,"error":"not one line"}`
		}
		_ = json.Unmarshal(line, &got)
		return `{"ok":true,"result":{"view":2}}`
	})
	reply, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: addr, Token: "secret"},
		protocol.Request{Protocol: protocol.Version, Command: protocol.CommandView, Deck: 7})
	if err != nil {
		t.Fatal(err)
	}
	if !reply.OK || string(reply.Result) != `{"view":2}` {
		t.Fatalf("reply %+v", reply)
	}
	if got.Token != "secret" || got.Command != protocol.CommandView || got.Deck != 7 {
		t.Fatalf("the editor received %+v", got)
	}
}

func TestNDJSONNobodyListening(t *testing.T) {
	_, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: testAddress(t)}, protocol.Request{})
	var u *Unreachable
	if !errors.As(err, &u) {
		t.Fatalf("want *Unreachable, got %v", err)
	}
}

func TestNDJSONSilentEditor(t *testing.T) {
	old := RequestTimeout
	RequestTimeout = 300 * time.Millisecond
	t.Cleanup(func() { RequestTimeout = old })
	addr := serveNDJSON(t, func([]byte) string { return "" })

	start := time.Now()
	_, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: addr}, protocol.Request{Protocol: 1, Command: "status"})
	var u *Unreachable
	if !errors.As(err, &u) || !strings.Contains(err.Error(), "no reply within") {
		t.Fatalf("want *Unreachable naming the deadline, got %v", err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("a silent editor held the CLI for %s", elapsed)
	}
}

func TestNDJSONUnreadableReply(t *testing.T) {
	addr := serveNDJSON(t, func([]byte) string { return "not json" })
	_, err := Send(protocol.Transport{Kind: protocol.TransportNDJSON, Address: addr}, protocol.Request{})
	var u *Unreachable
	if err == nil || errors.As(err, &u) {
		t.Fatalf("want a plain error, got %v", err)
	}
}
```

Change `TestSendUnsupportedTransport` in `transport_test.go` so it no longer uses a kind that now exists:

```go
func TestSendUnsupportedTransport(t *testing.T) {
	_, err := Send(protocol.Transport{Kind: "carrier-pigeon", Address: "x"}, protocol.Request{})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `go test ./internal/transport -run 'NDJSON' -v`
Expected: FAIL to compile with `undefined: protocol.TransportNDJSON`.

- [ ] **Step 4: Add the constants**

In `internal/protocol/protocol.go`, replace the `TransportNvim` declaration (lines 22-23) with:

```go
// Editors that publish registry entries.
const (
	EditorNvim   = "nvim"
	EditorVSCode = "vscode"
)

// Transport kinds the CLI speaks.
const (
	// TransportNvim is Neovim's own msgpack-RPC server, called with nvim_exec_lua.
	TransportNvim = "nvim"
	// TransportNDJSON is one JSON request line and one JSON reply line over a
	// Unix socket or named pipe, authenticated by the entry's token (VS Code).
	TransportNDJSON = "ndjson"
)
```

- [ ] **Step 5: Write the client**

`internal/transport/ndjson.go`:

```go
package transport

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// sendNDJSON writes req, carrying t's token, as one line and reads one reply
// line. The editor closes the connection after replying.
func sendNDJSON(t protocol.Transport, req protocol.Request) (protocol.Reply, error) {
	req.Token = t.Token
	body, err := json.Marshal(req)
	if err != nil {
		return protocol.Reply{}, err
	}
	conn, err := Dial(t.Address, DialTimeout)
	if err != nil {
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: err}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(RequestTimeout))

	if _, err := conn.Write(append(body, '\n')); err != nil {
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: err}
	}
	line, err := bufio.NewReader(conn).ReadBytes('\n')
	if err != nil && !(errors.Is(err, io.EOF) && len(line) > 0) {
		var timeout net.Error
		if errors.As(err, &timeout) && timeout.Timeout() {
			err = fmt.Errorf("no reply within %s (is the editor suspended?)", RequestTimeout)
		}
		return protocol.Reply{}, &Unreachable{Address: t.Address, Err: err}
	}
	var reply protocol.Reply
	if err := json.Unmarshal(line, &reply); err != nil {
		return protocol.Reply{}, fmt.Errorf("editor at %s sent an unreadable reply: %w", t.Address, err)
	}
	return reply, nil
}
```

In `transport.go`, route the new kind and update the package comment:

```go
// Package transport delivers one request to one editor and returns its reply.
//
// Two transports exist. `nvim` speaks to Neovim's built-in msgpack-RPC
// server: the request JSON is passed to the plugin's rpc.handle with
// nvim_exec_lua, so nothing is quoted into Vimscript. `ndjson` writes one
// request line to a socket or named pipe and reads one reply line (VS Code).
// Any other kind is reported as unreachable, and the CLI moves on.
```

```go
	switch t.Kind {
	case protocol.TransportNvim:
		return sendNvim(t.Address, req)
	case protocol.TransportNDJSON:
		return sendNDJSON(t, req)
	default:
```

- [ ] **Step 6: Run the tests**

Run: `gofmt -w internal/transport/ndjson.go internal/transport/ndjson_test.go internal/transport/listen_*_test.go internal/transport/transport.go internal/protocol/protocol.go && go vet ./... && go test ./internal/... ./cmd/...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/protocol/protocol.go internal/transport
git commit -m "feat(transport): add the ndjson transport for socket and pipe editors"
```

---

### Task 2: Generated schema and TypeScript types; extension scaffold

**Files:**
- Modify: `internal/protocol/protocol.go` (struct tags, `//go:generate`)
- Create: `internal/protocol/schemagen/main.go`
- Create (generated): `protocol/schema.json`
- Create: `vscode/package.json`, `vscode/tsconfig.json`, `vscode/.gitignore`, `vscode/.vscodeignore`, `vscode/scripts/gen-types.mjs`
- Create (generated): `vscode/src/core/protocol.gen.ts`, `vscode/package-lock.json`
- Create: `vscode/test/unit/version.test.ts`
- Modify: `go.mod`, `go.sum`

**Interfaces:**
- Produces: TS types `Request`, `View`, `Pane`, `Reply`, `DeckResult`, `ViewResult`, `DoneResult`, `StatusResult`, `CurrentDeck`, `Entry`, `Transport` exported from `vscode/src/core/protocol.gen.ts`, with `Request['command']` = `'deck'|'view'|'done'|'status'`, `View['layout']` = `'single'|'cols2'|'cols3'|'main-stack'`, `Entry['editor']` = `'nvim'|'vscode'`, `Transport['kind']` = `'nvim'|'ndjson'`, `StatusResult['current']` = `CurrentDeck | null`. npm scripts `gen`, `typecheck`, `test`.

- [ ] **Step 1: Tag the protocol types**

In `internal/protocol/protocol.go`, add under the package clause's imports:

```go
//go:generate go run ./schemagen -o ../../protocol/schema.json
```

and change these fields' tags:

```go
	Command  string `json:"command" jsonschema:"enum=deck,enum=view,enum=done,enum=status"`
```
```go
	Layout string `json:"layout" jsonschema:"enum=single,enum=cols2,enum=cols3,enum=main-stack"`
```
```go
	Editor           string       `json:"editor" jsonschema:"enum=nvim,enum=vscode"`
	WorkspaceFolders []string     `json:"workspace_folders"`
	Current          *CurrentDeck `json:"current" jsonschema:"nullable"`
```
```go
	Editor           string    `json:"editor" jsonschema:"enum=nvim,enum=vscode"`
```
```go
	Kind    string `json:"kind" jsonschema:"enum=nvim,enum=ndjson"`
```

Update the package comment's second paragraph to: `These types are the contract in protocol/PROTOCOL.md. protocol/schema.json is generated from them (go generate), and the VS Code extension's types are generated from that.`

- [ ] **Step 2: Write the generator**

`internal/protocol/schemagen/main.go`:

```go
// Command schemagen writes protocol/schema.json, the JSON Schema of every
// shape the CLI and editors exchange. Run it with `go generate ./internal/protocol`.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/invopop/jsonschema"

	"github.com/chanceygardener/show-me/internal/protocol"
)

// document gathers every exchanged shape under one root, so each becomes a
// named definition that generated code can refer to.
type document struct {
	Request      protocol.Request      `json:"request"`
	Reply        protocol.Reply        `json:"reply"`
	DeckResult   protocol.DeckResult   `json:"deck_result"`
	ViewResult   protocol.ViewResult   `json:"view_result"`
	DoneResult   protocol.DoneResult   `json:"done_result"`
	StatusResult protocol.StatusResult `json:"status_result"`
	Entry        protocol.Entry        `json:"entry"`
}

func main() {
	out := flag.String("o", "", "file to write the schema to")
	flag.Parse()
	if *out == "" {
		fmt.Fprintln(os.Stderr, "schemagen: -o is required")
		os.Exit(2)
	}
	// ExpandedStruct inlines the root: json-schema-to-typescript rejects a top-level $ref.
	schema := (&jsonschema.Reflector{ExpandedStruct: true}).Reflect(&document{})
	schema.Title = "ShowMeProtocol"
	schema.Description = fmt.Sprintf("show-me protocol %d. Generated from internal/protocol; do not edit.", protocol.Version)
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "schemagen:", err)
		os.Exit(1)
	}
	if err := os.WriteFile(*out, append(data, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "schemagen:", err)
		os.Exit(1)
	}
}
```

- [ ] **Step 3: Generate the schema**

Run: `go get github.com/invopop/jsonschema@v0.14.0 && go generate ./internal/protocol && go mod tidy`
Expected: `protocol/schema.json` exists, and `jq '.["$defs"].StatusResult.properties.current' protocol/schema.json` prints a `oneOf` of `{"$ref": "#/$defs/CurrentDeck"}` and `{"type": "null"}`. (Verified with a prototype while planning.)

- [ ] **Step 4: Scaffold the extension package**

`vscode/package.json` (contributions are filled in by Task 8; keep the key order):

```json
{
  "name": "show-me",
  "displayName": "show-me",
  "description": "Lets terminal coding agents show you code as decks of multi-pane views.",
  "version": "0.1.0",
  "publisher": "chanceygardener",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/chanceygardener/show-me", "directory": "vscode" },
  "type": "module",
  "main": "./dist/extension.cjs",
  "engines": { "vscode": "^1.90.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "categories": ["Other"],
  "capabilities": { "untrustedWorkspaces": { "supported": true }, "virtualWorkspaces": false },
  "contributes": {},
  "scripts": {
    "gen": "node scripts/gen-types.mjs",
    "typecheck": "tsc -p .",
    "test": "node --test \"test/unit/*.test.ts\""
  },
  "devDependencies": {
    "@types/mocha": "10.0.10",
    "@types/node": "20.19.43",
    "@types/vscode": "1.90.0",
    "@vscode/test-cli": "0.0.15",
    "@vscode/test-electron": "3.1.0",
    "@vscode/vsce": "4.0.0",
    "esbuild": "0.28.2",
    "json-schema-to-typescript": "16.0.0",
    "mocha": "12.0.3",
    "ovsx": "1.2.0",
    "typescript": "7.0.2"
  }
}
```

`vscode/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": ["node", "vscode", "mocha"]
  },
  "include": ["src", "test"]
}
```

`vscode/.gitignore`:

```
node_modules/
dist/
out/
.vscode-test/
*.vsix
LICENSE
```

`vscode/.vscodeignore`:

```
**
!dist/extension.cjs
!package.json
!README.md
!LICENSE
```

`vscode/scripts/gen-types.mjs`:

```js
// Generates src/core/protocol.gen.ts from ../protocol/schema.json, which
// `go generate ./internal/protocol` writes from the Go types.
import { writeFileSync } from 'node:fs';
import { compileFromFile } from 'json-schema-to-typescript';

const banner = '// Generated from protocol/schema.json by scripts/gen-types.mjs. Do not edit.';
const types = await compileFromFile('../protocol/schema.json', {
  bannerComment: banner,
  unreachableDefinitions: true,
  additionalProperties: false,
  cwd: '..',
});
writeFileSync('src/core/protocol.gen.ts', types);
```

- [ ] **Step 5: Write a failing version test**

`vscode/test/unit/version.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('the extension version equals the repository VERSION', () => {
  const manifest: { version: string } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const version = readFileSync(new URL('../../../VERSION', import.meta.url), 'utf8').trim();
  assert.equal(manifest.version, version);
});

test('the generated types match the Go protocol', () => {
  const generated = readFileSync(new URL('../../src/core/protocol.gen.ts', import.meta.url), 'utf8');
  assert.match(generated, /command: "deck" \| "view" \| "done" \| "status";/);
  assert.match(generated, /current: CurrentDeck \| null;/);
});
```

Run: `cd vscode && npm install && npm test`
Expected: the first test PASSES and the second FAILS with `ENOENT` (no `protocol.gen.ts` yet).

- [ ] **Step 6: Generate the types and pass**

Run: `cd vscode && npm run gen && npm test && npx tsc -p .`
Expected: both tests PASS. `tsc` reports nothing (only the generated file and the test exist so far).

- [ ] **Step 7: Commit**

```bash
git add go.mod go.sum internal/protocol protocol/schema.json vscode
git commit -m "feat(protocol): generate a JSON Schema and TypeScript types from the Go protocol"
```

---

### Task 3: Paths, formatting and the deck store

**Files:**
- Create: `vscode/src/core/paths.ts`, `vscode/src/core/format.ts`, `vscode/src/core/store.ts`
- Test: `vscode/test/unit/paths.test.ts`, `vscode/test/unit/format.test.ts`, `vscode/test/unit/store.test.ts`, `vscode/test/unit/core.test.ts`

**Interfaces:**
- Consumes: `View`, `Pane` from `protocol.gen.ts`.
- Produces:
  - `paths.ts`: `type Env = Record<string, string | undefined>`; `baseDir(env?: Env, platform?: NodeJS.Platform, home?: string): string`; `MAX_SOCKET_PATH = 103`; `class SocketPathTooLong extends Error`; `socketAddress(base: string, pid: number, platform?: NodeJS.Platform, random?: string): string`; `ensurePrivateDir(dir: string, platform?: NodeJS.Platform): void`; `resolveFolder(path: string): string`; `findCli(env: Env, platform: NodeJS.Platform, base: string, exists?: (p: string) => boolean): string | undefined`.
  - `format.ts`: `OPEN_HINT = 'ctrl+alt+v 1'`; `plural(n: number, word: string): string`; `rangeSuffix(pane: Pane): string`; `caption(deck: Deck, n: number, pane: Pane, relativePath: string): string`; `doneNotice(deck: Deck, openHint: string): string`; `noSuchView(deck: Deck): string`; `type DeckPickItem = { label: string; description: string; detail: string; deck: Deck }`; `deckPickItem(deck: Deck): DeckPickItem`.
  - `store.ts`: `MAX_VIEWS = 9`; `KEEP = 10`; `type Deck = { id: number; title: string; created_at: number; done: boolean; views: View[] }`; `type Log = (message: string) => void`; `class Rejection extends Error`; `workspaceKey(folder: string): string`; `class Store` with `static forWorkspace(stateDir: string, folder: string, log: Log): Store`, `readonly root: string`, `ids(): number[]`, `load(id: number): Deck | undefined`, `get(id: number | undefined): Deck`, `create(title: string, now: number): Deck`, `addView(id: number | undefined, view: View): number`, `finish(id: number | undefined): Deck`, `listDone(): Deck[]`, `latestDone(): Deck | undefined`.

- [ ] **Step 1: Write the failing tests**

`vscode/test/unit/core.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('nothing in src/core imports vscode, so it runs under plain Node', () => {
  const dir = new URL('../../src/core/', import.meta.url);
  for (const name of readdirSync(dir)) {
    assert.doesNotMatch(readFileSync(new URL(name, dir), 'utf8'), /from ['"]vscode['"]/, name);
  }
});
```

`vscode/test/unit/paths.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseDir, ensurePrivateDir, findCli, SocketPathTooLong, socketAddress } from '../../src/core/paths.ts';

test('SHOW_ME_HOME wins', () => {
  assert.equal(baseDir({ SHOW_ME_HOME: '/x', XDG_STATE_HOME: '/y' }, 'linux', '/h'), '/x');
});

test('XDG_STATE_HOME, then ~/.local/state; empty counts as unset', () => {
  assert.equal(baseDir({ XDG_STATE_HOME: '/y' }, 'darwin', '/h'), '/y/show-me');
  assert.equal(baseDir({ SHOW_ME_HOME: '', XDG_STATE_HOME: '' }, 'linux', '/h'), '/h/.local/state/show-me');
});

test('Windows uses LOCALAPPDATA', () => {
  assert.equal(baseDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32', 'C:\\Users\\me'), 'C:\\Users\\me\\AppData\\Local\\show-me');
  assert.throws(() => baseDir({}, 'win32', 'C:\\Users\\me'), /LOCALAPPDATA/);
});

test('socket addresses', () => {
  assert.equal(socketAddress('/s', 42, 'linux'), '/s/sock/vscode-42.sock');
  assert.equal(socketAddress('C:\\s', 42, 'win32', 'ab12cd34'), '\\\\.\\pipe\\show-me-vscode-42-ab12cd34');
});

test('refuses a socket path over the limit', () => {
  assert.throws(() => socketAddress('/' + 'd'.repeat(100), 42, 'darwin'), SocketPathTooLong);
});

test('private dirs are 0700 on POSIX', { skip: process.platform === 'win32' }, () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'sm')), 'a', 'b');
  ensurePrivateDir(dir);
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test('finds the CLI on PATH, then in <base>/bin', () => {
  const have = new Set(['/usr/local/bin/show-me', '/base/bin/show-me']);
  const exists = (p: string) => have.has(p);
  assert.equal(findCli({ PATH: '/usr/bin:/usr/local/bin' }, 'linux', '/base', exists), '/usr/local/bin/show-me');
  assert.equal(findCli({ PATH: '/usr/bin' }, 'linux', '/base', exists), '/base/bin/show-me');
  assert.equal(findCli({ PATH: '/usr/bin' }, 'linux', '/elsewhere', exists), undefined);
  assert.equal(findCli({ Path: 'C:\\bin' }, 'win32', 'C:\\b', p => p === 'C:\\bin\\show-me.exe'), 'C:\\bin\\show-me.exe');
});
```

`vscode/test/unit/format.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caption, deckPickItem, doneNotice, noSuchView, rangeSuffix } from '../../src/core/format.ts';
import type { Deck } from '../../src/core/store.ts';

const deck: Deck = {
  id: 7, title: 'How it works', created_at: 0, done: true,
  views: [
    { layout: 'cols2', title: 'Both', panes: [{ path: '/w/a.py', first: 2, last: 4 }, { path: '/w/b.py' }] },
    { layout: 'single', panes: [{ path: '/w/a.py', first: 5, last: 5 }] },
  ],
};

test('caption uses the view title, else the deck title', () => {
  assert.equal(caption(deck, 1, deck.views[0]!.panes[0]!, 'a.py'), '1/2 · Both · a.py:2-4');
  assert.equal(caption(deck, 2, deck.views[1]!.panes[0]!, 'a.py'), '2/2 · How it works · a.py:5-5');
});

test('no range, no suffix', () => {
  assert.equal(rangeSuffix({ path: '/w/b.py' }), '');
});

test('the done notice pluralises views', () => {
  assert.equal(doneNotice(deck, 'ctrl+alt+v 1'), 'show-me: How it works · 2 views · ctrl+alt+v 1');
  assert.equal(doneNotice({ ...deck, views: [deck.views[0]!] }, 'k'), 'show-me: How it works · 1 view · k');
});

test('asking for a view past the end names the count', () => {
  assert.equal(noSuchView(deck), 'show-me: "How it works" has 2 views');
});

test('picker items', () => {
  assert.deepEqual(deckPickItem(deck), {
    label: 'How it works', description: '2 views', detail: '1. Both  2. single', deck,
  });
});
```

`vscode/test/unit/store.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import type { View } from '../../src/core/protocol.gen.ts';
import { KEEP, MAX_VIEWS, Rejection, Store, workspaceKey } from '../../src/core/store.ts';

const view: View = { layout: 'single', panes: [{ path: '/a.txt' }] };

function fresh(logged: string[] = []): Store {
  return Store.forWorkspace(mkdtempSync(join(tmpdir(), 'sm')), '/w', m => logged.push(m));
}

test('one directory per workspace, named by 16 hex characters of sha256', () => {
  assert.equal(workspaceKey('/w'), createHash('sha256').update('/w').digest('hex').slice(0, 16));
  assert.match(workspaceKey('/w'), /^[0-9a-f]{16}$/);
  assert.equal(basename(fresh().root), workspaceKey('/w'));
});

test('ids are monotonic from 1 and survive pruning', () => {
  const store = fresh();
  for (let i = 1; i <= KEEP + 2; i++) assert.equal(store.create(`d${i}`, i).id, i);
  assert.deepEqual(store.ids(), Array.from({ length: KEEP }, (_, i) => i + 3));
  assert.equal(store.create('next', 99).id, KEEP + 3);
});

test('editor-side rejections, verbatim', () => {
  const store = fresh();
  const reject = (fn: () => unknown, message: string) => assert.throws(fn, (e: unknown) => e instanceof Rejection && e.message === message);
  reject(() => store.addView(99, view), 'unknown deck 99');
  const id = store.create('One', 1).id;
  reject(() => store.finish(id), `deck ${id} has no views`);
  for (let i = 1; i <= MAX_VIEWS; i++) assert.equal(store.addView(id, view), i);
  reject(() => store.addView(id, view), `deck ${id} already has 9 views, the most an editor can open by number`);
  store.finish(id);
  reject(() => store.addView(id, view), `deck ${id} is already done; start a new one`);
});

test('a corrupt deck file is skipped and logged', () => {
  const logged: string[] = [];
  const store = fresh(logged);
  const good = store.create('good', 1);
  store.addView(good.id, view);
  store.finish(good.id);
  writeFileSync(join(store.root, '2.json'), '{not json');
  assert.equal(store.latestDone()?.id, good.id);
  assert.equal(store.create('after', 3).id, 3);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /2\.json/);
});

test('listDone is newest first and skips unfinished decks', () => {
  const store = fresh();
  for (const title of ['a', 'b', 'c']) {
    const d = store.create(title, 1);
    store.addView(d.id, view);
    if (title !== 'b') store.finish(d.id);
  }
  assert.deepEqual(store.listDone().map(d => d.title), ['c', 'a']);
});

test('decks persist with epoch-ms created_at', () => {
  const store = fresh();
  const d = store.create('kept', 1792224000000);
  assert.deepEqual(new Store(store.root, () => {}).get(d.id), { ...d });
  assert.equal(Number.isInteger(store.get(d.id).created_at), true);
});
```

Add `import { createHash } from 'node:crypto';` to the imports at the top of `store.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd vscode && npm test`
Expected: FAIL with `Cannot find module '…/src/core/paths.ts'`.

- [ ] **Step 3: Write `paths.ts`**

```ts
/**
 * Where show-me lives on disk, shared with the CLI (internal/registry.BaseDir),
 * and how this window's socket is named.
 */
import { chmodSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export type Env = Record<string, string | undefined>;

/** sun_path holds 104 bytes on macOS (108 on Linux), including the NUL. */
export const MAX_SOCKET_PATH = 103;

export class SocketPathTooLong extends Error {
  override name = 'SocketPathTooLong';
}

const isSet = (value: string | undefined): value is string => value !== undefined && value !== '';
const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? win32 : posix);

/** show-me's home. Empty variables count as unset. */
export function baseDir(env: Env = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const path = pathFor(platform);
  if (isSet(env.SHOW_ME_HOME)) return env.SHOW_ME_HOME;
  if (platform === 'win32') {
    if (!isSet(env.LOCALAPPDATA)) throw new Error('LOCALAPPDATA is not set');
    return path.join(env.LOCALAPPDATA, 'show-me');
  }
  return path.join(isSet(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, '.local', 'state'), 'show-me');
}

/** A Unix socket under `<base>/sock`, or a named pipe on Windows (pipes aren't files, so the name is randomised). */
export function socketAddress(base: string, pid: number, platform: NodeJS.Platform = process.platform, random = ''): string {
  if (platform === 'win32') return `\\\\.\\pipe\\show-me-vscode-${pid}-${random}`;
  const address = posix.join(base, 'sock', `vscode-${pid}.sock`);
  if (Buffer.byteLength(address) > MAX_SOCKET_PATH) {
    throw new SocketPathTooLong(`socket path ${address} is longer than ${MAX_SOCKET_PATH} bytes; set SHOW_ME_HOME to a shorter directory`);
  }
  return address;
}

/** Create `dir` (and parents) readable only by this user, as the Neovim plugin does. */
export function ensurePrivateDir(dir: string, platform: NodeJS.Platform = process.platform): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') chmodSync(dir, 0o700);
}

/** Workspace folders are published symlink-resolved, like Neovim's fs_realpath. */
export function resolveFolder(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The show-me CLI on PATH, else the installer's copy under `<base>/bin`. */
export function findCli(env: Env, platform: NodeJS.Platform, base: string, exists: (p: string) => boolean = existsSync): string | undefined {
  const path = pathFor(platform);
  const name = platform === 'win32' ? 'show-me.exe' : 'show-me';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(isSet);
  return [...dirs, path.join(base, 'bin')].map(dir => path.join(dir, name)).find(exists);
}
```

- [ ] **Step 4: Write `store.ts`**

```ts
/**
 * show-me decks on disk: one JSON file per deck, one directory per workspace
 * folder. Same format and rules as lua/show_me/store.lua.
 *
 * The CLI has already checked layouts, panes and ranges. This module enforces
 * only what needs deck state, and keeps the newest KEEP decks. Every call is
 * synchronous, so requests handled on Node's one thread never interleave.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { View } from './protocol.gen.ts';

/** Views are opened by number, 1-9, so a deck holds at most 9. */
export const MAX_VIEWS = 9;

/** Decks kept per workspace; older ones are deleted on each create. */
export const KEEP = 10;

export type Deck = {
  id: number;
  title: string;
  /** Epoch milliseconds. */
  created_at: number;
  done: boolean;
  views: View[];
};

export type Log = (message: string) => void;

/** A request deck state rules out. Its message becomes the reply's error, verbatim. */
export class Rejection extends Error {
  override name = 'Rejection';
}

/** A store directory's name: the first 16 hex characters of sha256(folder). */
export function workspaceKey(folder: string): string {
  return createHash('sha256').update(folder).digest('hex').slice(0, 16);
}

export class Store {
  readonly root: string;
  readonly #log: Log;

  constructor(root: string, log: Log) {
    mkdirSync(root, { recursive: true });
    this.root = root;
    this.#log = log;
  }

  static forWorkspace(stateDir: string, folder: string, log: Log): Store {
    return new Store(join(stateDir, workspaceKey(folder)), log);
  }

  ids(): number[] {
    return readdirSync(this.root)
      .flatMap(name => /^(\d+)\.json$/.exec(name)?.[1] ?? [])
      .map(Number)
      .sort((a, b) => a - b);
  }

  /** The deck, or undefined when its file is missing or corrupt (corrupt is logged). */
  load(id: number): Deck | undefined {
    let text: string;
    try {
      text = readFileSync(this.#file(id), 'utf8');
    } catch {
      return undefined;
    }
    try {
      const deck: unknown = JSON.parse(text);
      if (Store.#isDeck(deck)) return deck;
    } catch {
      // Reported below, with a malformed shape.
    }
    this.#log(`skipping corrupt deck file ${this.#file(id)}`);
    return undefined;
  }

  get(id: number | undefined): Deck {
    const deck = id === undefined ? undefined : this.load(id);
    if (!deck) throw new Rejection(`unknown deck ${id}`);
    return deck;
  }

  create(title: string, now: number): Deck {
    const ids = this.ids();
    const deck: Deck = { id: (ids.at(-1) ?? 0) + 1, title, created_at: now, done: false, views: [] };
    this.#save(deck);
    for (const old of ids.slice(0, Math.max(0, ids.length + 1 - KEEP))) rmSync(this.#file(old), { force: true });
    return deck;
  }

  /** Returns the view's number within its deck. */
  addView(id: number | undefined, view: View): number {
    const deck = this.get(id);
    if (deck.done) throw new Rejection(`deck ${deck.id} is already done; start a new one`);
    if (deck.views.length >= MAX_VIEWS) {
      throw new Rejection(`deck ${deck.id} already has ${MAX_VIEWS} views, the most an editor can open by number`);
    }
    deck.views.push(view);
    this.#save(deck);
    return deck.views.length;
  }

  finish(id: number | undefined): Deck {
    const deck = this.get(id);
    if (deck.views.length === 0) throw new Rejection(`deck ${deck.id} has no views`);
    deck.done = true;
    this.#save(deck);
    return deck;
  }

  /** Done decks, newest first. */
  listDone(): Deck[] {
    return this.ids()
      .reverse()
      .map(id => this.load(id))
      .filter((deck): deck is Deck => deck?.done === true);
  }

  latestDone(): Deck | undefined {
    return this.listDone()[0];
  }

  #file(id: number): string {
    return join(this.root, `${id}.json`);
  }

  /** Written to a temp file and renamed, so a concurrent reader never sees half a deck. */
  #save(deck: Deck): void {
    const file = this.#file(deck.id);
    writeFileSync(`${file}.tmp`, JSON.stringify(deck));
    renameSync(`${file}.tmp`, file);
  }

  static #isDeck(value: unknown): value is Deck {
    const deck = value as Partial<Deck> | null;
    return typeof deck === 'object' && deck !== null && Number.isInteger(deck.id) && Array.isArray(deck.views);
  }
}
```

- [ ] **Step 5: Write `format.ts`**

```ts
/** Every user-facing string show-me builds from a deck, in one place. */
import type { Pane } from './protocol.gen.ts';
import type { Deck } from './store.ts';

/** How the user opens view 1 with the default keybindings. */
export const OPEN_HINT = 'ctrl+alt+v 1';

export type DeckPickItem = { label: string; description: string; detail: string; deck: Deck };

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function rangeSuffix(pane: Pane): string {
  return pane.first === undefined ? '' : `:${pane.first}-${pane.last ?? pane.first}`;
}

/** `n/N · <view title or deck title> · <relative path>:<range>` */
export function caption(deck: Deck, n: number, pane: Pane, relativePath: string): string {
  return `${n}/${deck.views.length} · ${deck.views[n - 1]?.title || deck.title} · ${relativePath}${rangeSuffix(pane)}`;
}

export function doneNotice(deck: Deck, openHint: string): string {
  return `show-me: ${deck.title} · ${plural(deck.views.length, 'view')} · ${openHint}`;
}

export function noSuchView(deck: Deck): string {
  return `show-me: "${deck.title}" has ${plural(deck.views.length, 'view')}`;
}

export function deckPickItem(deck: Deck): DeckPickItem {
  return {
    label: deck.title,
    description: plural(deck.views.length, 'view'),
    detail: deck.views.map((view, i) => `${i + 1}. ${view.title || view.layout}`).join('  '),
    deck,
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `cd vscode && npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add vscode/src/core vscode/test/unit
git commit -m "feat(vscode): add the deck store, base-dir paths and caption formatting"
```

---

### Task 4: Session and the protocol handler

**Files:**
- Create: `vscode/src/core/session.ts`, `vscode/src/core/rpc.ts`
- Test: `vscode/test/unit/rpc.test.ts`

**Interfaces:**
- Consumes: `Store`, `Rejection`, `Deck`, `Log` (Task 3); generated wire types.
- Produces:
  - `session.ts`: `class Session` with `constructor(stateDir: string, log: Log)`, `setFolders(folders: string[]): void`, `get folders(): readonly string[]`, `store(): Store`, `remember(id: number, store: Store): void`, `forget(id: number): void`, `storeFor(id: number | undefined): Store`, `current(): Deck | undefined`, `setCurrent(deck: Deck): void`.
  - `rpc.ts`: `PROTOCOL = 1`; `type RpcOptions = { token: string; session: Session; openHint: string; announce: (deck: Deck) => void; now?: () => number }`; `class Rpc` with `constructor(options: RpcOptions)` and `handle(line: string): string`.

- [ ] **Step 1: Write the failing tests**

`vscode/test/unit/rpc.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Reply, Request } from '../../src/core/protocol.gen.ts';
import { Rpc } from '../../src/core/rpc.ts';
import { Session } from '../../src/core/session.ts';
import type { Deck } from '../../src/core/store.ts';

const TOKEN = 'a'.repeat(64);
const pane = { path: '/w/a.txt', first: 1, last: 2 };

function setup() {
  const session = new Session(mkdtempSync(join(tmpdir(), 'sm')), () => {});
  session.setFolders(['/w', '/w2']);
  const announced: Deck[] = [];
  const rpc = new Rpc({ token: TOKEN, session, openHint: 'ctrl+alt+v 1', announce: d => announced.push(d), now: () => 1792224000000 });
  const send = (req: Partial<Request> & { token?: unknown }): Reply => JSON.parse(rpc.handle(JSON.stringify({ protocol: 1, token: TOKEN, ...req })));
  return { session, announced, rpc, send };
}

test('a full session, with reply shapes identical to Neovim', () => {
  const { send, announced } = setup();
  assert.deepEqual(send({ command: 'status' }), { ok: true, result: { editor: 'vscode', workspace_folders: ['/w', '/w2'], current: null } });
  assert.deepEqual(send({ command: 'deck', title: 'How' }), { ok: true, result: { deck: 1 } });
  assert.deepEqual(send({ command: 'view', deck: 1, view: { layout: 'single', panes: [pane] } }), { ok: true, result: { view: 1 } });
  assert.deepEqual(send({ command: 'done', deck: 1 }), { ok: true, result: { deck: 1, views: 1, open_hint: 'ctrl+alt+v 1' } });
  assert.equal(announced[0]?.title, 'How');
  assert.deepEqual(send({ command: 'status' }).result, { editor: 'vscode', workspace_folders: ['/w', '/w2'], current: { deck: 1, title: 'How', views: 1 } });
});

test('a wrong or missing token is refused before anything else', () => {
  const { send } = setup();
  assert.deepEqual(send({ command: 'status', token: 'b'.repeat(64) }), { ok: false, error: 'bad token' });
  assert.deepEqual(send({ command: 'status', token: undefined }), { ok: false, error: 'bad token' });
  assert.deepEqual(send({ command: 'status', token: 'short', protocol: 2 }), { ok: false, error: 'bad token' });
});

test('protocol, command and JSON errors', () => {
  const { send, rpc } = setup();
  assert.deepEqual(send({ protocol: 2, command: 'status' }), { ok: false, error: 'unsupported protocol 2 (this editor speaks 1)' });
  assert.deepEqual(send({ command: 'dance' as Request['command'] }), { ok: false, error: 'unknown command "dance"' });
  assert.deepEqual(JSON.parse(rpc.handle('{nope')), { ok: false, error: 'request is not JSON' });
});

test('editor-side rejections come back as errors', () => {
  const { send } = setup();
  assert.deepEqual(send({ command: 'view', deck: 99, view: { layout: 'single', panes: [pane] } }), { ok: false, error: 'unknown deck 99' });
});

test('keeps an unfinished deck in its store when folders change', () => {
  const { send, session } = setup();
  send({ command: 'deck', title: 'Started in /w' });
  session.setFolders(['/elsewhere']);
  assert.deepEqual(send({ command: 'view', deck: 1, view: { layout: 'single', panes: [pane] } }), { ok: true, result: { view: 1 } });
  assert.deepEqual(send({ command: 'done', deck: 1 }).ok, true);
  session.setFolders(['/w']);
  assert.equal(session.store().latestDone()?.title, 'Started in /w');
});

test('a window with no folder refuses decks', () => {
  const { send, session } = setup();
  session.setFolders([]);
  assert.deepEqual(send({ command: 'deck', title: 'x' }), { ok: false, error: 'this VS Code window has no folder open' });
  assert.deepEqual(send({ command: 'status' }).result, { editor: 'vscode', workspace_folders: [], current: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd vscode && npm test`
Expected: FAIL with `Cannot find module '…/src/core/rpc.ts'`.

- [ ] **Step 3: Write `session.ts`**

```ts
/**
 * What this window's show-me session knows: the folders it serves, the first
 * folder's deck store, and the deck the view keys act on. Mirrors
 * lua/show_me/state.lua; new decks go into the first folder's store.
 */
import { Rejection, Store } from './store.ts';
import type { Deck, Log } from './store.ts';

export class Session {
  readonly #stateDir: string;
  readonly #log: Log;
  #folders: string[] = [];
  #store: Store | undefined;
  #current: Deck | undefined;
  /** The store each unfinished deck was created in, so a folder change mid-deck doesn't move it. */
  readonly #unfinished = new Map<number, Store>();

  constructor(stateDir: string, log: Log) {
    this.#stateDir = stateDir;
    this.#log = log;
  }

  /** Serve `folders`. Forgets the old store and current deck, not unfinished decks. */
  setFolders(folders: string[]): void {
    this.#folders = folders;
    this.#store = undefined;
    this.#current = undefined;
  }

  get folders(): readonly string[] {
    return this.#folders;
  }

  store(): Store {
    const folder = this.#folders[0];
    if (folder === undefined) throw new Rejection('this VS Code window has no folder open');
    this.#store ??= Store.forWorkspace(this.#stateDir, folder, this.#log);
    return this.#store;
  }

  remember(id: number, store: Store): void {
    this.#unfinished.set(id, store);
  }

  forget(id: number): void {
    this.#unfinished.delete(id);
  }

  storeFor(id: number | undefined): Store {
    return (id !== undefined && this.#unfinished.get(id)) || this.store();
  }

  /** The last deck picked or finished, else the newest done deck on disk. */
  current(): Deck | undefined {
    if (this.#current === undefined && this.#folders.length > 0) this.#current = this.store().latestDone();
    return this.#current;
  }

  setCurrent(deck: Deck): void {
    this.#current = deck;
  }
}
```

- [ ] **Step 4: Write `rpc.ts`**

```ts
/**
 * The show-me protocol endpoint: one request line in, one reply line out,
 * shaped as in protocol/PROTOCOL.md and identical to lua/show_me/rpc.lua.
 * Never throws: every failure is an `ok: false` reply.
 */
import { timingSafeEqual } from 'node:crypto';
import type { DeckResult, DoneResult, Reply, Request, StatusResult, ViewResult } from './protocol.gen.ts';
import type { Session } from './session.ts';
import { Rejection } from './store.ts';
import type { Deck } from './store.ts';

/** The protocol version this extension speaks. */
export const PROTOCOL = 1;

export type RpcOptions = {
  token: string;
  session: Session;
  openHint: string;
  /** Tell the user a deck is done. Must not block or take focus. */
  announce: (deck: Deck) => void;
  now?: () => number;
};

type Handler = (request: Request) => DeckResult | ViewResult | DoneResult | StatusResult;

export class Rpc {
  readonly #options: RpcOptions;
  readonly #commands: Record<Request['command'], Handler>;

  constructor(options: RpcOptions) {
    this.#options = options;
    const { session } = options;
    this.#commands = {
      deck: ({ title }) => {
        const store = session.store();
        const { id } = store.create(title ?? '', (options.now ?? Date.now)());
        session.remember(id, store);
        return { deck: id };
      },
      view: ({ deck, view }) => ({ view: session.storeFor(deck).addView(deck, view!) }),
      done: ({ deck }) => {
        const finished = session.storeFor(deck).finish(deck);
        session.forget(finished.id);
        session.setCurrent(finished);
        options.announce(finished);
        return { deck: finished.id, views: finished.views.length, open_hint: options.openHint };
      },
      status: () => {
        const current = session.current();
        return {
          editor: 'vscode',
          workspace_folders: [...session.folders],
          current: current ? { deck: current.id, title: current.title, views: current.views.length } : null,
        };
      },
    };
  }

  handle(line: string): string {
    let request: Request;
    try {
      request = JSON.parse(line);
    } catch {
      return Rpc.#reply({ ok: false, error: 'request is not JSON' });
    }
    if (typeof request !== 'object' || request === null) return Rpc.#reply({ ok: false, error: 'request is not JSON' });
    if (!Rpc.#tokenMatches(request.token, this.#options.token)) return Rpc.#reply({ ok: false, error: 'bad token' });
    if (request.protocol !== PROTOCOL) {
      return Rpc.#reply({ ok: false, error: `unsupported protocol ${request.protocol} (this editor speaks ${PROTOCOL})` });
    }
    const command = Object.hasOwn(this.#commands, request.command) ? this.#commands[request.command] : undefined;
    if (!command) return Rpc.#reply({ ok: false, error: `unknown command ${JSON.stringify(request.command)}` });
    try {
      return Rpc.#reply({ ok: true, result: command(request) });
    } catch (error) {
      if (error instanceof Rejection) return Rpc.#reply({ ok: false, error: error.message });
      return Rpc.#reply({ ok: false, error: `internal error: ${error}` });
    }
  }

  static #reply(reply: Reply): string {
    return JSON.stringify(reply);
  }

  static #tokenMatches(given: unknown, expected: string): boolean {
    if (typeof given !== 'string') return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
```

The `view!` non-null assertion is safe: the CLI always sends `view` with `command: "view"`. If it is missing, `addView` throws a `TypeError` and the reply is `internal error: …`. That matches Neovim, which raises in the same case.

- [ ] **Step 5: Run the tests**

Run: `cd vscode && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add vscode/src/core/session.ts vscode/src/core/rpc.ts vscode/test/unit/rpc.test.ts
git commit -m "feat(vscode): handle deck, view, done and status requests"
```

---

### Task 5: Registry entry and the NDJSON server

**Files:**
- Create: `vscode/src/core/registry.ts`, `vscode/src/core/server.ts`
- Test: `vscode/test/unit/registry.test.ts`, `vscode/test/unit/server.test.ts`

**Interfaces:**
- Consumes: `ensurePrivateDir`, `MAX_SOCKET_PATH` (Task 3); `Entry` (generated).
- Produces:
  - `registry.ts`: `type EntryFields = Omit<Entry, 'started_at' | 'focused_at'>`; `class Registry` with `constructor(base: string, fields: EntryFields, now: number)`, `readonly file: string`, `write(): void` (throws on failure), `touch(now: number): void`, `setFolders(folders: string[]): void`, `remove(): void`.
  - `server.ts`: `MAX_REQUEST_BYTES = 1 << 20`; `REQUEST_TIMEOUT_MS = 10_000`; `class NdjsonServer` with `static listen(address: string, handle: (line: string) => string, platform?: NodeJS.Platform): Promise<NdjsonServer>`, `readonly address: string`, `close(): void`.

- [ ] **Step 1: Write the failing tests**

`vscode/test/unit/registry.test.ts`:

```ts
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Entry } from '../../src/core/protocol.gen.ts';
import { Registry } from '../../src/core/registry.ts';

const fields = {
  protocol: 1, editor: 'vscode' as const, pid: 4242, workspace_folders: ['/w'],
  transport: { kind: 'ndjson' as const, address: '/s/sock/vscode-4242.sock', token: 'f'.repeat(64) },
  open_hint: 'ctrl+alt+v 1',
};

const read = (file: string): Entry => JSON.parse(readFileSync(file, 'utf8'));

test('writes <base>/editors/vscode-<pid>.json atomically, mode 0600', () => {
  const base = mkdtempSync(join(tmpdir(), 'sm'));
  const registry = new Registry(base, fields, 1000);
  registry.write();
  assert.equal(registry.file, join(base, 'editors', 'vscode-4242.json'));
  assert.deepEqual(read(registry.file), { ...fields, started_at: 1000, focused_at: 1000 });
  assert.deepEqual(readdirSync(join(base, 'editors')), ['vscode-4242.json']);
  if (process.platform !== 'win32') assert.equal(statSync(registry.file).mode & 0o777, 0o600);
});

test('touch moves focused_at; setFolders rewrites the folders', () => {
  const registry = new Registry(mkdtempSync(join(tmpdir(), 'sm')), fields, 1000);
  registry.write();
  registry.touch(2000);
  registry.setFolders(['/a', '/b']);
  const entry = read(registry.file);
  assert.equal(entry.started_at, 1000);
  assert.equal(entry.focused_at, 2000);
  assert.deepEqual(entry.workspace_folders, ['/a', '/b']);
});

test('remove deletes the entry', () => {
  const registry = new Registry(mkdtempSync(join(tmpdir(), 'sm')), fields, 1000);
  registry.write();
  registry.remove();
  assert.equal(existsSync(registry.file), false);
});
```

`vscode/test/unit/server.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NdjsonServer } from '../../src/core/server.ts';

function address(): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\show-me-test-${process.pid}-${Math.random().toString(16).slice(2)}`
    : join(mkdtempSync(join(tmpdir(), 'sm')), 'sock', 't.sock');
}

function ask(addr: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(addr, () => socket.write(line));
    let reply = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => (reply += chunk));
    socket.on('end', () => resolve(reply));
    socket.on('error', reject);
  });
}

test('answers one line with one line, then closes', async () => {
  const server = await NdjsonServer.listen(address(), line => `echo ${line}`);
  try {
    assert.equal(await ask(server.address, '{"a":1}\n'), 'echo {"a":1}\n');
    assert.equal(await ask(server.address, 'x\ny\n'), 'echo x\n');
  } finally {
    server.close();
  }
});

test('replaces a stale socket file', { skip: process.platform === 'win32' }, async () => {
  const addr = address();
  const first = await NdjsonServer.listen(addr, () => 'one');
  first.close();
  writeFileSync(addr, '');
  const second = await NdjsonServer.listen(addr, () => 'two');
  try {
    assert.equal(await ask(addr, '\n'), 'two\n');
  } finally {
    second.close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd vscode && npm test`
Expected: FAIL with `Cannot find module '…/src/core/registry.ts'`.

- [ ] **Step 3: Write `registry.ts`**

```ts
/**
 * This window's entry in the show-me registry, which is how the CLI finds it.
 * One JSON file per running editor under `<base>/editors/`, private to the
 * user; same rules as lua/show_me/registry.lua.
 */
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePrivateDir } from './paths.ts';
import type { Entry } from './protocol.gen.ts';

export type EntryFields = Omit<Entry, 'started_at' | 'focused_at'>;

export class Registry {
  readonly file: string;
  readonly #base: string;
  #entry: Entry;

  constructor(base: string, fields: EntryFields, now: number) {
    this.#base = base;
    this.file = join(base, 'editors', `${fields.editor}-${fields.pid}.json`);
    this.#entry = { ...fields, started_at: now, focused_at: now };
  }

  /** Write (or rewrite) the entry through a temp file, so the CLI never reads half of one. */
  write(): void {
    ensurePrivateDir(this.#base);
    ensurePrivateDir(join(this.#base, 'editors'));
    const tmp = `${this.file}.tmp`;
    rmSync(tmp, { force: true });
    writeFileSync(tmp, JSON.stringify(this.#entry), { mode: 0o600 });
    try {
      // On Windows the rename fails while a CLI has the old entry open.
      renameSync(tmp, this.file);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
  }

  /** The user is looking at this window, so it wins ties. */
  touch(now: number): void {
    this.#entry = { ...this.#entry, focused_at: now };
    this.write();
  }

  setFolders(folders: string[]): void {
    this.#entry = { ...this.#entry, workspace_folders: folders };
    this.write();
  }

  remove(): void {
    rmSync(this.file, { force: true });
  }
}
```

- [ ] **Step 4: Write `server.ts`**

```ts
/**
 * The ndjson transport's server end: one request line in, one reply line out,
 * then the connection closes. A Unix socket in a private directory, or a
 * named pipe on Windows (where the token is the only protection).
 */
import { chmodSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { dirname } from 'node:path';
import { ensurePrivateDir } from './paths.ts';

/** A request longer than this is dropped; real ones are a few hundred bytes. */
export const MAX_REQUEST_BYTES = 1 << 20;

/** The CLI gives up after 10 s, so a connection held longer is abandoned. */
export const REQUEST_TIMEOUT_MS = 10_000;

export class NdjsonServer {
  readonly address: string;
  readonly #server: Server;
  readonly #platform: NodeJS.Platform;

  private constructor(address: string, server: Server, platform: NodeJS.Platform) {
    this.address = address;
    this.#server = server;
    this.#platform = platform;
  }

  static async listen(address: string, handle: (line: string) => string, platform: NodeJS.Platform = process.platform): Promise<NdjsonServer> {
    if (platform !== 'win32') {
      ensurePrivateDir(dirname(address), platform);
      // A crashed window whose pid was reused leaves its socket file behind.
      rmSync(address, { force: true });
    }
    const server = createServer(socket => NdjsonServer.#serve(socket, handle));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(address, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (platform !== 'win32') chmodSync(address, 0o600);
    return new NdjsonServer(address, server, platform);
  }

  close(): void {
    this.#server.close();
    if (this.#platform !== 'win32') rmSync(this.address, { force: true });
  }

  static #serve(socket: Socket, handle: (line: string) => string): void {
    let buffered = '';
    socket.setEncoding('utf8');
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      const end = buffered.indexOf('\n');
      if (end < 0) {
        if (buffered.length > MAX_REQUEST_BYTES) socket.destroy();
        return;
      }
      socket.removeAllListeners('data');
      socket.end(`${handle(buffered.slice(0, end))}\n`);
    });
  }
}
```

`private constructor` is a TypeScript-only modifier and is erasable, so `erasableSyntaxOnly` accepts it.

- [ ] **Step 5: Run the tests**

Run: `cd vscode && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add vscode/src/core/registry.ts vscode/src/core/server.ts vscode/test/unit/registry.test.ts vscode/test/unit/server.test.ts
git commit -m "feat(vscode): publish a registry entry and serve ndjson on a socket or pipe"
```

---

### Task 6: Layout maths and the tab ledger

**Files:**
- Create: `vscode/src/core/layout.ts`, `vscode/src/core/tabs.ts`
- Test: `vscode/test/unit/layout.test.ts`, `vscode/test/unit/tabs.test.ts`

**Interfaces:**
- Consumes: `View` (generated).
- Produces:
  - `layout.ts`: `type GroupLayout = { size?: number; groups?: GroupLayout[] }`; `type EditorLayout = { orientation: 0 | 1; groups: GroupLayout[] }`; `MAIN_SHARE = 0.6`; `layoutFor(layout: View['layout'], panes: number): EditorLayout`; `shouldApplyLayout(userGroups: number, panes: number): boolean`; `type GroupSnapshot = { activeUri?: string; activePreview: boolean }`; `type Snapshot = { layout: EditorLayout; groups: GroupSnapshot[]; activeColumn: number }`.
  - `tabs.ts`: `type TabKey = { column: number; uri: string }`; `class TabLedger` with `record(key: TabKey, existed: boolean): void`, `release(keep?: readonly TabKey[]): TabKey[]`, `isCreated(key: TabKey): boolean`, `get borrowed(): readonly TabKey[]`.

- [ ] **Step 1: Write the failing tests**

`vscode/test/unit/layout.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutFor, shouldApplyLayout } from '../../src/core/layout.ts';

test('columns split the width evenly, left to right', () => {
  assert.deepEqual(layoutFor('single', 1), { orientation: 0, groups: [{ size: 1 }] });
  assert.deepEqual(layoutFor('cols2', 2), { orientation: 0, groups: [{ size: 0.5 }, { size: 0.5 }] });
  assert.deepEqual(layoutFor('cols3', 3), { orientation: 0, groups: [{ size: 1 / 3 }, { size: 1 / 3 }, { size: 1 / 3 }] });
});

test('main-stack: pane 1 takes 60% on the left, the rest stack on the right', () => {
  assert.deepEqual(layoutFor('main-stack', 3), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{}, {}] }] });
  assert.deepEqual(layoutFor('main-stack', 4), { orientation: 0, groups: [{ size: 0.6 }, { size: 0.4, groups: [{}, {}, {}] }] });
});

test('never shrink: the layout applies only when it removes none of the user\'s groups', () => {
  assert.equal(shouldApplyLayout(1, 3), true);
  assert.equal(shouldApplyLayout(3, 3), true);
  assert.equal(shouldApplyLayout(4, 2), false);
});
```

`vscode/test/unit/tabs.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TabLedger } from '../../src/core/tabs.ts';

const a1 = { column: 1, uri: 'file:///a' };
const b2 = { column: 2, uri: 'file:///b' };
const u1 = { column: 1, uri: 'file:///user' };

test('only created tabs are released for closing', () => {
  const ledger = new TabLedger();
  ledger.record(a1, false);
  ledger.record(u1, true);
  assert.deepEqual(ledger.release(), [a1]);
  assert.deepEqual(ledger.borrowed, []);
});

test('tabs the next view reuses stay open and stay created', () => {
  const ledger = new TabLedger();
  ledger.record(a1, false);
  ledger.record(b2, false);
  assert.deepEqual(ledger.release([a1]), [b2]);
  ledger.record(a1, true);
  assert.equal(ledger.isCreated(a1), true);
  assert.deepEqual(ledger.release(), [a1]);
});

test('the same file in another group is a different tab', () => {
  const ledger = new TabLedger();
  ledger.record(a1, false);
  assert.deepEqual(ledger.release([{ column: 2, uri: a1.uri }]), [a1]);
});

test('a borrowed tab is never released, even when it is not reused', () => {
  const ledger = new TabLedger();
  ledger.record(u1, true);
  assert.deepEqual(ledger.release([a1]), []);
  assert.deepEqual(ledger.release(), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd vscode && npm test`
Expected: FAIL with `Cannot find module '…/src/core/layout.ts'`.

- [ ] **Step 3: Write `layout.ts`**

```ts
/**
 * The four show-me layouts as `vscode.setEditorLayout` arguments, the
 * never-shrink rule, and the shape of the snapshot taken before a view opens.
 * Group order in a layout is the viewColumn order: pane i opens in column i.
 */
import type { View } from './protocol.gen.ts';

export type GroupLayout = { size?: number; groups?: GroupLayout[] };

/** orientation 0 lays groups side by side; nested groups alternate. */
export type EditorLayout = { orientation: 0 | 1; groups: GroupLayout[] };

/** Share of the width the primary pane of `main-stack` takes. */
export const MAIN_SHARE = 0.6;

export type GroupSnapshot = { activeUri?: string; activePreview: boolean };

export type Snapshot = { layout: EditorLayout; groups: GroupSnapshot[]; activeColumn: number };

const columns = (count: number): GroupLayout[] => Array.from({ length: count }, () => ({ size: 1 / count }));

export function layoutFor(layout: View['layout'], panes: number): EditorLayout {
  switch (layout) {
    case 'main-stack':
      return { orientation: 0, groups: [{ size: MAIN_SHARE }, { size: 1 - MAIN_SHARE, groups: Array.from({ length: panes - 1 }, () => ({})) }] };
    case 'single':
    case 'cols2':
    case 'cols3':
      return { orientation: 0, groups: columns(panes) };
  }
}

/** Apply a view's layout only when it removes none of the user's own groups. */
export function shouldApplyLayout(userGroups: number, panes: number): boolean {
  return userGroups <= panes;
}
```

Check `1 - MAIN_SHARE`: it evaluates to `0.4` exactly in IEEE doubles. The test expects `0.4`; if it fails on a rounding difference, compare with `assert.ok(Math.abs(x - 0.4) < 1e-9)` instead.

- [ ] **Step 4: Write `tabs.ts`**

```ts
/**
 * Which tabs show-me opened (created) and which of the user's tabs it reused
 * (borrowed) while laying views over the current window. Only created tabs
 * are ever closed: closing a user's tab with unsaved changes opens a save dialog.
 */
export type TabKey = { column: number; uri: string };

const same = (a: TabKey, b: TabKey): boolean => a.column === b.column && a.uri === b.uri;
const among = (keys: readonly TabKey[], key: TabKey): boolean => keys.some(k => same(k, key));

export class TabLedger {
  #created: TabKey[] = [];
  #borrowed: TabKey[] = [];

  /** `existed`: the group already showed this file. A tab show-me created stays created. */
  record(key: TabKey, existed: boolean): void {
    if (among(this.#created, key) || among(this.#borrowed, key)) return;
    (existed ? this.#borrowed : this.#created).push(key);
  }

  /** Forget every tab not in `keep`; return the created ones among them, for the caller to close. */
  release(keep: readonly TabKey[] = []): TabKey[] {
    const close = this.#created.filter(key => !among(keep, key));
    this.#created = this.#created.filter(key => among(keep, key));
    this.#borrowed = this.#borrowed.filter(key => among(keep, key));
    return close;
  }

  isCreated(key: TabKey): boolean {
    return among(this.#created, key);
  }

  get borrowed(): readonly TabKey[] {
    return this.#borrowed;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd vscode && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add vscode/src/core/layout.ts vscode/src/core/tabs.ts vscode/test/unit/layout.test.ts vscode/test/unit/tabs.test.ts
git commit -m "feat(vscode): map layouts to editor groups and track created and borrowed tabs"
```

---

### Task 7: Rendering over the current window

**Files:**
- Create: `vscode/src/render.ts`
- Create: `vscode/scripts/build.mjs`, `vscode/.vscode-test.mjs`
- Create: `vscode/test/integration/render.test.ts`
- Create: `vscode/test/fixtures/workspace/a.txt`, `b.txt`, `c.txt`, `d.txt`, `user.txt`, `other.txt` (each 20 lines of `line N`)
- Modify: `vscode/package.json` (scripts `build`, `test:integration`)

**Interfaces:**
- Consumes: `layoutFor`, `shouldApplyLayout`, `Snapshot`, `EditorLayout` (Task 6); `TabLedger`, `TabKey` (Task 6); `caption` (Task 3); `Deck` (Task 3); `Pane` (generated).
- Produces: `class Renderer implements vscode.Disposable` with `constructor(log: vscode.LogOutputChannel)`, `get position(): { deck: Deck; view: number } | undefined`, `open(deck: Deck, n: number): Promise<void>`, `step(delta: number): Promise<void>`, `close(): Promise<void>`, `dispose(): void`. It sets the context key `showMe.viewOpen`.

- [ ] **Step 1: Add the build script and test config**

`vscode/scripts/build.mjs`:

```js
// Bundles the extension (and, with --tests, the integration tests) with esbuild.
import { build } from 'esbuild';

const production = process.argv.includes('--production');
const shared = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: !production, logLevel: 'info' };

await build({ ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', minify: production });
if (process.argv.includes('--tests')) {
  await build({ ...shared, entryPoints: ['test/integration/*.test.ts'], outdir: 'out/test/integration', outExtension: { '.js': '.cjs' } });
}
```

`vscode/.vscode-test.mjs`:

```js
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.cjs',
  workspaceFolder: 'test/fixtures/workspace',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  env: { SHOW_ME_HOME: mkdtempSync(join(tmpdir(), 'sm')) },
  mocha: { ui: 'tdd', timeout: 30000 },
});
```

Add to `package.json` scripts:

```json
    "build": "node scripts/build.mjs",
    "test:integration": "node scripts/build.mjs --tests && vscode-test"
```

`src/extension.ts` doesn't exist until Task 8. Create a stub now so the bundle builds, and Task 8 replaces it:

```ts
export function activate(): void {}
```

Create the fixtures:

Run: `cd vscode/test/fixtures/workspace && for f in a b c d user other; do seq -f 'line %g' 1 20 > $f.txt; done`

- [ ] **Step 2: Write the failing integration tests**

`vscode/test/integration/render.test.ts`:

```ts
import * as assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { Renderer } from '../../src/render.ts';
import type { Deck } from '../../src/core/store.ts';

const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
const file = (name: string) => join(root, name);
const uriOf = (name: string) => vscode.Uri.file(file(name)).toString();

const deck: Deck = {
  id: 1, title: 'Tour', created_at: 0, done: true,
  views: [
    { layout: 'single', panes: [{ path: file('a.txt'), first: 3, last: 5 }] },
    { layout: 'cols2', title: 'Both', panes: [{ path: file('c.txt') }, { path: file('d.txt'), first: 2, last: 2 }] },
    { layout: 'cols3', panes: [{ path: file('a.txt') }, { path: file('b.txt') }, { path: file('c.txt') }] },
  ],
};

function tabsIn(column: number) {
  const group = vscode.window.tabGroups.all.find(g => g.viewColumn === column);
  return (group?.tabs ?? []).map(t => ({
    uri: t.input instanceof vscode.TabInputText ? t.input.uri.toString() : '',
    dirty: t.isDirty, preview: t.isPreview, active: t.isActive,
  }));
}

/** Revert dirty files first: closing a dirty editor opens a save dialog, which would hang the run. */
async function reset(): Promise<void> {
  for (const document of vscode.workspace.textDocuments.filter(d => d.isDirty)) {
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}] });
}

async function openUser(name: string, column: number, preview = false): Promise<vscode.TextEditor> {
  return vscode.window.showTextDocument(vscode.Uri.file(file(name)), { viewColumn: column, preview });
}

suite('currentWindow rendering', () => {
  let renderer: Renderer;
  setup(async () => {
    await reset();
    renderer = new Renderer(vscode.window.createOutputChannel('show-me test', { log: true }));
  });
  teardown(async () => {
    renderer.dispose();
    await reset();
  });

  test('never closes or pins a user tab, even a dirty one', async () => {
    const dirty = await openUser('user.txt', 1);
    await dirty.edit(edit => edit.insert(new vscode.Position(0, 0), 'unsaved '));
    await openUser('other.txt', 1, true);

    await renderer.open(deck, 1);
    await renderer.step(1);
    await renderer.close();

    const tabs = tabsIn(1);
    assert.deepEqual(tabs.map(t => t.uri).sort(), [uriOf('other.txt'), uriOf('user.txt')].sort());
    assert.equal(tabs.find(t => t.uri === uriOf('user.txt'))?.dirty, true);
    assert.equal(tabs.find(t => t.uri === uriOf('other.txt'))?.preview, true);
    assert.equal(tabs.find(t => t.uri === uriOf('other.txt'))?.active, true);
    assert.equal(vscode.window.tabGroups.all.length, 1);
  });

  test('reuses a tab the user had open and leaves it open', async () => {
    await openUser('a.txt', 1);
    await renderer.open(deck, 1);
    assert.equal(tabsIn(1).filter(t => t.uri === uriOf('a.txt')).length, 1);
    await renderer.close();
    assert.deepEqual(tabsIn(1).map(t => t.uri), [uriOf('a.txt')]);
  });

  test('scrolls the range to the top', async () => {
    await renderer.open(deck, 1);
    const editor = vscode.window.activeTextEditor!;
    assert.equal(editor.document.uri.toString(), uriOf('a.txt'));
    assert.equal(editor.visibleRanges[0]?.start.line, 2);
  });

  test('switching views closes only the tabs the next view does not reuse', async () => {
    await renderer.open(deck, 3);
    await renderer.step(-1);
    const open = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.deepEqual(open.sort(), [uriOf('c.txt'), uriOf('d.txt')].sort());
    assert.equal(vscode.window.tabGroups.all.length, 2);
  });

  test('never shrinks: the user\'s extra groups survive a smaller view', async () => {
    await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}, {}, {}] });
    await openUser('user.txt', 3);
    await renderer.open(deck, 1);
    assert.equal(vscode.window.tabGroups.all.length, 3);
    await renderer.close();
    assert.equal(vscode.window.tabGroups.all.length, 3);
    assert.deepEqual(tabsIn(3).map(t => t.uri), [uriOf('user.txt')]);
  });

  test('leaves a reshaped layout alone', async () => {
    await renderer.open(deck, 2);
    await vscode.commands.executeCommand('workbench.action.splitEditorRight');
    const groups = vscode.window.tabGroups.all.length;
    await renderer.close();
    const left = vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => (t.input as vscode.TabInputText).uri.toString());
    assert.ok(groups >= 3);
    assert.ok(left.length >= 1, 'the tab the user split off stays open');
    assert.equal(left.filter(u => u === uriOf('d.txt')).length, 0, "show-me's own tabs are closed");
  });
});
```

The `leaves a reshaped layout alone` test splits the active editor (pane 1, `c.txt`) into a new group. The resulting tab belongs to the user. After `close`, it must remain, and `d.txt` (created, column 2) must be gone.

Run: `cd vscode && npm run test:integration`
Expected: FAIL to build with `Could not resolve "../../src/render.ts"`.

- [ ] **Step 3: Write `render.ts`**

```ts
/**
 * Lays show-me views over the current window (`showMe.openIn: currentWindow`).
 *
 * Before the first view it snapshots the layout and each group's active tab.
 * Each view applies its layout (never removing the user's own groups), opens
 * pane i as the active tab of group i, scrolls its range to the top and
 * highlights it. Tabs the user already had open are borrowed, never closed;
 * tabs show-me created are closed when no longer needed. Closing restores the
 * snapshot unless the user has reshaped the window since.
 */
import * as vscode from 'vscode';
import { caption } from './core/format.ts';
import { layoutFor, shouldApplyLayout } from './core/layout.ts';
import type { EditorLayout, Snapshot } from './core/layout.ts';
import type { Pane } from './core/protocol.gen.ts';
import type { Deck } from './core/store.ts';
import { TabLedger } from './core/tabs.ts';
import type { TabKey } from './core/tabs.ts';

type Showing = {
  deck: Deck;
  view: number;
  keys: TabKey[];
  /** Highlighted range per `column|uri`. */
  ranges: Map<string, vscode.Range>;
  /** Group count right after this view opened, to tell whether the user reshaped the window. */
  groups: number;
};

const VIEW_OPEN = 'showMe.viewOpen';
const id = (key: TabKey): string => `${key.column}|${key.uri}`;

export class Renderer implements vscode.Disposable {
  readonly #log: vscode.LogOutputChannel;
  readonly #ledger = new TabLedger();
  readonly #decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('showMe.rangeBackground'),
    isWholeLine: true,
  });
  readonly #status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  readonly #subscriptions: vscode.Disposable[];
  #snapshot: Snapshot | undefined;
  #showing: Showing | undefined;

  constructor(log: vscode.LogOutputChannel) {
    this.#log = log;
    this.#subscriptions = [
      this.#decoration,
      this.#status,
      vscode.window.onDidChangeVisibleTextEditors(editors => this.#decorate(editors)),
      vscode.window.onDidChangeActiveTextEditor(editor => this.#caption(editor)),
    ];
  }

  get position(): { deck: Deck; view: number } | undefined {
    return this.#showing && { deck: this.#showing.deck, view: this.#showing.view };
  }

  async open(deck: Deck, n: number): Promise<void> {
    const view = deck.views[n - 1];
    if (!view) return;
    this.#snapshot ??= await Renderer.#takeSnapshot();
    if (shouldApplyLayout(this.#snapshot.groups.length, view.panes.length)) {
      await vscode.commands.executeCommand('vscode.setEditorLayout', layoutFor(view.layout, view.panes.length));
    }
    const keys = view.panes.map((pane, i) => ({ column: i + 1, uri: vscode.Uri.file(pane.path).toString() }));
    const ranges = new Map<string, vscode.Range>();
    for (const [i, pane] of view.panes.entries()) {
      const range = await this.#showPane(pane, keys[i]!);
      if (range) ranges.set(id(keys[i]!), range);
    }
    await this.#closeTabs(this.#ledger.release(keys));
    this.#showing = { deck, view: n, keys, ranges, groups: vscode.window.tabGroups.all.length };
    await vscode.commands.executeCommand('setContext', VIEW_OPEN, true);
    this.#decorate(vscode.window.visibleTextEditors);
    this.#caption(vscode.window.activeTextEditor);
  }

  async step(delta: number): Promise<void> {
    const showing = this.#showing;
    if (showing && showing.deck.views[showing.view - 1 + delta]) await this.open(showing.deck, showing.view + delta);
  }

  async close(): Promise<void> {
    const showing = this.#showing;
    const snapshot = this.#snapshot;
    if (!showing || !snapshot) return;
    const reshaped = vscode.window.tabGroups.all.length !== showing.groups;
    this.#showing = undefined;
    this.#snapshot = undefined;
    await this.#closeTabs(this.#ledger.release());
    this.#status.hide();
    this.#decorate(vscode.window.visibleTextEditors);
    await vscode.commands.executeCommand('setContext', VIEW_OPEN, false);
    if (reshaped) {
      this.#log.info('the window was reshaped during a view; leaving its layout as it is');
      return;
    }
    await vscode.commands.executeCommand('vscode.setEditorLayout', snapshot.layout);
    await Renderer.#restoreActiveTabs(snapshot);
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
  }

  /** Open `pane` in its group without replacing the user's preview tab; return its clamped range. */
  async #showPane(pane: Pane, key: TabKey): Promise<vscode.Range | undefined> {
    const existing = Renderer.#findTab(key);
    this.#ledger.record(key, existing !== undefined);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(key.uri));
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: key.column,
      preview: existing?.isPreview ?? false,
      preserveFocus: key.column !== 1,
    });
    if (pane.first === undefined) return undefined;
    // The file may have shrunk since the agent made the deck.
    const last = document.lineCount - 1;
    const range = new vscode.Range(Math.min(pane.first - 1, last), 0, Math.min((pane.last ?? pane.first) - 1, last), 0);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
    return range;
  }

  async #closeTabs(keys: TabKey[]): Promise<void> {
    const tabs = keys.flatMap(key => {
      const tab = Renderer.#findTab(key);
      if (tab?.isDirty) this.#log.info(`leaving ${key.uri} open: it has unsaved changes`);
      return tab && !tab.isDirty ? [tab] : [];
    });
    if (tabs.length > 0) await vscode.window.tabGroups.close(tabs, true);
  }

  /** Highlight the current view's ranges in visible editors; clear every other show-me highlight. */
  #decorate(editors: readonly vscode.TextEditor[]): void {
    for (const editor of editors) {
      const key = { column: editor.viewColumn ?? 0, uri: editor.document.uri.toString() };
      const range = this.#showing?.ranges.get(id(key));
      editor.setDecorations(this.#decoration, range ? [range] : []);
    }
  }

  /** Caption the pane whose editor is active, else pane 1. */
  #caption(editor: vscode.TextEditor | undefined): void {
    const showing = this.#showing;
    if (!showing) return this.#status.hide();
    const panes = showing.deck.views[showing.view - 1]!.panes;
    const active = editor && showing.keys.findIndex(k => k.column === editor.viewColumn && k.uri === editor.document.uri.toString());
    const pane = panes[active !== undefined && active >= 0 ? active : 0]!;
    this.#status.text = caption(showing.deck, showing.view, pane, vscode.workspace.asRelativePath(pane.path, false));
    this.#status.show();
  }

  static #findTab(key: TabKey): vscode.Tab | undefined {
    return vscode.window.tabGroups.all
      .find(group => group.viewColumn === key.column)
      ?.tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key.uri);
  }

  static async #takeSnapshot(): Promise<Snapshot> {
    const layout = await vscode.commands.executeCommand<EditorLayout>('vscode.getEditorLayout');
    const groups = vscode.window.tabGroups.all.map(group => {
      const tab = group.activeTab;
      return tab?.input instanceof vscode.TabInputText ? { activeUri: tab.input.uri.toString(), activePreview: tab.isPreview } : { activePreview: false };
    });
    return { layout, groups, activeColumn: vscode.window.tabGroups.activeTabGroup.viewColumn };
  }

  /** Re-activate each group's text tab from the snapshot; the active group goes last, taking focus. */
  static async #restoreActiveTabs(snapshot: Snapshot): Promise<void> {
    const order = snapshot.groups.map((group, i) => ({ ...group, column: i + 1 })).sort((a, b) => Number(a.column === snapshot.activeColumn) - Number(b.column === snapshot.activeColumn));
    for (const group of order) {
      if (!group.activeUri || !Renderer.#findTab({ column: group.column, uri: group.activeUri })) continue;
      await vscode.window.showTextDocument(vscode.Uri.parse(group.activeUri), {
        viewColumn: group.column,
        preview: group.activePreview,
        preserveFocus: group.column !== snapshot.activeColumn,
      });
    }
  }
}
```

- [ ] **Step 4: Run the integration tests**

Run: `cd vscode && npm run test:integration` (on Linux: `xvfb-run -a npm run test:integration`)
Expected: PASS, six tests. If `never closes or pins a user tab` fails because `other.txt` lost preview state, check that `#showPane` passes `existing?.isPreview` and `#restoreActiveTabs` passes `activePreview`. If `switching views…` leaves an empty third group, `workbench.editor.closeEmptyGroups` is off in the test profile. Add `"workbench.editor.closeEmptyGroups": true` through a `settings.json` in the fixture's `.vscode/` and record that the behaviour depends on this default.

- [ ] **Step 5: Type-check and commit**

Run: `cd vscode && npm run typecheck && npm test`
Expected: PASS.

```bash
git add vscode/src/render.ts vscode/src/extension.ts vscode/scripts/build.mjs vscode/.vscode-test.mjs vscode/test/integration vscode/test/fixtures vscode/package.json
git commit -m "feat(vscode): lay views over the current window without closing the user's tabs"
```

---

### Task 8: Commands, notification, picker, settings, activation

**Files:**
- Create: `vscode/src/navigator.ts`, `vscode/src/installer.ts`
- Replace: `vscode/src/extension.ts`
- Modify: `vscode/package.json` (`contributes`)
- Test: `vscode/test/integration/extension.test.ts`

**Interfaces:**
- Consumes: everything in `src/core`; `Renderer` (Task 7).
- Produces: `activate(context): Promise<ShowMeApi>` where `type ShowMeApi = { touch(): void; registryFile: string }`. The harness (Task 10) calls `touch()`; integration tests read `registryFile`. Commands `showMe.openView1`…`9`, `showMe.next`, `showMe.previous`, `showMe.pickDeck`, `showMe.close`.

- [ ] **Step 1: Write the failing integration test**

`vscode/test/integration/extension.test.ts`:

```ts
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { ShowMeApi } from '../../src/extension.ts';

suite('activation', () => {
  test('registers an ndjson entry for this window', async () => {
    const extension = vscode.extensions.all.find(e => e.packageJSON.name === 'show-me')!;
    const api: ShowMeApi = await extension.activate();
    assert.ok(existsSync(api.registryFile));
    const entry = JSON.parse(readFileSync(api.registryFile, 'utf8'));
    assert.equal(entry.editor, 'vscode');
    assert.equal(entry.transport.kind, 'ndjson');
    assert.match(entry.transport.token, /^[0-9a-f]{64}$/);
    assert.equal(entry.open_hint, 'ctrl+alt+v 1');
    const before = entry.focused_at;
    await new Promise(r => setTimeout(r, 5));
    api.touch();
    assert.ok(JSON.parse(readFileSync(api.registryFile, 'utf8')).focused_at > before);
  });

  test('every documented command exists', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const name of [...Array.from({ length: 9 }, (_, i) => `showMe.openView${i + 1}`), 'showMe.next', 'showMe.previous', 'showMe.pickDeck', 'showMe.close']) {
      assert.ok(commands.includes(name), name);
    }
  });
});
```

Run: `cd vscode && npm run test:integration`
Expected: FAIL. The stub `activate` returns nothing, so `api.registryFile` is undefined.

- [ ] **Step 2: Write `navigator.ts`**

```ts
/**
 * What the user does with decks: open a view by number, step, pick a deck,
 * close; and the notification when an agent finishes one.
 */
import * as vscode from 'vscode';
import { deckPickItem, doneNotice, noSuchView, OPEN_HINT } from './core/format.ts';
import type { Session } from './core/session.ts';
import { Rejection } from './core/store.ts';
import type { Deck } from './core/store.ts';
import type { Renderer } from './render.ts';

export class Navigator {
  readonly #session: Session;
  readonly #renderer: Renderer;
  readonly #log: vscode.LogOutputChannel;

  constructor(session: Session, renderer: Renderer, log: vscode.LogOutputChannel) {
    this.#session = session;
    this.#renderer = renderer;
    this.#log = log;
  }

  register(): vscode.Disposable[] {
    const commands: Record<string, () => Promise<void>> = {
      ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`showMe.openView${i + 1}`, () => this.open(i + 1)])),
      'showMe.next': () => this.#renderer.step(1),
      'showMe.previous': () => this.#renderer.step(-1),
      'showMe.pickDeck': () => this.pick(),
      'showMe.close': () => this.#renderer.close(),
    };
    return Object.entries(commands).map(([name, run]) => vscode.commands.registerCommand(name, () => this.#guard(name, run)));
  }

  async open(n: number): Promise<void> {
    const deck = this.#session.current();
    if (!deck) {
      void vscode.window.showWarningMessage('show-me: no deck yet; ask an agent to show you something');
    } else if (!deck.views[n - 1]) {
      void vscode.window.showWarningMessage(noSuchView(deck));
    } else {
      await this.#renderer.open(deck, n);
    }
  }

  async pick(): Promise<void> {
    const decks = this.#session.folders.length > 0 ? this.#session.store().listDone() : [];
    if (decks.length === 0) {
      void vscode.window.showWarningMessage('show-me: no decks yet');
      return;
    }
    const picked = await vscode.window.showQuickPick(decks.map(deckPickItem), { title: 'show-me decks', matchOnDetail: true });
    if (picked) await this.#show(picked.deck);
  }

  /** Never awaited by the request handler, and never takes focus. */
  announce(deck: Deck): void {
    void vscode.window.showInformationMessage(doneNotice(deck, OPEN_HINT), 'Open view 1').then(choice => {
      if (choice) return this.#guard('announce', () => this.#show(deck));
    });
  }

  async #show(deck: Deck): Promise<void> {
    this.#session.setCurrent(deck);
    await this.#renderer.open(deck, 1);
  }

  async #guard(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.#log.error(`${name}: ${error instanceof Rejection ? error.message : String(error)}`);
      void vscode.window.showErrorMessage(`show-me: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
```

- [ ] **Step 3: Write `installer.ts`**

```ts
/**
 * The extension never downloads the CLI itself: files VS Code writes may be
 * quarantined on macOS. When the CLI is missing it offers to run the
 * installer one-liner in a terminal instead.
 */
import * as vscode from 'vscode';
import { findCli } from './core/paths.ts';

const RELEASES = 'https://github.com/chanceygardener/show-me/releases/latest/download';
const DISMISSED = 'showMe.installerDismissed';

export async function offerInstaller(context: vscode.ExtensionContext, base: string): Promise<void> {
  if (context.globalState.get<boolean>(DISMISSED) || findCli(process.env, process.platform, base)) return;
  const choice = await vscode.window.showInformationMessage('show-me: agents need the show-me CLI to reach this editor.', 'Run installer', "Don't ask again");
  if (choice === "Don't ask again") return void (await context.globalState.update(DISMISSED, true));
  if (choice !== 'Run installer') return;
  const windows = process.platform === 'win32';
  const terminal = vscode.window.createTerminal({ name: 'show-me installer', shellPath: windows ? 'powershell.exe' : undefined });
  terminal.show();
  terminal.sendText(windows ? `irm ${RELEASES}/install.ps1 | iex` : `curl -fsSL ${RELEASES}/install.sh | sh`);
}
```

- [ ] **Step 4: Write `extension.ts`**

```ts
/**
 * show-me for VS Code: lets terminal coding agents illustrate explanations
 * in this window. The agent's `show-me` CLI finds the window through its
 * registry entry and sends requests over an ndjson socket or pipe. Decks
 * are stored per workspace folder; views are laid over the current window.
 * Nothing here moves focus on its own.
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { OPEN_HINT } from './core/format.ts';
import { baseDir, resolveFolder, socketAddress } from './core/paths.ts';
import { Registry } from './core/registry.ts';
import { PROTOCOL, Rpc } from './core/rpc.ts';
import { NdjsonServer } from './core/server.ts';
import { Session } from './core/session.ts';
import { offerInstaller } from './installer.ts';
import { Navigator } from './navigator.ts';
import { Renderer } from './render.ts';

/** Returned from activate for the test harness; not a public API. */
export type ShowMeApi = { touch(): void; registryFile: string };

const workspaceFolders = (): string[] =>
  (vscode.workspace.workspaceFolders ?? []).filter(f => f.uri.scheme === 'file').map(f => resolveFolder(f.uri.fsPath));

export async function activate(context: vscode.ExtensionContext): Promise<ShowMeApi> {
  const log = vscode.window.createOutputChannel('show-me', { log: true });
  const session = new Session(context.globalStorageUri.fsPath, message => log.warn(message));
  session.setFolders(workspaceFolders());
  const renderer = new Renderer(log);
  const navigator = new Navigator(session, renderer, log);
  const token = randomBytes(32).toString('hex');
  const rpc = new Rpc({ token, session, openHint: OPEN_HINT, announce: deck => navigator.announce(deck) });
  const base = baseDir();
  const registry = await serve(context, base, token, rpc, log);
  const update = (change: (r: Registry) => void): void => {
    if (!registry) return;
    try {
      change(registry);
    } catch (error) {
      log.warn(`could not update the registry entry: ${error}`);
    }
  };

  context.subscriptions.push(
    log,
    renderer,
    ...navigator.register(),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      session.setFolders(workspaceFolders());
      update(r => r.setFolders([...session.folders]));
    }),
    vscode.window.onDidChangeWindowState(state => state.focused && update(r => r.touch(Date.now()))),
  );
  void offerInstaller(context, base);
  return { touch: () => update(r => r.touch(Date.now())), registryFile: registry?.file ?? '' };
}

/**
 * Start the ndjson server and publish the registry entry; deactivation undoes both.
 * Returns undefined, after warning the user, when agents can't be served
 * (for example a socket path over the Unix limit).
 */
async function serve(context: vscode.ExtensionContext, base: string, token: string, rpc: Rpc, log: vscode.LogOutputChannel): Promise<Registry | undefined> {
  try {
    const address = socketAddress(base, process.pid, process.platform, randomBytes(4).toString('hex'));
    const server = await NdjsonServer.listen(address, line => rpc.handle(line));
    const registry = new Registry(base, {
      protocol: PROTOCOL,
      editor: 'vscode',
      pid: process.pid,
      workspace_folders: workspaceFolders(),
      transport: { kind: 'ndjson', address, token },
      open_hint: OPEN_HINT,
    }, Date.now());
    context.subscriptions.push({ dispose: () => { registry.remove(); server.close(); } });
    registry.write();
    return registry;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.error(`agents cannot reach this window: ${reason}`);
    void vscode.window.showWarningMessage(`show-me: agents cannot reach this window: ${reason}`);
    return undefined;
  }
}
```

`serve` is a non-exported function in `extension.ts`, not a scattered helper: it is the one place the transport starts, and only `activate` calls it.

- [ ] **Step 5: Fill in `contributes`**

In `vscode/package.json`, replace `"contributes": {}` with:

```json
  "contributes": {
    "commands": [
      { "command": "showMe.openView1", "title": "Open View 1", "category": "show-me" },
      { "command": "showMe.openView2", "title": "Open View 2", "category": "show-me" },
      { "command": "showMe.openView3", "title": "Open View 3", "category": "show-me" },
      { "command": "showMe.openView4", "title": "Open View 4", "category": "show-me" },
      { "command": "showMe.openView5", "title": "Open View 5", "category": "show-me" },
      { "command": "showMe.openView6", "title": "Open View 6", "category": "show-me" },
      { "command": "showMe.openView7", "title": "Open View 7", "category": "show-me" },
      { "command": "showMe.openView8", "title": "Open View 8", "category": "show-me" },
      { "command": "showMe.openView9", "title": "Open View 9", "category": "show-me" },
      { "command": "showMe.next", "title": "Next View", "category": "show-me" },
      { "command": "showMe.previous", "title": "Previous View", "category": "show-me" },
      { "command": "showMe.pickDeck", "title": "Pick a Deck", "category": "show-me" },
      { "command": "showMe.close", "title": "Close the View", "category": "show-me" }
    ],
    "keybindings": [
      { "command": "showMe.openView1", "key": "ctrl+alt+v 1" },
      { "command": "showMe.openView2", "key": "ctrl+alt+v 2" },
      { "command": "showMe.openView3", "key": "ctrl+alt+v 3" },
      { "command": "showMe.openView4", "key": "ctrl+alt+v 4" },
      { "command": "showMe.openView5", "key": "ctrl+alt+v 5" },
      { "command": "showMe.openView6", "key": "ctrl+alt+v 6" },
      { "command": "showMe.openView7", "key": "ctrl+alt+v 7" },
      { "command": "showMe.openView8", "key": "ctrl+alt+v 8" },
      { "command": "showMe.openView9", "key": "ctrl+alt+v 9" },
      { "command": "showMe.next", "key": "ctrl+alt+v ]", "when": "showMe.viewOpen" },
      { "command": "showMe.previous", "key": "ctrl+alt+v [", "when": "showMe.viewOpen" },
      { "command": "showMe.pickDeck", "key": "ctrl+alt+v d" },
      { "command": "showMe.close", "key": "ctrl+alt+v q", "when": "showMe.viewOpen" }
    ],
    "configuration": {
      "title": "show-me",
      "properties": {
        "showMe.openIn": {
          "type": "string",
          "scope": "resource",
          "enum": ["currentWindow"],
          "enumDescriptions": ["Lay views over this window's editor groups, then restore the layout."],
          "default": "currentWindow",
          "description": "Where show-me opens views."
        }
      }
    },
    "colors": [
      {
        "id": "showMe.rangeBackground",
        "description": "Background of the lines a show-me pane highlights.",
        "defaults": { "dark": "editor.rangeHighlightBackground", "light": "editor.rangeHighlightBackground", "highContrast": "editor.rangeHighlightBackground" }
      }
    ]
  },
```

Add to scripts: `"vscode:prepublish": "node scripts/build.mjs --production && node -e \"require('fs').copyFileSync('../LICENSE','LICENSE')\""`.

- [ ] **Step 6: Run the tests**

Run: `cd vscode && npm run typecheck && npm test && npm run test:integration`
Expected: PASS. If activation fails with an error about loading `dist/extension.cjs`, VS Code 1.90 is not resolving `.cjs` mains. In that case drop `"type": "module"` from `package.json`, rename the bundle to `dist/extension.js`, and rename the unit tests and scripts to `.mts`/`.mjs`. Record the change as a ruling in this plan.

- [ ] **Step 7: Commit**

```bash
git add vscode
git commit -m "feat(vscode): wire activation, commands, keys, notification, picker and the installer offer"
```

---

### Task 9: Editor-neutral conformance suite (Neovim driver only)

This task changes only structure. Every test still runs against Neovim alone, and all of them must pass unchanged before Task 10 adds VS Code.

**Files:**
- Modify: `test/conformance/conformance_test.go`
- Create: `test/conformance/nvim_test.go`

**Interfaces:**
- Consumes: `transport.Send`, `transport.Dial`, `protocol.*`.
- Produces (used by Task 10):
  - `type driver struct { name string; openHint string; prepare func() error; start func(w *world, dir string) *editor }`
  - `type editor struct { entry protocol.Entry; focus func(); kill func() }` with `func (e *editor) pid() int`
  - `var drivers map[string]driver` (registered in each driver file's `init`)
  - `func eachEditor(t *testing.T, test func(t *testing.T, w *world, d driver))`
  - `func (w *world) awaitEntry(prefix string, timeout time.Duration) protocol.Entry`
  - `func (w *world) status(e *editor) protocol.StatusResult`
  - `func (w *world) awaitGone(e *editor)`
  - `func shortTempDir(t *testing.T) string`

- [ ] **Step 1: Move the Neovim driver out**

`test/conformance/nvim_test.go`:

```go
package conformance

import (
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/neovim/go-client/nvim"

	"github.com/chanceygardener/show-me/internal/transport"
)

func init() {
	drivers["nvim"] = driver{
		name:     "nvim",
		openHint: "<leader>v1",
		prepare:  func() error { _, err := exec.LookPath("nvim"); return err },
		start:    func(w *world, dir string) *editor { return w.startNvim(dir, false) },
	}
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
	entry := w.awaitEntry(fmt.Sprintf("nvim-%d", cmd.Process.Pid), 20*time.Second)
	e := &editor{entry: entry}
	e.focus = func() { w.nvimEval(e, "execute('doautocmd FocusGained')") }
	e.kill = func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }
	return e
}

// nvimEval evaluates a Vimscript expression over RPC. `nvim --remote-expr` is
// not used: on Windows that client writes terminal setup sequences into its output.
func (w *world) nvimEval(e *editor, expr string) string {
	w.t.Helper()
	conn, err := transport.Dial(e.entry.Transport.Address, transport.DialTimeout)
	if err != nil {
		w.t.Fatalf("dial %s: %v", e.entry.Transport.Address, err)
	}
	defer conn.Close()
	client, err := nvim.New(conn, conn, conn, func(string, ...any) {})
	if err != nil {
		w.t.Fatalf("rpc %s: %v", e.entry.Transport.Address, err)
	}
	go func() { _ = client.Serve() }()
	var result any
	if err := client.Eval(expr, &result); err != nil {
		w.t.Fatalf("eval %s: %v", expr, err)
	}
	return fmt.Sprint(result)
}
```

- [ ] **Step 2: Make `conformance_test.go` editor-neutral**

Replace `TestMain`, `world`, `newWorld`, the `editor` type, `startNvim` and `remote` with:

```go
var (
	repoRoot, cliPath string
	// drivers holds every editor the suite knows; each driver file registers itself.
	drivers = map[string]driver{}
	// enabled holds the drivers this run tests, in SHOW_ME_CONFORMANCE_EDITORS order.
	enabled []driver
)

// driver knows how to run one kind of editor for the suite.
type driver struct {
	name     string
	openHint string
	prepare  func() error // finds what the editor needs; an error skips it locally and fails in CI
	start    func(w *world, dir string) *editor
}

// editor is one running editor, as its registry entry describes it.
type editor struct {
	entry protocol.Entry
	focus func() // as if the user switched to this editor
	kill  func() // the editor and every process it started
}

func (e *editor) pid() int { return e.entry.PID }

func TestMain(m *testing.M) {
	root, err := filepath.Abs("../..")
	if err != nil {
		panic(err)
	}
	repoRoot = root
	names := os.Getenv("SHOW_ME_CONFORMANCE_EDITORS")
	if names == "" {
		names = "nvim"
	}
	for _, name := range strings.Split(names, ",") {
		d, ok := drivers[name]
		if !ok {
			fmt.Printf("conformance: unknown editor %q\n", name)
			os.Exit(1)
		}
		if err := d.prepare(); err != nil {
			if os.Getenv("CI") != "" {
				fmt.Printf("conformance: %s: %v; CI must provide it\n", name, err)
				os.Exit(1)
			}
			fmt.Printf("conformance: skipping %s: %v\n", name, err)
			continue
		}
		enabled = append(enabled, d)
	}
	if len(enabled) == 0 {
		os.Exit(0)
	}
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

// eachEditor runs test once per enabled editor, each in a fresh world.
func eachEditor(t *testing.T, test func(t *testing.T, w *world, d driver)) {
	for _, d := range enabled {
		t.Run(d.name, func(t *testing.T) { test(t, newWorld(t), d) })
	}
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

// shortTempDir is tempDir under the system temp root, short enough for a Unix
// socket path inside it (macOS caps them at 104 bytes; t.TempDir() is longer).
func shortTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "sm")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if dir, err = filepath.EvalSymlinks(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

func newWorld(t *testing.T) *world {
	w := &world{t: t, home: shortTempDir(t), workspace: tempDir(t)}
	w.write(w.workspace, "a.txt", 5)
	w.write(w.workspace, "b.txt", 3)
	return w
}

// awaitEntry waits for a new registry entry whose file name starts with prefix.
func (w *world) awaitEntry(prefix string, timeout time.Duration) protocol.Entry {
	w.t.Helper()
	dir := filepath.Join(w.home, "editors")
	for deadline := time.Now().Add(timeout); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		files, _ := filepath.Glob(filepath.Join(dir, prefix+"*.json"))
		for _, file := range files {
			if w.seen(file) {
				continue
			}
			data, err := os.ReadFile(file)
			var e protocol.Entry
			if err == nil && json.Unmarshal(data, &e) == nil {
				w.claimed = append(w.claimed, file)
				return e
			}
		}
	}
	w.t.Fatalf("no %s* entry appeared in %s within %s", prefix, dir, timeout)
	return protocol.Entry{}
}

func (w *world) seen(file string) bool {
	for _, c := range w.claimed {
		if c == file {
			return true
		}
	}
	return false
}

// status asks an editor directly, bypassing the CLI's choice of editor.
func (w *world) status(e *editor) protocol.StatusResult {
	w.t.Helper()
	reply, err := transport.Send(e.entry.Transport, protocol.Request{Protocol: protocol.Version, Command: protocol.CommandStatus})
	if err != nil || !reply.OK {
		w.t.Fatalf("status of pid %d: %v %+v", e.pid(), err, reply)
	}
	var result protocol.StatusResult
	if err := json.Unmarshal(reply.Result, &result); err != nil {
		w.t.Fatal(err)
	}
	return result
}

// awaitGone waits until the CLI no longer lists e, i.e. its process has exited.
func (w *world) awaitGone(e *editor) {
	w.t.Helper()
	mark := fmt.Sprintf("pid %d ", e.pid())
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
		if out, _, _ := w.cli(w.workspace, "editors"); !strings.Contains(out, mark) {
			return
		}
	}
	w.t.Fatalf("pid %d is still registered after being killed", e.pid())
}
```

Add `claimed []string` to `world`. Keep `write`, `cli` and `expect` as they are.

- [ ] **Step 3: Port each test onto `eachEditor`**

```go
func TestSession(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		e := d.start(w, w.workspace)
		h := fmt.Sprintf("1@%d", e.pid())
		w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "How it works")
		w.expect(w.workspace, 0, "view 1\n", "view", h, "cols2", "a.txt:1-2", "b.txt")
		w.expect(w.workspace, 0, "view 2\n", "view", h, "single", "--title", "Only a", "a.txt:5")
		w.expect(w.workspace, 0, "done "+h+"\nopen: "+d.openHint+"\n", "done", h)
		out, _, _ := w.cli(w.workspace, "status")
		if !strings.Contains(out, fmt.Sprintf(`current: deck %s "How it works" (2 views)`, h)) {
			t.Fatalf("status: %q", out)
		}
	})
}
```

Apply the same wrapping to `TestRejections`, `TestWorktreeReachesMainCheckout`, `TestConcurrentViews` and `TestExitedEditor`: start with `e := d.start(w, w.workspace)` instead of `w.startNvim(w.workspace, false)`, and use `e.pid()` for `e.pid`. In `TestWorktreeReachesMainCheckout`, keep the git skip outside `eachEditor`. `TestExitedEditor` becomes:

```go
func TestExitedEditor(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		e := d.start(w, w.workspace)
		e.kill()
		w.awaitGone(e)
		w.expect(w.workspace, 3, "", "deck", "Nobody home")
		entry := filepath.Join(w.home, "editors", fmt.Sprintf("%s-%d.json", e.entry.Editor, e.pid()))
		if _, err := os.Stat(entry); !os.IsNotExist(err) {
			t.Fatalf("stale entry %s was not cleaned up", entry)
		}
	})
}
```

`TestHandleSticksToItsEditor` uses focus and status instead of Lua:

```go
func TestHandleSticksToItsEditor(t *testing.T) {
	eachEditor(t, func(t *testing.T, w *world, d driver) {
		owner := d.start(w, w.workspace)
		other := d.start(w, w.workspace)
		owner.focus()
		h := fmt.Sprintf("1@%d", owner.pid())
		w.expect(w.workspace, 0, "deck "+h+"\n", "deck", "Pinned")
		other.focus()
		w.expect(w.workspace, 0, "view 1\n", "view", h, "single", "a.txt")
		w.expect(w.workspace, 0, "*", "done", h)
		if got := w.status(owner).Current; got == nil || got.Deck != 1 {
			t.Fatalf("the owner's current deck is %+v, want deck 1", got)
		}
		if got := w.status(other).Current; got != nil {
			t.Fatalf("the focused editor received the deck: %+v", got)
		}
	})
}
```

`TestLateSetupStillRegisters` stays Neovim-only:

```go
func TestLateSetupStillRegisters(t *testing.T) {
	if !slices.ContainsFunc(enabled, func(d driver) bool { return d.name == "nvim" }) {
		t.Skip("Neovim is not under test")
	}
	w := newWorld(t)
	e := w.startNvim(w.workspace, true)
	w.expect(w.workspace, 0, fmt.Sprintf("deck 1@%d\n", e.pid()), "deck", "Lazy")
}
```

Remove the now-unused `nvim` import from `conformance_test.go`, and add `slices`.

- [ ] **Step 4: Run the suite against Neovim**

Run: `gofmt -w test/conformance/*.go && go vet ./test/conformance && go test ./test/conformance -count=1 -v`
Expected: PASS. Every test name now carries a `/nvim` subtest, plus `TestLateSetupStillRegisters`.

- [ ] **Step 5: Commit**

```bash
git add test/conformance
git commit -m "test(conformance): drive editors through a driver so any editor can run the suite"
```

---

### Task 10: The VS Code conformance driver and harness

**Files:**
- Create: `vscode/test/harness/package.json`, `vscode/test/harness/extension.cjs`
- Create: `vscode/test/conformance/vscode-path.mjs`
- Create: `test/conformance/vscode_test.go`, `test/conformance/proc_unix_test.go`, `test/conformance/proc_windows_test.go`

**Interfaces:**
- Consumes: `driver`, `editor`, `world.awaitEntry`, `shortTempDir`, `drivers` (Task 9); `ShowMeApi.touch` (Task 8).
- Produces: `drivers["vscode"]`, enabled with `SHOW_ME_CONFORMANCE_EDITORS=vscode`.

- [ ] **Step 1: Write the harness extension**

`vscode/test/harness/package.json`:

```json
{
  "name": "show-me-harness",
  "publisher": "show-me-test",
  "version": "0.0.0",
  "private": true,
  "description": "Test-only: lets the Go conformance suite fake window focus. Never published.",
  "engines": { "vscode": "^1.90.0" },
  "main": "./extension.cjs",
  "activationEvents": ["onStartupFinished"]
}
```

`vscode/test/harness/extension.cjs`:

```js
// Test-only companion to the show-me extension. When SHOW_ME_HARNESS names a
// socket, it answers {"call":"touch"} lines by calling the real extension's
// exported touch(), which is what gaining window focus does.
const net = require('node:net');
const vscode = require('vscode');

exports.activate = async () => {
  const address = process.env.SHOW_ME_HARNESS;
  if (!address) return;
  const showMe = vscode.extensions.all.find(e => e.packageJSON.name === 'show-me');
  const api = await showMe.activate();
  const calls = { touch: () => api.touch() };
  net.createServer(socket => {
    let buffered = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffered += chunk;
      const end = buffered.indexOf('\n');
      if (end < 0) return;
      const { call } = JSON.parse(buffered.slice(0, end));
      calls[call]?.();
      socket.end(`${JSON.stringify({ ok: call in calls })}\n`);
    });
  }).listen(address);
};
```

- [ ] **Step 2: Write the VS Code locator**

`vscode/test/conformance/vscode-path.mjs`:

```js
// Downloads (once, into .vscode-test/) the VS Code build the Go conformance
// suite runs, and writes its executable path to the file named by argv[2].
// Progress output goes to stdout, so the path travels by file.
import { writeFileSync } from 'node:fs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const executable = await downloadAndUnzipVSCode(process.env.SHOW_ME_VSCODE_VERSION || 'stable');
writeFileSync(process.argv[2], executable);
```

- [ ] **Step 3: Write process-tree kill helpers**

`test/conformance/proc_unix_test.go`:

```go
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
```

`test/conformance/proc_windows_test.go`:

```go
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
```

- [ ] **Step 4: Write the driver**

`test/conformance/vscode_test.go`:

```go
package conformance

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chanceygardener/show-me/internal/transport"
)

// vscodeExe is the VS Code build under test, found by prepareVSCode.
var vscodeExe string

func init() {
	drivers["vscode"] = driver{
		name:     "vscode",
		openHint: "ctrl+alt+v 1",
		prepare:  prepareVSCode,
		start:    func(w *world, dir string) *editor { return w.startVSCode(dir) },
	}
}

// prepareVSCode checks the extension is built and downloads VS Code once.
func prepareVSCode() error {
	ext := filepath.Join(repoRoot, "vscode")
	if _, err := os.Stat(filepath.Join(ext, "dist", "extension.cjs")); err != nil {
		return fmt.Errorf("the extension isn't built (cd vscode && npm run build): %w", err)
	}
	out, err := os.CreateTemp("", "vscode-path")
	if err != nil {
		return err
	}
	_ = out.Close()
	defer os.Remove(out.Name())
	locate := exec.Command("node", filepath.Join("test", "conformance", "vscode-path.mjs"), out.Name())
	locate.Dir, locate.Stdout, locate.Stderr = ext, os.Stderr, os.Stderr
	if err := locate.Run(); err != nil {
		return fmt.Errorf("downloading VS Code: %w", err)
	}
	data, err := os.ReadFile(out.Name())
	vscodeExe = strings.TrimSpace(string(data))
	return err
}

// startVSCode opens dir in a fresh VS Code instance (its own user-data dir,
// so it can't attach to another) with show-me and the test harness loaded.
func (w *world) startVSCode(dir string) *editor {
	w.t.Helper()
	data := shortTempDir(w.t) // VS Code puts an IPC socket in its user-data dir
	harness := harnessAddress(w.t)
	ext := filepath.Join(repoRoot, "vscode")
	args := []string{dir,
		"--extensionDevelopmentPath=" + ext,
		"--extensionDevelopmentPath=" + filepath.Join(ext, "test", "harness"),
		"--user-data-dir=" + filepath.Join(data, "u"),
		"--extensions-dir=" + filepath.Join(data, "x"),
		"--disable-extensions", "--disable-workspace-trust", "--disable-gpu",
		"--skip-welcome", "--skip-release-notes", "--new-window",
	}
	if runtime.GOOS == "linux" {
		args = append(args, "--no-sandbox")
	}
	cmd := exec.Command(vscodeExe, args...)
	cmd.Env = append(vscodeEnv(), "SHOW_ME_HOME="+w.home, "SHOW_ME_HARNESS="+harness)
	isolate(cmd)
	if err := cmd.Start(); err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(func() { killTree(cmd) })
	entry := w.awaitEntry("vscode-", 120*time.Second)
	return &editor{
		entry: entry,
		focus: func() { w.harnessCall(harness, "touch") },
		kill:  func() { killTree(cmd) },
	}
}

// vscodeEnv is this process's environment without the variables that make
// VS Code hand its arguments to an already-running instance (as it does when
// the tests run from VS Code's own terminal).
func vscodeEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "VSCODE_") && !strings.HasPrefix(kv, "ELECTRON_RUN_AS_NODE=") {
			env = append(env, kv)
		}
	}
	return env
}

func harnessAddress(t *testing.T) string {
	if runtime.GOOS == "windows" {
		return fmt.Sprintf(`\\.\pipe\show-me-harness-%d-%d`, os.Getpid(), time.Now().UnixNano())
	}
	return filepath.Join(shortTempDir(t), "h.sock")
}

// harnessCall asks the harness extension to run call, waiting for it to listen.
func (w *world) harnessCall(address, call string) {
	w.t.Helper()
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		conn, err := transport.Dial(address, transport.DialTimeout)
		if err != nil {
			continue
		}
		_, _ = fmt.Fprintf(conn, `{"call":%q}`+"\n", call)
		reply, err := bufio.NewReader(conn).ReadString('\n')
		_ = conn.Close()
		if err == nil && strings.Contains(reply, `"ok":true`) {
			return
		}
		w.t.Fatalf("harness %s: %q %v", call, reply, err)
	}
	w.t.Fatalf("the harness never listened on %s", address)
}
```

- [ ] **Step 5: Run the suite against VS Code**

Run: `cd vscode && npm run build && cd .. && SHOW_ME_CONFORMANCE_EDITORS=vscode go test ./test/conformance -count=1 -v -timeout 20m`
On Linux, prefix the `go test` with `xvfb-run -a`.
Expected: every `…/vscode` subtest PASSES and `TestLateSetupStillRegisters` SKIPS.

If `TestExitedEditor/vscode` fails with the entry still present, the extension host outlived the process-group kill. Confirm with `ps -o pid,pgid,comm` while the test sleeps. If it did escape, extend `killTree` to also `syscall.Kill(e.pid(), SIGKILL)` the registered pid, and record that.

Run: `SHOW_ME_CONFORMANCE_EDITORS=nvim,vscode go test ./test/conformance -count=1`
Expected: PASS, both editors.

- [ ] **Step 6: Commit**

```bash
gofmt -w test/conformance/vscode_test.go test/conformance/proc_*_test.go
git add test/conformance vscode/test/harness vscode/test/conformance
git commit -m "test(conformance): run the suite against VS Code through a harness extension"
```

---

### Task 11: CI and release

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add the extension job to CI**

Append to `jobs:` in `.github/workflows/ci.yml`:

```yaml
  extension:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    env:
      SHOW_ME_CONFORMANCE_EDITORS: vscode
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
          cache-dependency-path: vscode/package-lock.json
      - run: npm ci
        working-directory: vscode
      - run: npm run typecheck
        working-directory: vscode
      - run: npm test
        working-directory: vscode
      - name: generated protocol files are current
        if: runner.os == 'Linux'
        run: |
          go generate ./internal/protocol
          npm --prefix vscode run gen
          git diff --exit-code -- protocol/schema.json vscode/src/core/protocol.gen.ts
      - run: npm run build
        working-directory: vscode
      - run: xvfb-run -a npm run test:integration
        if: runner.os == 'Linux'
        working-directory: vscode
      - run: npm run test:integration
        if: runner.os != 'Linux'
        working-directory: vscode
      - run: xvfb-run -a go test ./test/conformance -count=1 -v -timeout 30m
        if: runner.os == 'Linux'
      - run: go test ./test/conformance -count=1 -v -timeout 30m
        if: runner.os != 'Linux'
      - run: npx vsce package --no-dependencies -o show-me.vsix
        if: runner.os == 'Linux'
        working-directory: vscode
      - uses: actions/upload-artifact@v4
        if: runner.os == 'Linux'
        with:
          name: show-me-vsix
          path: vscode/show-me.vsix
```

The existing `test` job keeps running conformance against Neovim through `go test ./...`, since the default editor list is `nvim`.

- [ ] **Step 2: Add packaging and gated publishing to the release**

Append to `jobs:` in `.github/workflows/release.yml`:

```yaml
  vscode:
    needs: release
    runs-on: ubuntu-latest
    env:
      VSCE_PAT: ${{ secrets.VSCE_PAT }}
      OVSX_PAT: ${{ secrets.OVSX_PAT }}
      GH_TOKEN: ${{ github.token }}
    defaults:
      run:
        working-directory: vscode
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: package.json version matches VERSION
        run: test "$(node -p "require('./package.json').version")" = "$(cat ../VERSION)"
      - run: npm ci
      - run: npx vsce package --no-dependencies -o "show-me-$(cat ../VERSION).vsix"
      - run: gh release upload "$GITHUB_REF_NAME" show-me-*.vsix
      - name: publish to the VS Code Marketplace
        if: env.VSCE_PAT != ''
        run: npx vsce publish --no-dependencies --packagePath show-me-*.vsix
      - name: publish to Open VSX
        if: env.OVSX_PAT != ''
        run: npx ovsx publish show-me-*.vsix -p "$OVSX_PAT"
```

- [ ] **Step 3: Check the workflows**

Run: `npx --yes @action-validator/cli .github/workflows/ci.yml && npx --yes @action-validator/cli .github/workflows/release.yml`
If `action-validator` isn't available, run `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` instead.
Expected: no errors.

Run: `cd vscode && npx vsce package --no-dependencies -o /tmp/show-me.vsix && unzip -l /tmp/show-me.vsix`
Expected: the listing has `extension/dist/extension.cjs`, `extension/package.json`, `extension/README.md`, `extension/LICENSE`, and no `src/`, `test/` or `node_modules/`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows
git commit -m "ci: test, package and (when tokens exist) publish the VS Code extension"
```

---

### Task 12: Documentation

**Files:**
- Create: `vscode/README.md`
- Modify: `README.md`, `protocol/PROTOCOL.md`, `CONTRIBUTING.md`, `skills/show-me/SKILL.md`, `docs/specs/2026-10-17-show-me-design.md`

- [ ] **Step 1: `protocol/PROTOCOL.md`**

- In *Rejections*, add the row: `| Bad token | Editor (ndjson) | \`bad token\` |`.
- In *Base directory*, change the holdings line to: `It holds \`editors/\` (the registry), \`bin/\` (the installed CLI) and \`sock/\` (VS Code sockets, POSIX only).`
- Replace the `ndjson` transport bullet with:

```markdown
- **`ndjson`** (VS Code): the address is a Unix socket (`<base>/sock/vscode-<pid>.sock`,
  mode 0600 in a 0700 directory) or a Windows named pipe
  (`\\.\pipe\show-me-vscode-<pid>-<random>`). The CLI writes one request line
  carrying the entry's `token` (64 hex characters) and reads one reply line;
  the editor then closes the connection. A request without the right token
  gets `bad token`. Requests over 1 MiB are dropped.
```

- In *Registry*, after the example, add: `\`editor\` is \`nvim\` or \`vscode\`. \`protocol/schema.json\` describes every shape here; it is generated from \`internal/protocol\`.`

- [ ] **Step 2: `vscode/README.md` (the Marketplace page)**

Write these sections:
- **What it does:** two sentences.
- **Install:** the extension, plus the CLI one-liners from the root README. Mention the "Run installer" prompt and say not to download the CLI from a browser.
- **Use:** a key table mirroring the Neovim one, using the chords from Global Constraints. Then: `Views lay over your current editor groups. show-me never closes your tabs, including ones with unsaved changes, and puts your layout back when you close the view (unless you reshaped the window meanwhile).`
- **Settings:** `showMe.openIn` (only `currentWindow` for now). **Colours:** `showMe.rangeBackground`.
- **Multi-root workspaces:** decks go to the first folder.
- **Remote, WSL and dev containers:** not supported yet. The extension runs as a workspace extension, so a Remote window registers on the remote machine; this is untested.
- **Cursor and VSCodium:** install from Open VSX.

- [ ] **Step 3: Root `README.md`**

- Line 9: change the support line to `Works with Neovim 0.10+ and VS Code 1.90+ (and Cursor, VSCodium) on macOS, Linux and Windows.`
- Add a `### VS Code` section after `### Neovim (lazy.nvim)`. It covers installing from the Marketplace or Open VSX and running the CLI one-liner (or accepting the extension's prompt), with a link to `vscode/README.md`.
- In `## Use`, add the VS Code key chords beside the Neovim table.

- [ ] **Step 4: `CONTRIBUTING.md`**

- Setup: add `Node 24 and npm, for the VS Code extension (cd vscode && npm ci)`, and the commands `npm test`, `npm run test:integration` and `SHOW_ME_CONFORMANCE_EDITORS=nvim,vscode go test ./test/conformance`.
- Check the add-an-editor checklist against what VS Code needed, and add the steps it was missing:
  - (3a) the protocol types are generated: run `go generate ./internal/protocol`, then generate your language's types from `protocol/schema.json`;
  - (4) a conformance driver in `test/conformance/<editor>_test.go`, implementing `prepare`, `start`, `focus` and `kill`, registered in `drivers`;
  - (5) a CI job running the suite with `SHOW_ME_CONFORMANCE_EDITORS=<editor>`.
- Releasing: add `vscode/package.json`'s `version` to the files bumped with `VERSION`.

- [ ] **Step 5: `skills/show-me/SKILL.md`**

On line 42, after the `<leader>v1` example, add `(VS Code prints \`ctrl+alt+v 1\`)`. Nothing else in the skill is editor-specific, so nothing else changes.

- [ ] **Step 6: The spec**

In `docs/specs/2026-10-17-show-me-design.md`:
- Add `vscode/test/harness/` and `vscode/src/core/` rows to *Repository layout*.
- In *VS Code extension (phase 2)*, add a short **Rulings** list copied from this plan's *Decisions made before planning* and *Rulings made while planning*.
- In *Testing*, replace "Phase 2 adds a VS Code target driven through `@vscode/test-electron`" with a description of the driver and harness as built.

- [ ] **Step 7: Commit**

```bash
git add README.md protocol/PROTOCOL.md CONTRIBUTING.md skills/show-me/SKILL.md docs/specs vscode/README.md
git commit -m "docs: document the VS Code extension, the ndjson transport and adding an editor"
```

---

## Final step: tests and docs checklist

Before finishing the branch, confirm:

- **Tests:**
  - `go vet ./... && go test ./...` passes; it includes conformance against Neovim.
  - `./test/nvim/run.sh` passes. Nothing in Lua changed, so this is a regression check.
  - `cd vscode && npm run typecheck && npm test && npm run test:integration` passes.
  - `SHOW_ME_CONFORMANCE_EDITORS=nvim,vscode go test ./test/conformance -count=1` passes locally on macOS.
  - `go generate ./internal/protocol && npm --prefix vscode run gen && git diff --exit-code` is clean.
  - The CI `extension` job is green on all three OSes. Expect to iterate on Windows (pipe names, `taskkill`), as phase 1 did.
- **Docstrings:** every new Go and TypeScript file opens with a module comment saying what it owns, as phase 1's files do.
- **Docs:** `protocol/PROTOCOL.md`, `README.md`, `vscode/README.md`, `CONTRIBUTING.md`, `skills/show-me/SKILL.md` and the spec describe the shipped behaviour. Rulings changed during execution (for example the `.cjs` fallback) are recorded in this plan and the spec.
- **Manual check:** in a real VS Code, with the CLI installed, run `show-me deck`/`view`/`done` from a terminal. Then press `ctrl+alt+v 1`, step with `]`/`[`, and close with `q`, in a window with a dirty file, a preview tab and two groups. Confirm nothing of yours was closed or pinned.
- **Not done here, and the user's decision:**
  - choosing the Marketplace publisher id (the placeholder is `chanceygardener`) and adding the `VSCE_PAT` and `OVSX_PAT` secrets;
  - bumping `VERSION` and `vscode/package.json` to the release version and tagging;
  - pushing `ian/feat/phase-2` and opening the PR (which closes issue #2);
  - the phase 3 floating-window spike.
