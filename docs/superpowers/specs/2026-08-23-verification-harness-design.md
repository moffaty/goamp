# Verification Harness — Design

**Date:** 2026-08-23
**Status:** approved design, not yet implemented

## Problem

GOAMP has 538 automated checks — 51 vitest files, 111 Rust tests, and the Go
package suites — and not one of them runs the real application. The frontend is
tested entirely against `MockTransport` in jsdom; the Rust side is tested against
in-memory SQLite with commands called directly as functions. `src/main.ts`, which
wires the whole app together, is explicitly excluded from coverage and is executed
by nothing.

So a broken Tauri command signature, a command dropped from `invoke_handler`, a
frontend that renders a blank window, or a dead panel all pass `make check` green.
The only end-to-end check in the repo is `scripts/e2e-node.sh`, which curls
`/health` on the sidecar.

## Goals

Catch the class of failure that currently escapes every check: broken IPC wiring,
a UI that does not render or does not respond, and recommender behaviour that
silently stops working.

## Non-goals

This harness does not, and cannot, guarantee the project works 100%. External
services (YouTube, yt-dlp), the P2P network, and OS-level audio are not
deterministic and are not owned by this repo. The harness raises confidence
sharply; it does not prove correctness. Any claim to the contrary in a report is
a bug in the report.

## Architecture

Three layers. The first two form the gate and run offline; the third is manual.

### L1 — IPC contract (Rust)

Unit tests inside the crate, using `tauri::test::mock_builder` with the real
`invoke_handler` and a real SQLite database in a temp file. Commands are invoked
through the actual IPC path via `get_ipc_response`, not called as plain functions,
so registration and argument/return shapes are exercised for real.

Placement is inside `src-tauri/src/` rather than `src-tauri/tests/`, because the
crate's modules are private and `db::test_db()` is `#[cfg(test)]` — an integration
test crate cannot reach either.

Of the 102 registered commands, 49 touch the network or external binaries. Those
are checked for registration only. The rest are invoked for real against the temp
database.

The app context comes from `mock_context(noop_assets())`, so the tests do not
require a built `dist/`.

A completeness test compares the `generate_handler!` list against every
`#[tauri::command]` in the source tree, so a new command cannot be added without
either registering it or explicitly exempting it. (Checked at design time: the two
sets currently match.)

L1 also writes each invoked command's response to `src-tauri/tests/golden/ipc/`.

### L2 — UI over the real bundle (Playwright)

Playwright drives the real vite bundle in headless Chromium. A vite alias replaces
`@tauri-apps/*` with a shim, so no production code changes: `TauriTransport` keeps
importing `invoke` as it does today, and the shim routes it to the golden files
that L1 produced. The UI is therefore exercised against data that provably came
from the real backend, and drift is caught in L1 when golden is regenerated.

The shim covers exactly the symbols `src/` imports today — `invoke`,
`convertFileSrc`, `getCurrentWindow`, `getCurrentWebviewWindow`, `listen`,
`open` (dialog), `openUrl` (opener), `check` (updater). A guard test compares the
shim's exports against every `@tauri-apps` import found in `src/`, so a new import
fails loudly instead of breaking e2e silently.

Chromium runs with `--autoplay-policy=no-user-gesture-required`; without it the
playback scenario cannot start.

### L3 — the real binary (manual)

The built Tauri binary driven end to end, with a real window, real tray, real
WebKitGTK webview, and real network. Run before a release, never in the gate.

L3 needs tooling that is not installed on this machine: `tauri-driver`
(via cargo) and `WebKitWebDriver` (via `sudo apt install webkit2gtk-driver`).
WSLg provides `DISPLAY=:0`, so a virtual framebuffer is not needed locally; CI
would need `xvfb`. The harness must detect the missing tooling and skip with a
clear message rather than fail.

## Scenarios

1. **Cold start and IPC integrity.** L1: every offline command invoked through the
   real handler, responses deserialized into their declared types; registration
   completeness enforced. L2: bundle loads, `#app` is non-empty, the Webamp window
   renders, no error overlay, no console errors.
2. **Local file playback.** A fixture wav. `scan_directory` served from golden;
   `convertFileSrc` shimmed to `/fixtures/`. Track appears in the playlist, play
   moves status to PLAYING, position advances between two samples, pause freezes
   it, stop resets it.
3. **Panels and retro windows.** Right-click exposes Charts and Peers. Charts opens
   and shows "Your Top Tracks". The panel drags (coordinates change), collapses to
   its titlebar and expands, and its position survives a reload.
4. **History and charts through the layers.** L1 records a listen through the real
   command into real SQLite and asserts `get_top_tracks_cmd` returns it first —
   the UI-Rust-SQLite path proven from the data side. L2 asserts the panel renders
   rank, title, artist and count from that same golden.
5. **Recommendations and autoplay.** L1: seed history, send a dislike via
   `record_track_signal`, assert `get_hybrid_recommendations` no longer returns
   that track; a like raises the track and its neighbours; empty history still
   yields a non-empty `get_coldstart_recommendations`; a mood channel produces a
   queue and `record_mood_play` moves the centroid predictably. L2: the autoplay
   queue refills on track change, a disliked track never appears, and `L`/`D`/`N`
   send the expected signal. The YouTube Mix cold-start path needs the network and
   belongs to L3.

## Determinism

The gate must fail only because of code.

- **Time.** Chart periods are computed from `Utc::now()`, so history fixtures use
  offsets from now (`now - 1h`, `now - 20d`), never absolute dates.
- **Randomness.** The recommender shuffles. L1 asserts invariants — the disliked
  track is absent, the liked one present, length within bounds — not exact order.
  Where order matters, the seed is fixed.
- **Network.** Absent from the gate entirely. The updater already goes through the
  shimmed Tauri plugin. Analytics does not: `initAnalytics()` calls `initAptabase`
  unconditionally with a hard-coded key, so `@aptabase/web` (and `@sentry/browser`,
  whose DSN is normally unset) are aliased to no-ops in the e2e vite config too —
  test-side only, still no production change. Any attempted network call during L2
  fails the test rather than hanging.
- **State.** L1 gets a fresh temp database per run; L2 starts with empty
  `localStorage`. Nothing is shared between tests.
- **Golden.** Regenerated only by `make verify-golden`, by hand. CI never
  regenerates: a mismatch is a red test with a diff, never a silent re-blessing.

## Failure criteria

Any of: a failed assertion; a console error; an unhandled promise rejection; the
error overlay appearing; a panic in the Rust log; an attempted network call in L2;
golden disagreeing with the backend's real response.

## Interface

```
make verify        # L1 + L2 — the gate, folded into make check
make verify-ipc    # L1 only
make verify-ui     # L2 only
make verify-golden # regenerate golden, by hand
make verify-deep   # L3, by hand before a release
```

`check` becomes `lint lint-rust test test-rust verify build-check`.

Artifacts land in `e2e/artifacts/<timestamp>/`: a screenshot per screen, a console
dump, and a Playwright trace on failure. CI uploads them via `upload-artifact`.

## Changes to production code

One: `src-tauri/src/lib.rs` extracts its `invoke_handler` and state registration
into `build_app<R: Runtime>(Builder<R>) -> Builder<R>`, which `run()` then uses.
Plugins stay in `run()` — the mock runtime should not have to initialise the
updater, dialog, fs and shell plugins.

L2 requires no production change at all; the vite alias intercepts the Tauri API
below `TauriTransport`, and analytics is neutralised the same way.

## Dependencies

- `tauri = { version = "2", features = ["test"] }` in `[dev-dependencies]`.
- `@playwright/test` in devDependencies, plus `playwright install chromium`.

Neither has an in-repo substitute: `tauri::test` is the only way to reach the real
IPC path, and the project ships no browser driver.

## Budget

L1 runs in seconds on top of an already-built crate. L2 targets under a minute. If
L2 exceeds roughly two minutes, scenarios get cut rather than tolerated — a gate
that turns `make check` into a coffee break stops being run.

## Risks

- **Shim drift.** L2's Tauri shim can diverge from real Tauri behaviour. Mitigated
  by the export-coverage guard, by L1 owning backend truth, and by L3 covering the
  whole stack.
- **Engine gap.** The gate runs Chromium; the product ships WebKitGTK on Linux and
  WebView2 on Windows. A rendering bug specific to those engines is only reachable
  from L3.
- **L3 tooling.** `tauri-driver`'s Tauri v2 support is young. L3 is deliberately
  outside the gate so its instability cannot block development.
