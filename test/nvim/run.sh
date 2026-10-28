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
  basename "$spec"
  if ! nvim --clean -l "$spec"; then status=1; fi
done
if [ "$status" -eq 0 ]; then echo "all specs passed"; else echo "SPEC FAILURES"; fi
exit "$status"
