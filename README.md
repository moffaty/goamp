# GOAMP

Winamp-style desktop music player powered by [Webamp](https://webamp.org) +
[Tauri](https://tauri.app) + a Go P2P sidecar. Streams YouTube, scans local
files, learns your taste, and pretends it's 1999.

![Tauri](https://img.shields.io/badge/tauri-v2-blue) ![CI](https://github.com/nicify/goamp/actions/workflows/ci.yml/badge.svg)

## Features

- **Winamp UI** — the real thing, via the Webamp library
- **YouTube streaming** — `goampaudio://` protocol streams via yt-dlp,
  caches in the background for instant replay
- **Infinite autoplay** — pick a track, get 20 similar instantly. Mix of
  GOAMP's own recommender (collaborative + content over your history) and
  the YouTube Mix (cold-start)
- **Per-track feedback** — `L` like, `D` dislike, `N` normal. Backed by
  `track_signals` so the mood engine learns
- **Local files** — scans folders, reads tags
- **Album import** — paste an album/set/playlist URL, get a playable tracklist
- **Charts** — "Your Top Tracks" over week / month / all time, plus a Community
  tab that sums in the taste profiles gossiped from peers
- **Download to disk** — save a track as a real, human-named file in Downloads
  instead of leaving it in the opaque cache
- **Internet radio**, **playlists**, **scrobbling** (Last.fm / ListenBrainz)
- **P2P node** — Go-based libp2p sidecar for peer-based recommendations, taste
  gossip, and peer-to-peer transfer of downloaded track audio. Seeding is
  **off by default** and takes explicit consent; the archive stays within quota
- **Modular architecture** — sources, renderers, features all plug in via
  `IFeature` / `ISource` / `IRenderer` interfaces

## Install

Grab a build for your OS from
[Releases](https://github.com/nicify/goamp/releases/latest):

- Windows — `.msi` or `.exe`
- macOS — `.dmg` (Apple Silicon)
- Linux — `.deb` / `.AppImage`

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `L` | Like the playing track (positive autoplay signal) |
| `D` | Dislike — this track will never come back in autoplay |
| `N` | Normal — mark as rated, no opinion |
| `Ctrl+Y` | YouTube search |
| `Ctrl+O` | Open folder |
| `Ctrl+Shift+O` | Open files |
| `Ctrl+P` | Playlists |
| `Ctrl+R` | Internet radio |
| `Ctrl+G` | Genres |
| `Ctrl+V` | Visualizer (Butterchurn) |
| `V` | Visualizer presets |

Right-click anywhere on Webamp for the full menu (Pin on Top, To-Bottom,
Autoplay, Charts, Peers, settings, etc.). Panels opened from that menu behave
like retro windows — draggable, remembered between runs, and collapsible to
their titlebar.

## Development

### Prerequisites

- Node 23 + pnpm 10
- Rust stable
- Go 1.25 (see `goamp-node/go.mod`)
- On Linux: `libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libgtk-3-dev librsvg2-dev`

### Setup

```bash
pnpm install
make dev          # hot-reload Tauri dev mode
```

### Build

```bash
make build        # current platform
make build-win    # cross-compile for Windows via cargo-xwin (Linux/WSL host)
```

`make build-win` copies all three binaries (`goamp.exe`, `goamp-node.exe`,
`yt-dlp.exe`) into `$(WIN_OUT)` and kills any running instances first.

### Quality

```bash
make check        # tsc + clippy + tests + vite bundle + Go tests
```

This is exactly what CI runs on every push. **Always passes locally before
opening a PR** — `pnpm build` was added because tsc alone does not catch
issues like top-level await on old bundler targets.

### Project layout

```
src/
  core/               IRenderer / ISource / IFeature, EventBus, GoampCore
  renderers/webamp/   Webamp wrapped as an IRenderer
  sources/            LocalSource, YouTubeSource (and friends)
  features/           autoplay/, scrobble/, history/, p2p/, ...
src-tauri/
  src/                Rust commands, db, audio_protocol, ...
goamp-node/           Go P2P sidecar (libp2p, mDNS, GossipSub)
```

## Optional env vars

| Var | Purpose |
|-----|---------|
| `GOAMP_SENTRY_DSN` | Sentry DSN. Set at *build* time to enable telemetry. Unset = no telemetry. |

## License

See `LICENSE`.
