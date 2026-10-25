# show-me — Design

**Date:** 2026-10-17
**Status:** draft for review
**Supersedes:** `kickstart.nvim/docs/superpowers/specs/2026-10-11-show-me-nvim-design.md`
(the in-config prototype). Everything not changed here carries over from that design.

## Problem

Coding agents (Claude Code, Codex, Cursor, occasionally a custom agent) run in a terminal
next to the user's editor. They can only quote code in chat. The prototype in the
kickstart.nvim config lets them build **decks** of multi-pane **views** in Neovim, which
the user opens at their own pace. It works, but it is wired into one person's config,
it only supports Neovim, and its socket scheme is home-grown.

This project extracts it into a standalone repository that friends can install, and
adds VS Code (and so Cursor and Windsurf) as a second editor.

## Goals

- One repository containing the Neovim plugin, the VS Code extension, the `show-me`
  CLI, and the agent skill, versioned together.
- The CLI is a single Go binary with no runtime dependency, on macOS, Linux and
  Windows (amd64 and arm64).
- The CLI validates requests; editors store decks and render them. A new editor port
  only stores and renders.
- Agents find the right editor through a **registry** of running editors, using each
  editor's existing RPC server where it has one. No invented socket names.
- Install is one command per OS, needs no Apple or Microsoft signing, and leaves a
  binary agents can run without a GUI prompt.
- The agent-facing behaviour (commands, output, exit codes, error text) is written down
  in `protocol/PROTOCOL.md` and checked against every editor by one conformance suite.

## Non-goals

- Showing a file at a git revision that is not checked out. Worktrees on disk cover
  cross-branch comparison by path.
- Per-agent namespaces. Vendors expose no common session identity.
- Auto-opening views when they arrive. Editors notify only.
- VS Code Remote (SSH, WSL, dev containers) in the first VS Code release.
- An MCP server mode, a Homebrew tap, winget/Scoop packages, and Apple notarization.
  Each is listed under [Later](#later).

## Decisions and alternatives considered

### Who owns decks

| Option | Verdict |
|---|---|
| Editors validate and store (prototype) | Validation duplicated in every editor; agents could get different errors per editor. |
| CLI validates and stores; editors only render | Many CLI processes write the same files concurrently (several agents at once), and editors still need a change notification, so the RPC channel stays and files become a second channel. |
| **CLI validates; the editor stores** | **Chosen.** Stateless checks (layout, pane count, paths, ranges) live once, in Go. Stateful checks (deck exists, not done, view cap) are a few lines per editor. The editor stays the only writer and learns of every change synchronously. |

### CLI language

| Option | Verdict |
|---|---|
| bash + perl (prototype) | No perl on Windows; `alarm` unreliable there; validation in perl is hard to maintain. |
| TypeScript compiled with bun/deno | Shares types with the VS Code extension, but 50–90 MB binaries. |
| Rust | Same distribution story as Go; slower to write; no benefit here. |
| **Go** | **Chosen.** Trivial cross-compilation, ~6 MB static binary, stdlib covers JSON, sockets, named pipes (via `go-winio`) and timeouts, and `github.com/neovim/go-client` speaks Neovim's msgpack-RPC directly. |

### Finding the editor

| Option | Verdict |
|---|---|
| Socket path derived from a hash of the editor's cwd (prototype) | Home-grown naming; stale socket files; a race when two Neovims start at once. |
| `$NVIM` | Only set for processes inside Neovim's `:terminal`; agents run in a separate window. |
| Claude Code's IDE lockfiles (`~/.claude/ide/*.lock`) | Proven pattern, but Claude-only, fixed tool set, and another product's private protocol. |
| **Registry of running editors, each pointing at its own RPC endpoint** | **Chosen.** Neovim registers the server it already starts (`v:servername`); VS Code registers a socket or named pipe. Same pattern as Claude's lockfiles, editor- and agent-neutral. |

### Distribution

| Option | Verdict |
|---|---|
| Binaries committed into the skill directory | Tens of MB per release in git. |
| Each editor plugin downloads the binary itself | Two downloaders to maintain; VS Code may quarantine files it writes (unverified). |
| **One installer script per OS, used by both plugins and by hand** | **Chosen.** `curl` and PowerShell downloads are not quarantined, so no signing is needed; checksums are verified; it also installs the skill. |

### VS Code display mode

Configurable, `showMe.openIn`. **`currentWindow` (the default) ships first**: views are
laid over the current window's editor groups and the layout is restored afterwards.
`newWindow` (VS Code's floating editor windows) and `ask` wait on a spike, because the
extension API cannot reliably target a floating window's groups.

## Architecture

```
agent ──runs──▶ show-me (Go) ──validates──▶ reads registry ──picks editor──▶ RPC
                                                                     │
                     ┌───────────────────────────────────────────────┴──────────────┐
                     ▼                                                              ▼
          Neovim plugin (Lua)                                          VS Code extension (TS)
          nvim_exec_lua over v:servername                              NDJSON over unix socket / named pipe
          stores decks, renders in a tab                               stores decks, renders over editor groups
```

### Repository layout

The Neovim plugin sits at the repository root because plugin managers (lazy.nvim
included) put the repository root on `runtimepath`.

| Path | Responsibility |
|---|---|
| `lua/show_me/init.lua` | `setup(opts)`, user commands, keymaps, public API (`open`, `step`, `pick`, `close`, `status`) |
| `lua/show_me/config.lua` | Option types, defaults and merging |
| `lua/show_me/registry.lua` | Write, refresh and remove this editor's registry entry |
| `lua/show_me/state.lua` | Session state: the workspace served, its store, the current deck |
| `lua/show_me/util.lua` | `now_ms()`, the one helper shared by store and registry |
| `lua/show_me/rpc.lua` | `handle(json) → json`: the protocol entry point called by the CLI |
| `lua/show_me/store.lua` | Deck persistence, editor-side rejections, pruning, current deck |
| `lua/show_me/layout.lua` | The four layout builders (ported, sidebar-aware) |
| `lua/show_me/render.lua` | The show-me tab: layout, buffers, highlights, winbar, sidebar preservation |
| `lua/show_me/health.lua` | `:checkhealth show_me` |
| `doc/show-me.txt` | Vim help |
| `cmd/show-me/main.go` | CLI entry: argument parsing, exit codes |
| `internal/protocol/` | Request/response types (source of truth for the JSON Schema), version constant |
| `internal/check/` | Stateless request checks: deck titles, layouts, pane counts, `path[:N[-M]]` parsing, file and range checks |
| `internal/registry/` | Registry directory location, reading entries, choosing an editor |
| `internal/transport/` | One client per transport kind: `nvim` (msgpack-RPC) in phase 1, `ndjson` (VS Code) added in phase 2 |
| `protocol/PROTOCOL.md` | The agent- and editor-facing contract |
| `protocol/schema.json` | Generated from `internal/protocol` by `go generate` (phase 2, when the VS Code extension consumes it) |
| `skills/show-me/SKILL.md` | Agent instructions, editor-neutral |
| `install.sh`, `install.ps1` | Installers (also published as release assets) |
| `vscode/` | The VS Code extension (phase 2) |
| `test/nvim/` | Neovim specs, run with `nvim -l` (helpers ported from kickstart.nvim) |
| `test/conformance/` | Go tests that drive a real editor through the real CLI |
| `.goreleaser.yaml`, `.github/workflows/` | Release builds and CI |

### Base directory

Both sides compute one base directory, overridable with `SHOW_ME_HOME` (used by tests):

| OS | Base |
|---|---|
| macOS, Linux | `$XDG_STATE_HOME/show-me`, else `~/.local/state/show-me` |
| Windows | `%LOCALAPPDATA%\show-me` |

Created with mode 0700 (POSIX). Contents: `editors/` (registry), `bin/` (installed
CLI), `sock/` (VS Code sockets on POSIX). Decks are stored by each editor in its own
state area, not here.

## Registry

Each running editor writes one file, `editors/<editor>-<pid>.json`, mode 0600, written
atomically (temp file + rename):

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

```go
type Entry struct {
    Protocol         int       `json:"protocol"`
    Editor           string    `json:"editor"`            // "nvim" | "vscode"
    PID              int       `json:"pid"`
    WorkspaceFolders []string  `json:"workspace_folders"` // absolute paths
    Transport        Transport `json:"transport"`
    OpenHint         string    `json:"open_hint"`         // how the user opens view 1
    StartedAt        int64     `json:"started_at"`        // epoch ms
    FocusedAt        int64     `json:"focused_at"`        // epoch ms
}

type Transport struct {
    Kind    string `json:"kind"`            // "nvim" | "ndjson"
    Address string `json:"address"`         // socket path or \\.\pipe\… name
    Token   string `json:"token,omitempty"` // required by ndjson servers
}
```

**Neovim** writes its entry on `VimEnter` (or immediately if `setup()` runs later),
using `v:servername`, and its global cwd as the single workspace folder. It rewrites the
entry on global `DirChanged` and updates `focused_at` on `FocusGained`. It deletes the
entry on `VimLeavePre`.

**VS Code** writes its entry on activation with every workspace folder, rewrites it on
`onDidChangeWorkspaceFolders`, updates `focused_at` on `onDidChangeWindowState`, and
deletes it on deactivation.

### Choosing an editor (CLI)

1. Build the target list: `realpath(cwd)`, then the repository's main checkout root
   (the parent of `realpath(git rev-parse --git-common-dir)`) if it differs. Git is
   optional; outside a repository only the cwd is used.
2. Read every entry. Drop entries whose `pid` is not alive and delete their files. Drop
   entries whose `protocol` the CLI does not speak, but remember them for the error
   message.
3. For the first target that matches anything, pick the entry whose workspace folder
   contains the target, longest folder first, then most recent `focused_at`. Paths
   compare case-insensitively on macOS and Windows.
4. Connect within 2 s. If it fails, try the next candidate. The request itself has a
   10 s deadline, so a suspended editor cannot hang an agent.

`SHOW_ME_EDITOR=<path to an entry file>` bypasses steps 1–3.

### Security

The registry and socket directories are private to the user (0700 / 0600 on POSIX,
`%LOCALAPPDATA%` on Windows). Neovim's server is its built-in, unauthenticated one;
show-me does not widen who can reach it. The VS Code server requires the per-launch
`token` from its entry on every request, because a Windows named pipe is not protected
by a private directory.

## Protocol

Full text lives in `protocol/PROTOCOL.md`; this is its outline. Protocol version is
`1`. Every request carries `protocol`; an editor that does not speak it replies with
`unsupported protocol`.

### Requests and replies

```go
type Request struct {
    Protocol int    `json:"protocol"`
    Token    string `json:"token,omitempty"`
    Command  string `json:"command"` // "deck" | "view" | "done" | "status"
    Title    string `json:"title,omitempty"`
    Deck     int    `json:"deck,omitempty"`
    View     *View  `json:"view,omitempty"`
}

type View struct {
    Layout string `json:"layout"` // "single" | "cols2" | "cols3" | "main-stack"
    Title  string `json:"title,omitempty"`
    Panes  []Pane `json:"panes"`
}

type Pane struct {
    Path  string `json:"path"`            // absolute, cleaned
    First int    `json:"first,omitempty"` // 1-based
    Last  int    `json:"last,omitempty"`  // 1-based, inclusive
}

type Reply struct {
    OK     bool            `json:"ok"`
    Error  string          `json:"error,omitempty"`
    Result json.RawMessage `json:"result,omitempty"`
}
```

| Command | Result |
|---|---|
| `deck` | `{"deck": 7}` |
| `view` | `{"view": 2}` |
| `done` | `{"deck": 7, "views": 3, "open_hint": "<leader>v1"}` |
| `status` | `{"editor": "nvim", "workspace_folders": […], "current": {"deck": 7, "title": "…", "views": 3} \| null}` |

Transport framing:

- **`nvim`:** the CLI calls `nvim_exec_lua("return require('show_me.rpc').handle(...)", [request_json])`
  and receives the reply JSON as a string. No `luaeval` quoting.
- **`ndjson`:** one JSON request line, one JSON reply line, then the connection closes.

### CLI surface

```
show-me deck <title>                                         → deck <n>@<pid>
show-me view <deck> <layout> [--title T] [--] <pane>...      → view <n>
show-me done <deck>                                          → done <n>@<pid>
                                                               open: <open_hint>
show-me status                                               → editor, workspace, current deck
show-me editors                                              → every registry entry, marking the one that would be chosen
show-me version                                              → CLI version and protocol version
```

`--` ends options, so a pane path starting with `-` works.

**Deck handles.** `deck` prints `<n>@<pid>`: the deck number and the pid of the editor
holding it. `view` and `done` given a handle go straight to that editor's registry
entry (exit 3 if it has exited), so a deck can't drift to another editor when the user
switches focus between two editors in the same folder mid-deck. A bare `<n>` is also
accepted and routed by the normal choice rules. Agents copy the handle verbatim; they
cite views, never decks, in prose.

**Exit codes:** `0` ok · `1` rejected (reason on stderr) · `2` usage error, including an
unknown subcommand · `3` no reachable editor (stderr lists what was tried) · `4` editors
found, but none speaks this CLI's protocol version (stderr says which side to update).

### Pane syntax and validation (CLI)

`<pane>` is `path`, `path:N`, or `path:N-M`. The range is taken from the **right**,
never by splitting on the first colon:

1. If the spec matches `^(.*):([0-9-]+)$` and the prefix is a readable file, the suffix
   is the range, parsed strictly (so `a.txt:1-2-3` is a malformed range).
2. Otherwise, if the whole spec is a readable file, it is the path with no range.
3. Otherwise, reject with `no readable file at <prefix if step 1 matched, else spec>`.

This keeps Windows drive letters (`C:\src\a.py:40-88`) and files whose names contain
colons working.

Relative paths resolve against the CLI's cwd; the result is absolute and cleaned, not
symlink-resolved. A file's line count follows editor convention: a trailing newline
does not start a new line, and an empty file has 0 lines.

Rejections and their exact text (exit 1). Wording carries over from the prototype,
where it existed:

| Check | Side | Message |
|---|---|---|
| Blank deck title | CLI | `a deck needs a title` |
| Unknown layout | CLI | `unknown layout "grid" (valid: single, cols2, cols3, main-stack)` |
| Pane count | CLI | `cols2 takes 2 panes, got 3` / `main-stack takes 3-4 panes, got 2` |
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
| Unsupported protocol | Editor | `unsupported protocol 2 (this editor speaks 1)` |
| Bad token | Editor (ndjson) | `bad token` |

## Editor responsibilities (both editors)

Every editor implements:

- **Registry entry** lifecycle as above.
- **Store:** decks as JSON, one file per deck, in a directory per workspace folder,
  keyed by the first 16 hex characters of `sha256(workspace folder)`. Monotonic ids
  starting at 1. Keep the newest 10 decks. At most 9 views per deck. `created_at` in
  epoch ms. A corrupt deck file is skipped (logged), never fatal.
- **Current deck:** the most recently `done` deck, or the one the user last picked.
  In memory; on restart it falls back to the newest done deck on disk.
- **Notification** on `done`, never moving focus: `show-me: <title> · 3 views · <open_hint>`.
- **Four layouts** with fixed geometry: `single`, `cols2`, `cols3`, `main-stack` (pane 1
  takes the left 60% of the space available, panes 2–4 stack on the right).
- **Pane rendering:** a real file editor (LSP, go-to-definition and edits keep
  working), scrolled so `first` is at the top, `first`–`last` highlighted, and a caption
  `n/N · <view title> · <relative path>:<range>`.
- **Navigation:** open view N, next/previous view, pick a recent deck, close.

## Neovim plugin

### Install and configure

```lua
{
  'chanceygardener/show-me',
  build = function(plugin) vim.system({ 'sh', plugin.dir .. '/install.sh', '--for-plugin', plugin.dir }):wait() end,
  event = 'VeryLazy',
  opts = {},
}
```

On Windows the build hook runs `install.ps1`. `--for-plugin` installs the CLI version
named in the checkout's `VERSION` file. If that release doesn't exist (a development
checkout) and `go` is on `PATH`, it builds from the checkout instead.

```lua
---@class ShowMeConfig
---@field keys ShowMeKeys|false        false: define no mappings (use <Plug> mappings)
---@field sidebar ShowMeSidebarConfig
---@field picker 'auto'|'snacks'|'select'  auto: snacks if loaded, else vim.ui.select

---@class ShowMeKeys
---@field view_prefix string  default '<leader>v'  (+1..9)
---@field next string         default ']v'
---@field prev string         default '[v'
---@field pick string         default '<leader>vd'
---@field close string        default '<leader>vq'

---@class ShowMeSidebarConfig
---@field filetypes string[]                 default { 'neo-tree', 'NvimTree' }
---@field open table<string, fun()>          per filetype; defaults open neo-tree and nvim-tree
```

`<Plug>(show-me-view-1)`…`9`, `<Plug>(show-me-next)`, `<Plug>(show-me-prev)`,
`<Plug>(show-me-pick)` and `<Plug>(show-me-close)` always exist. `open_hint` in the
registry is derived from the configured keys (`:ShowMe 1` when `keys = false`).
`:ShowMe [n]` and `:checkhealth show_me` work regardless.

### Changes from the prototype

- **Sidebars.** When the user's tab shows a window whose filetype is in
  `sidebar.filetypes`, the show-me tab opens the same sidebar on creation. Switching
  views closes only show-me's own panes, never a sidebar, and layouts are built in the
  space beside it with the sidebar's width fixed (`winfixwidth`) so equalising doesn't
  stretch it.
- **Sessions.** Neovim has no `SessionWritePre`, so a `SessionWritePost` autocmd closes the show-me tab and rewrites the session file (`:mksession!` on `v:this_session`). This replaces the auto-session-specific hook, so any session plugin built on `:mksession` is covered.
- **Picker.** `vim.ui.select` by default, so snacks is optional.
- **Transport.** No socket of its own; the registry points at `v:servername`.
- **Validation** moves to the CLI; `rpc.handle` trusts pane paths and ranges but still
  enforces the editor-side rejections.

## VS Code extension (phase 2)

- **Transport.** On activation, a Node `net` server on
  `<base>/sock/vscode-<pid>.sock` (POSIX) or `\\.\pipe\show-me-vscode-<pid>-<random>`
  (Windows), NDJSON framing, with a random 32-byte hex token in the registry entry.
- **Store.** Under `context.globalStorageUri`, same format and rules as Neovim.
- **Commands and keys.** `showMe.openView1`…`9`, `showMe.next`, `showMe.previous`,
  `showMe.pickDeck`, `showMe.close`. Default keybindings are chords mirroring the Neovim
  prefix: `ctrl+alt+v 1`…`9`, `ctrl+alt+v ]`, `ctrl+alt+v [`, `ctrl+alt+v d`,
  `ctrl+alt+v q`.
- **Notification.** `showInformationMessage` with an "Open view 1" button.
- **Layouts.** `vscode.setEditorLayout`; files opened with `showTextDocument` into
  specific groups; ranges highlighted with a `TextEditorDecorationType` (themeable
  colour `showMe.rangeBackground`); caption in a status-bar item while a view is shown.
- **`showMe.openIn`** (`resource` scope): `currentWindow` (default) in phase 2;
  `newWindow` and `ask` only if the spike succeeds.

### `currentWindow`: lay over, never close the user's tabs

Closing a tab with unsaved changes opens a save dialog, so the user's tabs are never
closed.

1. **Snapshot** the layout (`vscode.getEditorLayout`) and each group's active tab.
2. **Show** the view: apply its layout, open each pane as the active tab of its group.
   Record which tabs show-me *created*. A pane whose file the user already had open in
   that group reuses that tab and is recorded as *borrowed*.
3. **Switch** views by closing created tabs, removing decorations from borrowed ones,
   and repeating step 2.
4. **Close** by doing the same, then restoring the snapshot's layout and active tabs,
   but only if the set of groups still matches it. Otherwise only show-me's tabs go.
5. **Never shrink.** When a view needs fewer groups than the user has, the extra groups
   are left as they are and the view fills the first N.

### Floating-window spike (phase 3)

Half a day. Question: can the extension, using only commands and API, create a floating
editor window, apply a layout inside it, and open documents into its groups reliably
over 20 consecutive view switches, on macOS and Windows? Yes → implement `newWindow`
and `ask`. No → record what failed in `vscode/NOTES.md`; the setting keeps one value.

## Installer

`install.sh` (POSIX sh) and `install.ps1`, published as release assets:

```sh
curl -fsSL https://github.com/chanceygardener/show-me/releases/latest/download/install.sh | sh
```
```powershell
irm https://github.com/chanceygardener/show-me/releases/latest/download/install.ps1 | iex
```

Steps:

1. Detect OS and architecture (darwin/linux/windows × amd64/arm64).
2. Download the archive and `checksums.txt` for the requested version (default:
   latest), verify SHA-256, and stop on mismatch.
3. Install to `<base>/bin/show-me[.exe]`. On Windows, run `Unblock-File` on it in case
   the download was marked.
4. Link (POSIX) or copy (Windows) it into `~/.local/bin` when that directory is on
   `PATH`; otherwise print the line to add.
5. Install the skill into `~/.claude/skills/show-me`, `~/.codex/skills/show-me` and
   `~/.cursor/skills/show-me`, by symlink on POSIX and by copy on Windows, skipping an
   agent whose home directory doesn't exist.

Flags: `--version <tag>`, `--for-plugin <dir>`, `--no-skill`, `--bin-dir <dir>` (where the `PATH` link goes; default `~/.local/bin`).
Re-running is safe and upgrades in place.

macOS signing: Go's linker ad-hoc signs arm64 binaries, and `curl` does not set the
quarantine attribute, so the binary runs without a Gatekeeper prompt. Release pages tell
users to install with the script, not by downloading from a browser.

## Agent skill

`skills/show-me/SKILL.md` is the prototype's skill made editor-neutral:

- Tells the agent to run `show-me`, falling back to `<base>/bin/show-me` when it isn't
  on `PATH` (both paths spelled out per OS).
- Tells the agent to open its answer with the `open:` line printed by `done`, so the
  user sees their own editor's keys.
- Error table gains exit 4: tell the user to update the CLI or the editor plugin, and
  continue without views.
- Sandbox guidance unchanged: on exit 3 while sandboxed, ask the user to approve
  running `show-me` outside the sandbox.

## Releases and CI

- **CI** (`.github/workflows/ci.yml`), on `ubuntu-latest`, `macos-latest` and
  `windows-latest`: `go test ./...`, the Neovim specs against stable Neovim, the
  conformance suite against Neovim, `shellcheck install.sh`, and (phase 2) the
  extension's tests.
- **Release** (`.github/workflows/release.yml`), on a `v*` tag: goreleaser builds six
  binaries, archives and `checksums.txt`, and attaches `install.sh` and `install.ps1`.
  `VERSION` in the repository must equal the tag.
- **Compatibility rule:** a protocol change bumps `protocol` and both editors in the
  same release. The CLI speaks exactly one protocol version.

## Migration from kickstart.nvim

After phase 1 ships, in the kickstart.nvim repository:

1. Add the plugin spec, pointing at `dir = '~/repos/show-me'` while developing.
2. Delete `lua/custom/show_me/`, `skills/show-me-nvim/`, `test/spec/show_me_*`, the
   `setup()` call and `<leader>v` mappings in `init.lua`, the auto-session
   `pre_save_cmds` entry, and the README and CHEATSHEET sections, replacing the latter
   with a pointer to the plugin.
3. Re-run the installer so the skill symlinks point into the new repository.

## Phases

1. **Core and Neovim.** Repository skeleton, Go CLI, protocol document (schema in
   phase 2), registry, Neovim plugin port with the sidebar and session changes, skill,
   installers, CI on three OSes, first release. Then the kickstart.nvim migration.
2. **VS Code, `currentWindow`.** Extension, generated TypeScript types, conformance
   suite run against it, Marketplace and Open VSX publishing.
3. **Floating-window spike**, then `newWindow` and `ask` if it succeeds.

## Testing

**Go unit tests**
- Pane parsing: every rejection above, drive letters (`C:\a.py:3-4`), a filename that
  contains a colon, `--` with a leading-dash path, CRLF files, a missing trailing
  newline, an empty file.
- Editor choice: longest workspace match, `focused_at` tiebreak, cwd before main
  checkout, dead pid cleanup, protocol mismatch → exit 4, case-insensitive matching on
  macOS and Windows.
- Base directory per OS and `SHOW_ME_HOME`.
- Argument parsing and exit codes, including unknown subcommand → 2.

**Neovim specs** (`nvim -l`, no plugin manager)
- Store: editor-side rejections, id monotonicity, pruning to 10, persistence, current
  deck, a corrupt deck file is skipped.
- Layouts: tree shape and pane order for all four, with and without a sidebar;
  `cols3` beside a sidebar splits the remaining width evenly; `splitright` and
  `splitbelow` don't change geometry.
- Render: a sidebar in the user's tab appears in the show-me tab; a sidebar survives
  `]v`; no sidebar in the user's tab means none in the show-me tab; past-EOF clamping.
- Registry: entry written on start, rewritten on `DirChanged`, removed on exit.
- Sessions: `:mksession` with the show-me tab open closes it first.

**Conformance** (`test/conformance/`, Go): starts headless Neovim with the plugin from
the checkout and a temporary `SHOW_ME_HOME`, then runs the built CLI for a full
deck → view → done session and every editor-side rejection, asserting stdout, stderr
and exit codes against `PROTOCOL.md`. Phase 2 adds a VS Code target driven through
`@vscode/test-electron`.

**Manual checks before the first release:** install via the one-liner on macOS (confirm
no Gatekeeper prompt and that an agent can run it), Ubuntu, and Windows (confirm no
SmartScreen prompt from PowerShell download).

## Documentation

- `README.md`: what it is, install one-liners, Neovim and VS Code setup, the
  agent-sandbox allowlist notes, and a "don't download from the browser" note.
- `protocol/PROTOCOL.md`: the contract above, in full.
- `doc/show-me.txt`: Vim help for options, commands, `<Plug>` mappings and highlights.
- `vscode/README.md`: Marketplace page (phase 2).
- `CONTRIBUTING.md`: how to add an editor (the checklist in [Editor
  responsibilities](#editor-responsibilities-both-editors) plus the conformance suite).

## Ownership

- GitHub: `chanceygardener/show-me`; Go module `github.com/chanceygardener/show-me`.
- License: MIT.

## Later

Claude Code plugin marketplace entry for the skill; Homebrew formula (not a cask, to
avoid quarantine); winget/Scoop; `show-me mcp` subcommand; Apple notarization; VS Code
Remote support; more editors (Zed, Helix, JetBrains) through `CONTRIBUTING.md`.
