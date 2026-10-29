# Contributing

## Setup

You need Go (the version in `go.mod`), Neovim 0.10+ and git. For the VS Code
extension you also need Node 24 and npm (`cd vscode && npm ci`).

```sh
go test ./...                  # unit tests, plus the conformance suite against Neovim
./test/nvim/run.sh             # Neovim specs (nvim --clean -l)
./test/install/install_test.sh # installer against a fake local release
cd vscode && npm test          # extension unit tests
cd vscode && npm run test:integration  # extension tests inside a real VS Code
npm --prefix vscode run build  # needed before the conformance suite runs VS Code
SHOW_ME_CONFORMANCE_EDITORS=nvim,vscode go test ./test/conformance
```

`npm run test:integration` downloads VS Code and runs the stable build unless
`SHOW_ME_VSCODE_VERSION` names another (CI also runs it with
`SHOW_ME_VSCODE_VERSION=1.90.0`, the supported floor). The conformance suite
tests only the editors in `SHOW_ME_CONFORMANCE_EDITORS` (default `nvim`).

The protocol types are generated. After changing `internal/protocol`, run
`go generate ./internal/protocol && npm --prefix vscode run gen`; CI fails if the
generated files are stale.

## Adding an editor

An editor port stores decks and renders them. The CLI already checks
everything stateless. To add one:

1. Implement everything in "What every editor does" in
   [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md).
2. Write the registry entry on start, rewrite it when the workspace changes,
   update `focused_at` on focus, and delete it on exit.
3. Serve a transport the CLI speaks, or add one to `internal/transport`.
   The protocol types are generated: run `go generate ./internal/protocol`,
   then generate your language's types from `protocol/schema.json`.
4. Add a conformance driver in `test/conformance/<editor>_test.go`, implementing
   `prepare`, `start`, `focus` and `kill`, and register it in `drivers`. Make
   the whole suite pass.
5. Add a CI job that runs the suite with `SHOW_ME_CONFORMANCE_EDITORS=<editor>`.

## Releasing

1. Bump `VERSION` and `vscode/package.json`'s `version` to match; protocol changes also bump `protocol.Version` and every
   editor's protocol constant in the same commit.
2. Tag `v$(cat VERSION)` and push the tag; `.github/workflows/release.yml` runs
   goreleaser.
