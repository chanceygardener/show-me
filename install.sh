#!/bin/sh
# Install the show-me CLI and its agent skill (macOS, Linux).
#
#   curl -fsSL https://github.com/chanceygardener/show-me/releases/latest/download/install.sh | sh
#   sh install.sh [--version vX.Y.Z] [--for-plugin DIR] [--no-skill] [--bin-dir DIR]
#
# The binary goes to <base>/bin/show-me, where <base> is $SHOW_ME_HOME or
# ${XDG_STATE_HOME:-~/.local/state}/show-me, and is linked into --bin-dir
# (default ~/.local/bin). Downloads use curl, which never sets macOS's
# quarantine attribute, so Gatekeeper doesn't prompt. --for-plugin installs
# the version in that checkout's VERSION file, building it with go when no
# such release exists. Re-running upgrades in place.
set -eu

releases="${SHOW_ME_RELEASE_URL:-https://github.com/chanceygardener/show-me/releases}"
version=latest
plugin_dir=
skill=1
bin_dir="$HOME/.local/bin"

say() { printf 'show-me: %s\n' "$*"; }
die() {
  printf 'show-me: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
  --version)
    [ $# -ge 2 ] || die "--version needs a value"
    version=$2
    shift 2
    ;;
  --for-plugin)
    [ $# -ge 2 ] || die "--for-plugin needs a directory"
    plugin_dir=$2
    shift 2
    ;;
  --no-skill)
    skill=0
    shift
    ;;
  --bin-dir)
    [ $# -ge 2 ] || die "--bin-dir needs a directory"
    bin_dir=$2
    shift 2
    ;;
  -h | --help)
    echo "usage: install.sh [--version vX.Y.Z] [--for-plugin DIR] [--no-skill] [--bin-dir DIR]"
    exit 0
    ;;
  *) die "unknown option $1" ;;
  esac
done

base="${SHOW_ME_HOME:-${XDG_STATE_HOME:-$HOME/.local/state}/show-me}"

case "$(uname -s)" in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) die "unsupported OS $(uname -s); on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch=amd64 ;;
arm64 | aarch64) arch=arm64 ;;
*) die "unsupported CPU $(uname -m)" ;;
esac
asset="show-me_${os}_${arch}.tar.gz"

if [ -n "$plugin_dir" ]; then
  plugin_dir=$(cd "$plugin_dir" && pwd -P)
  version="v$(tr -d ' \n' <"$plugin_dir/VERSION")"
fi

url() {
  if [ "$version" = latest ]; then
    echo "$releases/latest/download/$1"
  else
    echo "$releases/download/$version/$1"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

fetch_release() {
  curl -fsSL "$(url "$asset")" -o "$tmp/$asset" 2>/dev/null || return 1
  curl -fsSL "$(url checksums.txt)" -o "$tmp/checksums.txt" || die "downloaded $asset but not checksums.txt"
  expected=$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/checksums.txt")
  [ -n "$expected" ] || die "checksums.txt has no entry for $asset"
  actual=$(sha256 "$tmp/$asset")
  [ "$expected" = "$actual" ] || die "checksum mismatch for $asset (expected $expected, got $actual); nothing was installed"
  mkdir -p "$tmp/release"
  tar -xzf "$tmp/$asset" -C "$tmp/release"
}

build_from_checkout() {
  [ -n "$plugin_dir" ] && command -v go >/dev/null 2>&1 || return 1
  say "no $version release found; building from $plugin_dir"
  mkdir -p "$tmp/release"
  (cd "$plugin_dir" && go build -ldflags "-X main.version=${version#v}-dev" -o "$tmp/release/show-me" ./cmd/show-me)
}

if fetch_release; then
  say "downloaded $version ($asset)"
elif build_from_checkout; then
  :
else
  die "could not download $(url "$asset")"
fi

mkdir -p "$base/bin"
chmod 700 "$base" 2>/dev/null || true
cp "$tmp/release/show-me" "$base/bin/show-me.new"
chmod 755 "$base/bin/show-me.new"
mv -f "$base/bin/show-me.new" "$base/bin/show-me"
say "installed $base/bin/show-me"

mkdir -p "$bin_dir"
ln -sf "$base/bin/show-me" "$bin_dir/show-me"
case ":$PATH:" in
*":$bin_dir:"*) say "linked $bin_dir/show-me" ;;
*) say "linked $bin_dir/show-me; add it to PATH: export PATH=\"$bin_dir:\$PATH\"" ;;
esac

[ "$skill" = 1 ] || exit 0
if [ -n "$plugin_dir" ]; then
  skill_src="$plugin_dir/skills/show-me"
else
  rm -rf "$base/skill"
  mkdir -p "$base/skill"
  cp -R "$tmp/release/skills/show-me/." "$base/skill/"
  skill_src="$base/skill"
fi
for agent in .claude .codex .cursor; do
  agent_home="$HOME/$agent"
  [ -d "$agent_home" ] || continue
  target="$agent_home/skills/show-me"
  if [ -d "$target" ] && [ ! -L "$target" ]; then
    say "skipped $target: a real directory is there; remove it to let show-me manage it"
    continue
  fi
  mkdir -p "$agent_home/skills"
  ln -sfn "$skill_src" "$target"
  say "linked $target"
done
