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
- Windows, PowerShell: `$env:LOCALAPPDATA\show-me\bin\show-me.exe`
- Windows, Git Bash: `"$LOCALAPPDATA/show-me/bin/show-me.exe"`

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
   editor: `<leader>v1`"; VS Code prints `ctrl+alt+v 1`). Then cite views by
   number and pane position:
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
