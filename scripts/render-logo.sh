#!/usr/bin/env bash
# Renders assets/brand/*.svg to PNG with headless Chrome (macOS). Usage: scripts/render-logo.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BRAND="$ROOT/assets/brand"
TMP="$(mktemp -d)"
render() { # svg  size  out  [transparent]
  local svg="$1" size="$2" out="$3" bg="${4:-}"
  printf '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx}</style><img src="file://%s">' \
    "$size" "$size" "$BRAND/$svg" > "$TMP/page.html"
  local bgflag="--default-background-color=ffffffff"
  [ -n "$bg" ] && bgflag="--default-background-color=00000000"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    "$bgflag" --window-size="$size,$size" --screenshot="$BRAND/$out" "file://$TMP/page.html" >/dev/null 2>&1
  echo "  $out (${size}px)"
}
render icon-square.svg 1024 icon-1024.png
render icon-square.svg 512  icon-512.png
render logo-rounded.svg 1024 logo-rounded-1024.png transparent
render logo-round.svg 1024 logo-round-1024.png transparent
render adaptive-foreground.svg 1024 adaptive-foreground-1024.png transparent
render adaptive-background.svg 1024 adaptive-background-1024.png
rm -rf "$TMP"
