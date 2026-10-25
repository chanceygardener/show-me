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

`SHOW_ME_EDITOR=<path to an entry file>` bypasses steps 1–3.

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
  `show-me: <title> · <n> view(s) · <open_hint>`, with `view` singular for one
  view.
- Renders the four layouts. Each pane is a real file editor, scrolled so
  `first` is at the top, with `first`–`last` highlighted, and captioned
  `n/N · <view title or deck title> · <relative path>:<range>`.
- Lets the user open a view by number, step to the next or previous view, pick
  a recent deck, and close.
