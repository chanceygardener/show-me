# show-me

Lets terminal coding agents (Claude Code, Codex, Cursor, …) illustrate an
explanation in VS Code. An agent builds a deck of numbered views, each showing
up to four files side by side, scrolled to and highlighting the lines it means.
You open the views at your own pace while you read its answer.

## Install

1. Install this extension: from the Marketplace, or from Open VSX for Cursor and VSCodium.
2. Install the `show-me` CLI and the agent skill. Accept the extension's
   "Run installer" prompt, or run the one-liner yourself:

   ```sh
   curl -fsSL https://github.com/chanceygardener/show-me/releases/latest/download/install.sh | sh
   ```

   ```powershell
   irm https://github.com/chanceygardener/show-me/releases/latest/download/install.ps1 | iex
   ```

Don't download the CLI from the Releases page in a browser: macOS Gatekeeper and
Windows SmartScreen quarantine it, because the binaries aren't notarized.

## Use

Ask an agent to explain or show you something in the folder open in VS Code.
When its views are ready you get a notification.

| Keys | Action |
|---|---|
| `ctrl+alt+v 1`…`ctrl+alt+v 9` | Open view N of the current deck |
| `ctrl+alt+v ]` / `ctrl+alt+v [` | Next / previous view (while a view is open) |
| `ctrl+alt+v d` | Pick a recent deck |
| `ctrl+alt+v q` | Close the view (while a view is open) |

Each is also a command: `showMe.openView1`…`showMe.openView9`, `showMe.next`,
`showMe.previous`, `showMe.pickDeck` and `showMe.close`.

Views lay over your current editor groups. show-me never closes your tabs,
including ones with unsaved changes, and puts your layout back when you close
the view (unless you reshaped the window meanwhile).

With VS Code's default sticky scroll on, a view's range is revealed below the
sticky-scroll lines (up to 5 lines from the top), not on the literal top line.
That is VS Code's own reveal behaviour.

## Settings

- `showMe.openIn`: where views open. Only `currentWindow` exists for now.

## Colours

- `showMe.rangeBackground`: background of the highlighted lines. It defaults to
  `editor.rangeHighlightBackground`. Override it under `workbench.colorCustomizations`.

## Multi-root workspaces

New decks go to the first folder. `show-me status` and the registry list every folder.

## Remote, WSL and dev containers

Not supported yet. The extension declares `extensionKind: ["workspace"]`, so a
Remote window registers on the remote machine, next to the CLI an agent would
run there. That is untested.

## Cursor and VSCodium

Install from Open VSX.

## Requirements and known limitation

show-me needs VS Code 1.90 or later. On VS Code before 1.126, including current
Cursor, show-me tells editor groups apart by their creation order. That is
undocumented VS Code behaviour, which CI tests on 1.90. If it ever changed,
show-me would leave tabs open rather than close the wrong one.

## Troubleshooting

Run `show-me editors` in a terminal to see which editors are registered.
