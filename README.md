# show-me

Let terminal coding agents (Claude Code, Codex, Cursor, …) illustrate an
explanation in your editor. An agent builds a **deck** of numbered **views**:
up to four files side by side, scrolled to and highlighting the lines it means.
You open the views at your own pace while you read its answer. Nothing pops up
uninvited; you get a notification.

Works with Neovim 0.10+ and VS Code 1.90+ (and Cursor, VSCodium) on macOS, Linux and Windows.

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

### VS Code

Install **show-me** from the VS Code Marketplace (Cursor and VSCodium: from
Open VSX), then install the CLI and skill with the one-liner below, or accept
the "Run installer" prompt the extension shows. See
[`vscode/README.md`](vscode/README.md).

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

In VS Code:

| Keys | Action |
|---|---|
| `ctrl+alt+v 1`…`ctrl+alt+v 9` | Open view N of the current deck |
| `ctrl+alt+v ]` / `ctrl+alt+v [` | Next / previous view (while a view is open) |
| `ctrl+alt+v d` | Pick a recent deck |
| `ctrl+alt+v q` | Close the view (while a view is open) |

In Neovim, views open in their own tab. If your tab has neo-tree or nvim-tree open, the
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

Each editor registers itself in `$XDG_STATE_HOME/show-me/editors/`, which
defaults to `~/.local/state/show-me/editors/`. On Windows it is
`%LOCALAPPDATA%\show-me\editors\`. `SHOW_ME_HOME` overrides the base, making
the registry `$SHOW_ME_HOME/editors/`. The CLI picks the editor whose working
directory is closest to the agent's. Inside a git worktree, it also considers
the repository's main checkout. So an agent anywhere under `~/repos` reaches a
Neovim started in `~/repos`. Run `show-me editors` to see what's registered.
The full contract is in [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md).

## License

MIT
