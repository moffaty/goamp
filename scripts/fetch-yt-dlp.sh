#!/usr/bin/env bash
set -euo pipefail

version=2026.11.23
target=${1:?Usage: bash scripts/fetch-yt-dlp.sh TARGET}
case "$target" in
  x86_64-unknown-linux-gnu)
    asset=yt-dlp_linux
    digest=249ddb058234276bc449b9cd9492aad9f133bda5923c61a9e39983ae114ef17d
    ;;
  aarch64-apple-darwin)
    asset=yt-dlp_macos
    digest=57654854886d0398a798895aadf5173e2749fbb5e249b9f3728022ab376e11fb
    ;;
  x86_64-pc-windows-msvc)
    asset=yt-dlp.exe
    digest=622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c
    suffix=.exe
    ;;
  *)
    printf 'Unsupported target: %s\n' "$target" >&2
    exit 1
    ;;
esac

mkdir -p src-tauri/binaries
destination="src-tauri/binaries/yt-dlp-$target${suffix:-}"
download=$(mktemp "$destination.XXXXXX")
trap 'rm -f -- "$download"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  "https://github.com/yt-dlp/yt-dlp/releases/download/$version/$asset" \
  --output "$download"
if command -v sha256sum >/dev/null; then
  printf '%s  %s\n' "$digest" "$download" | sha256sum --check
else
  printf '%s  %s\n' "$digest" "$download" | shasum --algorithm 256 --check
fi
chmod +x "$download"
mv -f -- "$download" "$destination"
