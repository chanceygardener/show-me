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
