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
# shellcheck disable=SC2034 # before and status are read inside check's eval
before=$(cksum <"$home/state/bin/show-me")
status=0
# shellcheck disable=SC2034
install >/dev/null 2>"$work/err" || status=$?
check "a checksum mismatch fails" '[ "$status" -ne 0 ] && grep -q "checksum mismatch" "$work/err"'
check "a checksum mismatch leaves the binary alone" '[ "$(cksum <"$home/state/bin/show-me")" = "$before" ]'

exit "$fail"
