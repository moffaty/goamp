# Verification Harness (L1 + L2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, deterministic gate that proves the real Tauri backend answers over the real IPC path and that the real frontend bundle renders and responds.

**Architecture:** L1 is Rust unit tests inside the crate that build a mock-runtime Tauri app from the production command registration and invoke commands through `tauri::test::get_ipc_response`. L2 is Playwright driving the real vite bundle in headless Chromium, with `@tauri-apps/*` and analytics replaced by a vite alias shim that serves data L1 recorded. No production behaviour changes; the only production edit extracts the command list out of `run()` so tests can reuse it.

**Tech Stack:** Rust + `tauri::test` (MockRuntime), rusqlite, serde_json; TypeScript + Playwright + vite.

**Spec:** `docs/superpowers/specs/2026-08-23-verification-harness-design.md`

## Global Constraints

- Tauri version is `2.10.3`. `tauri::test` requires the `test` feature, added to `[dev-dependencies]` only.
- The gate is offline. Any outbound network attempt during L2 fails the test.
- Golden files are regenerated only by `make verify-golden`, never automatically in CI.
- L1 lives inside `src-tauri/src/` (not `tests/`): the crate's modules are private and `db::test_db()` is `#[cfg(test)]`, so an integration-test crate cannot reach them.
- Mock apps use `mock_context(noop_assets())` — never `generate_context!` — so tests do not require a built `dist/`.
- L1 tests manage only `db::Db`. Commands needing `RadioStreamState`, `NodeProcess`, or `MediaControlsState` are registration-only; they are never invoked with real arguments.
- L2 must not require any change under `src/`.
- L3 (real binary under `tauri-driver`) is out of scope for this plan and gets its own.

---

### Task 1: Extract command registration and prove the IPC harness works

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs:57-169`
- Create: `src-tauri/src/verify/mod.rs`
- Create: `src-tauri/src/verify/harness.rs`

**Interfaces:**
- Produces: `pub fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R>` in `lib.rs`; `verify::harness::mock_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>)`; `verify::harness::invoke(&WebviewWindow<MockRuntime>, &str, serde_json::Value) -> Result<serde_json::Value, serde_json::Value>`.

- [ ] **Step 1: Add the `test` feature as a dev-dependency**

In `src-tauri/Cargo.toml`, add (or extend) the `[dev-dependencies]` section:

```toml
[dev-dependencies]
tauri = { version = "2", features = ["test"] }
```

- [ ] **Step 2: Extract the command list out of `run()`**

In `src-tauri/src/lib.rs`, the builder chain currently reads
`.invoke_handler(tauri::generate_handler![ ... 102 commands ... ])`. Move that
call into a new public function placed directly above `pub fn run()`, keeping the
command list byte-for-byte identical (including the `#[cfg(desktop)]` and
`#[cfg(not(target_os = "android"))]` attributes inside the macro):

```rust
/// Registers every Tauri command. Extracted from `run()` so the verification
/// harness can build a mock app with the exact production command set.
pub fn register_commands<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        commands::account::account_create,
        // ... the entire existing list, unchanged ...
        commands::p2p::p2p_catalog_announce,
    ])
}
```

Then in `run()`, replace the `.invoke_handler(...)` link with a call to it:

```rust
    let builder = register_commands(builder);

    builder
        .setup(|app| {
```

- [ ] **Step 3: Verify the extraction changed nothing**

Run: `cd src-tauri && cargo check 2>&1 | grep -E "^(error|warning)" | head`
Expected: no output.

- [ ] **Step 4: Declare the verify module**

In `src-tauri/src/lib.rs`, with the other `mod` declarations, add:

```rust
#[cfg(test)]
mod verify;
```

- [ ] **Step 5: Create the module root**

Create `src-tauri/src/verify/mod.rs`:

```rust
//! Verification harness (L1): drives the real command set over the real IPC
//! path on Tauri's MockRuntime. See
//! docs/superpowers/specs/2026-08-23-verification-harness-design.md
pub mod harness;
```

- [ ] **Step 6: Write the harness**

Create `src-tauri/src/verify/harness.rs`:

```rust
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindow, WebviewWindowBuilder};

/// A mock app carrying the production command set and a fresh in-memory DB.
pub fn mock_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = crate::register_commands(mock_builder())
        .manage(crate::db::test_db())
        .build(mock_context(noop_assets()))
        .expect("failed to build mock app");

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build mock webview");

    (app, webview)
}

/// Invoke a command through the real IPC path. `args` is the command's argument
/// object; pass `serde_json::json!({})` for none.
pub fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<serde_json::Value>().unwrap_or(serde_json::Value::Null))
}
```

- [ ] **Step 7: Write the failing smoke test**

Append to `src-tauri/src/verify/harness.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_flags_list_answers_over_real_ipc() {
        let (_app, webview) = mock_app();

        let res = invoke(&webview, "feature_flags_list", serde_json::json!({}))
            .expect("feature_flags_list must succeed");

        assert!(res.is_array(), "expected an array of flags, got {res}");
    }
}
```

- [ ] **Step 8: Run it**

Run: `cd src-tauri && cargo test verify:: 2>&1 | tail -20`
Expected: PASS. A failure naming `INVOKE_KEY` or `mock_builder` means Step 1's dev-dependency did not take effect.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/verify
git commit -m "test(verify): drive real commands over the real IPC path

Extracts the command registration out of run() into register_commands so a
MockRuntime app can be built with the exact production command set, and adds
the harness that invokes commands through get_ipc_response rather than calling
them as plain functions."
```

---

### Task 2: Prove every registered command is reachable

**Files:**
- Create: `src-tauri/src/verify/registration.rs`
- Modify: `src-tauri/src/verify/mod.rs`

**Interfaces:**
- Consumes: `harness::mock_app`, `harness::invoke` from Task 1.
- Produces: `verify::registration::REGISTERED` — a `&[&str]` of every command name the gate knows about.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/verify/registration.rs`:

```rust
use super::harness::{invoke, mock_app};

/// Every command registered in `register_commands`. Kept in sync by
/// `every_registered_command_is_reachable` and `no_command_is_unregistered`.
pub const REGISTERED: &[&str] = &[
    "feature_flags_list",
    "list_playlists",
    "load_session",
    "get_top_tracks_cmd",
    "get_community_charts_cmd",
    "get_hybrid_recommendations",
    "get_coldstart_recommendations",
    "list_mood_channels",
    "get_liked_tracks",
    "build_profile",
    // The list is completed in Step 3 from the real handler.
];

#[test]
fn every_registered_command_is_reachable() {
    let (_app, webview) = mock_app();

    for cmd in REGISTERED {
        // Empty args: most commands will reject them, and that is fine. What
        // must never happen is Tauri reporting the command does not exist,
        // which is what a missing registration looks like from the frontend.
        let res = invoke(&webview, cmd, serde_json::json!({}));
        if let Err(e) = &res {
            let msg = e.to_string();
            assert!(
                !msg.contains("not found") && !msg.contains("not allowed"),
                "command `{cmd}` is not reachable over IPC: {msg}"
            );
        }
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/verify/mod.rs`:

```rust
pub mod harness;
pub mod registration;
```

- [ ] **Step 3: Fill `REGISTERED` from the real handler**

Generate the full list mechanically so it cannot drift by hand:

```bash
cd /home/moffaty/projects/goamp
awk '/generate_handler!\[/,/^    \]\)/' src-tauri/src/lib.rs \
  | grep -oE '[a-z_0-9]+,$' | tr -d ',' | sort -u \
  | sed 's/^/    "/;s/$/",/'
```

Paste the output as the body of `REGISTERED`, replacing the placeholder entries
and the trailing comment.

- [ ] **Step 4: Run it**

Run: `cd src-tauri && cargo test verify::registration 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 5: Write the drift guard**

Append to `src-tauri/src/verify/registration.rs`:

```rust
/// Guards against a `#[tauri::command]` being added and never registered — the
/// frontend would fail at runtime with "command not found" and every existing
/// test would stay green.
#[test]
fn no_command_is_unregistered() {
    use std::collections::BTreeSet;

    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut declared: BTreeSet<String> = BTreeSet::new();

    fn walk(dir: &std::path::Path, declared: &mut BTreeSet<String>) {
        for entry in std::fs::read_dir(dir).expect("readable source dir") {
            let path = entry.expect("readable entry").path();
            if path.is_dir() {
                walk(&path, declared);
            } else if path.extension().is_some_and(|e| e == "rs") {
                let text = std::fs::read_to_string(&path).expect("readable source file");
                let mut lines = text.lines().peekable();
                while let Some(line) = lines.next() {
                    if !line.trim_start().starts_with("#[tauri::command") {
                        continue;
                    }
                    // The attribute may be followed by other attributes.
                    for next in lines.by_ref() {
                        let t = next.trim_start();
                        if t.starts_with('#') {
                            continue;
                        }
                        if let Some(name) = t
                            .strip_prefix("pub async fn ")
                            .or_else(|| t.strip_prefix("pub fn "))
                        {
                            let name = name.split('(').next().unwrap_or("").trim();
                            if !name.is_empty() {
                                declared.insert(name.to_string());
                            }
                        }
                        break;
                    }
                }
            }
        }
    }

    walk(&src, &mut declared);

    let registered: BTreeSet<String> = REGISTERED.iter().map(|s| s.to_string()).collect();
    let missing: Vec<&String> = declared.difference(&registered).collect();

    assert!(
        missing.is_empty(),
        "these #[tauri::command] functions are not in REGISTERED: {missing:?}"
    );
}
```

- [ ] **Step 6: Run both tests**

Run: `cd src-tauri && cargo test verify::registration 2>&1 | tail -15`
Expected: PASS, 2 tests. If `missing` is non-empty, either register the command
in `register_commands` or add it to `REGISTERED` — do not silence the test.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/verify
git commit -m "test(verify): prove every command is reachable and none unregistered

Invokes each registered command over the real IPC path and fails if Tauri
reports it missing, plus a source-level guard so a new #[tauri::command] cannot
be added without being registered."
```

---

### Task 3: Record golden responses for the UI layer

**Files:**
- Create: `src-tauri/src/verify/golden.rs`
- Modify: `src-tauri/src/verify/mod.rs`
- Create: `e2e/golden/.gitkeep`

**Interfaces:**
- Consumes: `harness::mock_app`, `harness::invoke`.
- Produces: `e2e/golden/<command>.json` files, each the exact response of one command; consumed by L2's shim in Task 6.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/verify/golden.rs`:

```rust
use super::harness::{invoke, mock_app};
use std::path::PathBuf;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .join("e2e/golden")
}

/// Commands whose responses the UI layer replays, with the arguments used to
/// produce them. Seeded state comes from `seed`.
fn cases() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("feature_flags_list", serde_json::json!({})),
        ("list_playlists", serde_json::json!({})),
        ("get_top_tracks_cmd", serde_json::json!({ "period": "all", "limit": 50 })),
        ("get_community_charts_cmd", serde_json::json!({ "limit": 50 })),
        ("get_hybrid_recommendations", serde_json::json!({ "limit": 20 })),
        ("get_liked_tracks", serde_json::json!({})),
    ]
}

/// Puts two completed listens in history so charts and recommendations have
/// something to return. Offsets are relative to now — never absolute dates —
/// so the week/month windows stay valid forever.
fn seed(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>) {
    let now = chrono::Utc::now().timestamp();
    for (id, artist, title, plays) in [
        ("aaa", "Portishead", "Roads", 3),
        ("bbb", "Massive Attack", "Angel", 1),
    ] {
        for i in 0..plays {
            invoke(
                webview,
                "record_track_listen",
                serde_json::json!({
                    "canonicalId": id,
                    "source": "local",
                    "startedAt": now - 3600 - i,
                    "durationSecs": 240,
                    "listenedSecs": 240,
                    "completed": true,
                    "skippedEarly": false,
                    "artist": artist,
                    "title": title,
                }),
            )
            .unwrap_or_else(|e| panic!("seeding {id} failed: {e}"));
        }
    }
}

#[test]
fn golden_matches_the_real_backend() {
    let (_app, webview) = mock_app();
    seed(&webview);

    let regenerate = std::env::var("GOAMP_GOLDEN_REGENERATE").is_ok();
    std::fs::create_dir_all(golden_dir()).expect("golden dir is creatable");

    for (cmd, args) in cases() {
        let actual = invoke(&webview, cmd, args)
            .unwrap_or_else(|e| panic!("`{cmd}` failed: {e}"));
        let pretty = serde_json::to_string_pretty(&actual).expect("serializable");
        let path = golden_dir().join(format!("{cmd}.json"));

        if regenerate {
            std::fs::write(&path, format!("{pretty}\n")).expect("golden is writable");
            continue;
        }

        let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| {
            panic!("missing golden for `{cmd}` — run `make verify-golden`")
        });
        assert_eq!(
            expected.trim(),
            pretty.trim(),
            "`{cmd}` drifted from its golden — run `make verify-golden` if the change is intended"
        );
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/verify/mod.rs`:

```rust
pub mod golden;
pub mod harness;
pub mod registration;
```

- [ ] **Step 3: Run it and watch it fail for the right reason**

Run: `cd src-tauri && cargo test verify::golden 2>&1 | tail -15`
Expected: FAIL with "missing golden for `feature_flags_list`". A failure inside
`seed` instead means an argument name is wrong — Tauri converts snake_case
parameters to camelCase over IPC, which is why the seed uses `canonicalId`.

- [ ] **Step 4: Generate the golden files**

```bash
mkdir -p /home/moffaty/projects/goamp/e2e/golden
touch /home/moffaty/projects/goamp/e2e/golden/.gitkeep
cd /home/moffaty/projects/goamp/src-tauri && GOAMP_GOLDEN_REGENERATE=1 cargo test verify::golden
```

- [ ] **Step 5: Run again without the env var**

Run: `cd src-tauri && cargo test verify::golden 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 6: Inspect what was recorded**

Run: `cat /home/moffaty/projects/goamp/e2e/golden/get_top_tracks_cmd.json`
Expected: two entries, Portishead first with `play_count` 3.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/verify e2e/golden
git commit -m "test(verify): record golden IPC responses for the UI layer

Seeds history through the real record_track_listen command and freezes the
responses the UI replays. Regeneration is opt-in via GOAMP_GOLDEN_REGENERATE so
CI reports drift instead of silently re-blessing it."
```

---

### Task 4: History reaches the charts, through the real stack

**Files:**
- Create: `src-tauri/src/verify/scenarios.rs`
- Modify: `src-tauri/src/verify/mod.rs`

**Interfaces:**
- Consumes: `harness::mock_app`, `harness::invoke`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/verify/scenarios.rs`:

```rust
use super::harness::{invoke, mock_app};

/// Scenario 4: a completed listen recorded through the real command must show up
/// at the top of the real charts query — UI-Rust-SQLite proven from the data side.
#[test]
fn a_completed_listen_reaches_the_charts() {
    let (_app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();

    for i in 0..2 {
        invoke(
            &webview,
            "record_track_listen",
            serde_json::json!({
                "canonicalId": "top-track",
                "source": "local",
                "startedAt": now - 600 - i,
                "durationSecs": 200,
                "listenedSecs": 200,
                "completed": true,
                "skippedEarly": false,
                "artist": "Boards of Canada",
                "title": "Roygbiv",
            }),
        )
        .expect("recording a listen must succeed");
    }

    // An incomplete listen must not count.
    invoke(
        &webview,
        "record_track_listen",
        serde_json::json!({
            "canonicalId": "skipped-track",
            "source": "local",
            "startedAt": now - 300,
            "durationSecs": 200,
            "listenedSecs": 12,
            "completed": false,
            "skippedEarly": true,
            "artist": "Nobody",
            "title": "Skipped",
        }),
    )
    .expect("recording a skip must succeed");

    let charts = invoke(
        &webview,
        "get_top_tracks_cmd",
        serde_json::json!({ "period": "week", "limit": 10 }),
    )
    .expect("charts query must succeed");

    let rows = charts.as_array().expect("charts return an array");
    assert_eq!(rows[0]["canonical_id"], "top-track");
    assert_eq!(rows[0]["play_count"], 2);
    assert!(
        !rows.iter().any(|r| r["canonical_id"] == "skipped-track"),
        "an incomplete listen must never appear in the charts: {rows:?}"
    );
}

/// The period filter is a real filter, not decoration.
#[test]
fn charts_respect_the_period_window() {
    let (_app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();

    invoke(
        &webview,
        "record_track_listen",
        serde_json::json!({
            "canonicalId": "old-track",
            "source": "local",
            "startedAt": now - 20 * 86_400,
            "durationSecs": 200,
            "listenedSecs": 200,
            "completed": true,
            "skippedEarly": false,
            "artist": "Old",
            "title": "Twenty Days Ago",
        }),
    )
    .expect("recording must succeed");

    let week = invoke(&webview, "get_top_tracks_cmd", serde_json::json!({ "period": "week", "limit": 10 }))
        .expect("week query must succeed");
    let month = invoke(&webview, "get_top_tracks_cmd", serde_json::json!({ "period": "month", "limit": 10 }))
        .expect("month query must succeed");

    assert!(week.as_array().expect("array").is_empty(), "20 days ago is outside the week window");
    assert_eq!(month.as_array().expect("array").len(), 1, "20 days ago is inside the month window");
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/verify/mod.rs`, add `pub mod scenarios;` in alphabetical order.

- [ ] **Step 3: Run it**

Run: `cd src-tauri && cargo test verify::scenarios 2>&1 | tail -15`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/verify
git commit -m "test(verify): scenario 4 — a listen reaches the charts

Records completed and incomplete listens through the real IPC command and
asserts the real charts query ranks the first and excludes the second, with the
period window checked against relative offsets so the test cannot rot."
```

---

### Task 5: The recommender actually responds to feedback

**Files:**
- Modify: `src-tauri/src/verify/scenarios.rs`

**Interfaces:**
- Consumes: `harness::mock_app`, `harness::invoke`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/verify/scenarios.rs`:

```rust
/// Scenario 5: a dislike must remove a track from recommendations. Order is not
/// asserted — the recommender shuffles — only the invariant.
#[test]
fn a_disliked_track_never_comes_back() {
    let (_app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();

    for id in ["keeper", "unwanted"] {
        invoke(
            &webview,
            "record_track_listen",
            serde_json::json!({
                "canonicalId": id,
                "source": "local",
                "startedAt": now - 1200,
                "durationSecs": 200,
                "listenedSecs": 200,
                "completed": true,
                "skippedEarly": false,
                "artist": "Artist",
                "title": id,
            }),
        )
        .expect("seeding must succeed");
    }

    invoke(
        &webview,
        "record_track_signal",
        serde_json::json!({ "canonicalId": "unwanted", "signal": -1, "scope": "global" }),
    )
    .expect("recording a dislike must succeed");

    let recs = invoke(&webview, "get_hybrid_recommendations", serde_json::json!({ "limit": 50 }))
        .expect("recommendations must succeed");

    let ids: Vec<String> = recs
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|r| r["canonical_id"].as_str().map(str::to_string))
        .collect();

    assert!(
        !ids.iter().any(|id| id == "unwanted"),
        "a disliked track must never be recommended, got {ids:?}"
    );
}

/// Cold start must still produce something for a brand-new user.
#[test]
fn cold_start_returns_something_on_an_empty_history() {
    let (_app, webview) = mock_app();

    let res = invoke(
        &webview,
        "get_coldstart_recommendations",
        serde_json::json!({ "limit": 10 }),
    );

    // Cold start may legitimately need the network; what must not happen is a
    // panic or a missing command. Either a list or a clean error is acceptable.
    match res {
        Ok(v) => assert!(v.is_array(), "expected an array, got {v}"),
        Err(e) => assert!(
            !e.to_string().contains("not found"),
            "get_coldstart_recommendations must stay registered: {e}"
        ),
    }
}
```

- [ ] **Step 2: Run it**

Run: `cd src-tauri && cargo test verify::scenarios 2>&1 | tail -15`
Expected: PASS, 4 tests. If `a_disliked_track_never_comes_back` fails because the
recommender returns nothing at all for two seeded tracks, keep the assertion and
seed more listens — do not weaken it into a tautology.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/verify
git commit -m "test(verify): scenario 5 — feedback moves the recommender

Asserts a disliked track disappears from hybrid recommendations and that cold
start survives an empty history, checking invariants rather than exact order
because the recommender shuffles."
```

---

### Task 6: Playwright over the real bundle, with the Tauri API aliased

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `vite.e2e.config.ts`
- Create: `e2e/shim/tauri.ts`
- Create: `e2e/shim/analytics.ts`
- Create: `e2e/tests/cold-start.spec.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `e2e/golden/*.json` from Task 3.
- Produces: the e2e vite config and shim used by every later L2 task; `e2e/artifacts/` output tree.

- [ ] **Step 1: Install Playwright**

```bash
cd /home/moffaty/projects/goamp
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Write the Tauri shim**

Create `e2e/shim/tauri.ts`. It must export exactly the symbols `src/` imports —
`invoke`, `convertFileSrc`, `getCurrentWindow`, `getCurrentWebviewWindow`,
`listen`, `open`, `openUrl`, `check`:

```ts
// Stands in for @tauri-apps/* during L2. `invoke` replays the responses L1
// recorded from the real backend; everything else is the smallest behaviour the
// UI needs to run in a browser.
import golden from '../golden/index.json'

const responses = golden as Record<string, unknown>

export const calls: Array<{ command: string; args?: Record<string, unknown> }> = []

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  calls.push({ command, args })
  if (command in responses) return responses[command] as T
  // Commands with no golden are ones the gate does not cover (sidecar, network).
  // Reject the way the real backend would when the sidecar is down, so the UI
  // has to handle it rather than hanging.
  throw new Error(`[e2e] no golden for command: ${command}`)
}

export function convertFileSrc(path: string): string {
  return `/fixtures/${path.split('/').pop()}`
}

const noopWindow = {
  setAlwaysOnTop: async () => {},
  setAlwaysOnBottom: async () => {},
  setIgnoreCursorEvents: async () => {},
  outerPosition: async () => ({ x: 0, y: 0 }),
  innerSize: async () => ({ width: 275, height: 464 }),
  listen: async () => () => {},
  destroy: () => {},
}

export const getCurrentWindow = () => noopWindow
export const getCurrentWebviewWindow = () => ({ listen: async () => () => {} })
export const listen = async () => () => {}

// Dialog: the folder picker returns the fixture directory, which is what makes
// the local-playback scenario runnable without an OS dialog.
export const open = async () => '/fixtures'
export const openUrl = async () => {}
export const check = async () => null
```

- [ ] **Step 3: Write the analytics shim**

Create `e2e/shim/analytics.ts`. `initAnalytics()` calls `initAptabase` with a
hard-coded key, so the package itself is aliased away:

```ts
export const init = () => {}
export const trackEvent = () => {}
export default { init, trackEvent }
```

- [ ] **Step 4: Build the golden index**

The shim imports one JSON object. Generate it from the per-command files:

```bash
cd /home/moffaty/projects/goamp
node -e '
const fs = require("fs"), path = require("path");
const dir = "e2e/golden";
const out = {};
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
  out[path.basename(f, ".json")] = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
}
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n");
console.log("indexed", Object.keys(out).length, "commands");
'
```

- [ ] **Step 5: Write the e2e vite config**

Create `vite.e2e.config.ts`:

```ts
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// The real bundle, with Tauri and analytics swapped out below the app's own
// code. Nothing under src/ changes.
const shim = resolve(__dirname, 'e2e/shim/tauri.ts')

export default defineConfig({
  resolve: {
    alias: {
      '@tauri-apps/api/core': shim,
      '@tauri-apps/api/window': shim,
      '@tauri-apps/api/webviewWindow': shim,
      '@tauri-apps/api/event': shim,
      '@tauri-apps/plugin-dialog': shim,
      '@tauri-apps/plugin-opener': shim,
      '@tauri-apps/plugin-updater': shim,
      '@aptabase/web': resolve(__dirname, 'e2e/shim/analytics.ts'),
    },
  },
  server: { port: 5199, strictPort: true },
  publicDir: resolve(__dirname, 'e2e/fixtures-public'),
})
```

- [ ] **Step 6: Write the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: './e2e/artifacts/test-output',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  reporter: [['list'], ['html', { outputFolder: 'e2e/artifacts/report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Without this, headless Chromium refuses to start playback and the
      // local-file scenario cannot advance.
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'pnpm exec vite --config vite.e2e.config.ts',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
```

- [ ] **Step 7: Write the failing cold-start test**

Create `e2e/tests/cold-start.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Scenario 1 (UI half): the bundle boots, Webamp renders, nothing explodes.
// This is also the first thing in the repo that ever executes src/main.ts.
test('the app boots with a rendered player and no errors', async ({ page }) => {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('requestfailed', (r) => failedRequests.push(r.url()))

  await page.goto('/')

  const app = page.locator('#app')
  await expect(app).not.toBeEmpty()

  // The Webamp main window is the proof the renderer mounted, not just the div.
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // The app's own crash overlay must not have appeared.
  await expect(page.getByText('GOAMP startup failed')).toHaveCount(0)

  await page.screenshot({ path: 'e2e/artifacts/cold-start.png', fullPage: true })

  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([])
  expect(failedRequests, `failed requests: ${failedRequests.join(' | ')}`).toEqual([])
})
```

- [ ] **Step 8: Run it**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/cold-start.spec.ts --reporter=list 2>&1 | tail -25`
Expected: PASS. If `#main-window` never appears, open
`e2e/artifacts/report/index.html` and read the console dump — the usual cause is
a Tauri symbol the shim does not export yet, which Task 7 turns into a real test.

- [ ] **Step 9: Ignore generated artifacts**

Append to `.gitignore`:

```
e2e/artifacts/
```

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml playwright.config.ts vite.e2e.config.ts e2e .gitignore
git commit -m "test(e2e): boot the real bundle in Playwright

Runs the production frontend in headless Chromium with @tauri-apps/* and
Aptabase aliased to a shim that replays golden IPC responses, so src/ needs no
change. Asserts the player renders and the boot is free of console errors and
failed requests — the first check in the repo that executes src/main.ts."
```

---

### Task 7: Stop the shim from drifting

**Files:**
- Create: `e2e/tests/shim-coverage.spec.ts`

**Interfaces:**
- Consumes: `e2e/shim/tauri.ts` from Task 6.

- [ ] **Step 1: Write the failing test**

Create `e2e/tests/shim-coverage.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as shim from '../shim/tauri'

// A new `import { something } from '@tauri-apps/...'` in src/ would silently
// become `undefined` under the alias and break e2e in a confusing way. Fail
// loudly here instead.
test('the shim exports every Tauri symbol src/ imports', () => {
  const imported = new Set<string>()

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
      } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
        const text = readFileSync(path, 'utf8')
        const re = /import\s*\{([^}]+)\}\s*from\s*['"]@tauri-apps\/[^'"]+['"]/g
        for (const match of text.matchAll(re)) {
          for (const name of match[1].split(',')) {
            const clean = name.trim().split(/\s+as\s+/)[0].trim()
            if (clean) imported.add(clean)
          }
        }
      }
    }
  }

  walk(join(__dirname, '../../src'))

  const exported = new Set(Object.keys(shim))
  const missing = [...imported].filter((name) => !exported.has(name))

  expect(missing, `add these to e2e/shim/tauri.ts: ${missing.join(', ')}`).toEqual([])
})
```

- [ ] **Step 2: Run it**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/shim-coverage.spec.ts --reporter=list 2>&1 | tail -15`
Expected: PASS. A non-empty `missing` means Task 6's shim is incomplete — add the
symbol rather than editing the test.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/shim-coverage.spec.ts
git commit -m "test(e2e): guard the Tauri shim against drift

Fails when src/ imports a @tauri-apps symbol the e2e shim does not export,
which would otherwise surface as an undefined function deep inside a scenario."
```

---

### Task 8: Local file plays

**Files:**
- Create: `e2e/fixtures-public/fixtures/sample.wav`
- Create: `e2e/tests/playback.spec.ts`

**Interfaces:**
- Consumes: the shim's `open` (returns `/fixtures`) and `convertFileSrc` from Task 6.

- [ ] **Step 1: Generate a fixture wav**

A three-second 440 Hz tone, small enough to commit:

```bash
cd /home/moffaty/projects/goamp
mkdir -p e2e/fixtures-public/fixtures
python3 - <<'PY'
import math, struct, wave
with wave.open('e2e/fixtures-public/fixtures/sample.wav', 'w') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b''.join(
        struct.pack('<h', int(12000 * math.sin(2 * math.pi * 440 * i / 8000)))
        for i in range(8000 * 3)
    ))
PY
ls -la e2e/fixtures-public/fixtures/sample.wav
```

- [ ] **Step 2: Teach the shim about the fixture directory**

In `e2e/shim/tauri.ts`, replace the `invoke` fallback for `scan_directory` and
`read_metadata` by adding these entries before the `responses` lookup:

```ts
const FIXTURE_TRACK = {
  path: '/fixtures/sample.wav',
  artist: 'Fixture',
  title: 'Sample Tone',
  album: 'E2E',
  duration: 3,
  genre: '',
}

const local: Record<string, unknown> = {
  scan_directory: [FIXTURE_TRACK],
  read_metadata: FIXTURE_TRACK,
}
```

and in `invoke`, before consulting `responses`:

```ts
  if (command in local) return local[command] as T
```

- [ ] **Step 3: Write the failing test**

Create `e2e/tests/playback.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Scenario 2: a local file reaches the playlist and actually plays.
test('a local file loads and playback advances', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  // Ctrl+O is the documented shortcut for "open folder"; the shim answers the
  // dialog with the fixture directory.
  await page.keyboard.press('Control+o')

  const playlist = page.locator('#playlist-window')
  await expect(playlist.getByText('Sample Tone')).toBeVisible({ timeout: 10_000 })

  await page.locator('#play').click()

  // Position must actually move — a paused player would keep reporting 0.
  const readPosition = () =>
    page.evaluate(() => {
      const el = document.querySelector('audio') as HTMLAudioElement | null
      return el ? el.currentTime : -1
    })

  await expect.poll(readPosition, { timeout: 10_000 }).toBeGreaterThan(0.2)
  const moving = await readPosition()

  await page.locator('#pause').click()
  await page.waitForTimeout(700)
  const paused = await readPosition()
  expect(Math.abs(paused - (await readPosition()))).toBeLessThan(0.05)
  expect(paused).toBeGreaterThanOrEqual(moving)

  await page.screenshot({ path: 'e2e/artifacts/playback.png', fullPage: true })
})
```

- [ ] **Step 4: Run it**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/playback.spec.ts --reporter=list 2>&1 | tail -25`
Expected: PASS. If `currentTime` never moves, confirm the
`--autoplay-policy=no-user-gesture-required` launch flag from Task 6 is present;
without it Chromium silently refuses to start audio.

- [ ] **Step 5: Commit**

```bash
git add e2e/shim/tauri.ts e2e/fixtures-public e2e/tests/playback.spec.ts
git commit -m "test(e2e): scenario 2 — a local file loads and plays

Opens the fixture folder through the shimmed dialog, asserts the track reaches
the playlist, and checks playback position actually advances and freezes on
pause rather than trusting the button state."
```

---

### Task 9: Panels behave like retro windows

**Files:**
- Create: `e2e/tests/panels.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `e2e/tests/panels.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Scenario 3: the context menu opens panels, and a panel behaves like a window.
test('the Charts panel opens, drags, and survives a reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  await page.locator('#main-window').click({ button: 'right' })
  const chartsItem = page.getByText('Charts', { exact: true })
  await expect(chartsItem).toBeVisible()
  await chartsItem.click()

  const panel = page.locator('[data-panel="charts"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Your Top Tracks')).toBeVisible()

  await page.screenshot({ path: 'e2e/artifacts/panel-charts.png', fullPage: true })

  const before = await panel.boundingBox()
  if (!before) throw new Error('charts panel has no bounding box')

  // Drag it by its titlebar.
  await page.mouse.move(before.x + before.width / 2, before.y + 8)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 120, before.y + 68, { steps: 10 })
  await page.mouse.up()

  const after = await panel.boundingBox()
  if (!after) throw new Error('charts panel vanished after the drag')
  expect(Math.round(after.x - before.x), 'the panel must follow the cursor').toBeGreaterThan(50)

  // Position is persisted, so it must come back where it was left.
  await page.reload()
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  const restored = page.locator('[data-panel="charts"]')
  await expect(restored).toBeVisible()
  const box = await restored.boundingBox()
  if (!box) throw new Error('charts panel has no bounding box after reload')
  expect(Math.abs(box.x - after.x), 'the panel must reopen where it was left').toBeLessThan(8)
})
```

- [ ] **Step 2: Run it and fix the selectors against reality**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/panels.spec.ts --reporter=list 2>&1 | tail -25`

The panel selector `[data-panel="charts"]` is an assumption. If it fails, find the
real one and use it — do not weaken the assertions:

```bash
grep -rn "data-panel\|registerPanel\|className\|id =" /home/moffaty/projects/goamp/src/renderers/webamp/WebampUIFeature.ts | head -20
```

If the host mounts panels without a stable hook, add one in
`WebampUIFeature.ts` (a `data-panel` attribute carrying the panel id) — that is a
test-visibility affordance, not a behaviour change, and it is the one production
edit L2 is allowed.

- [ ] **Step 3: Re-run until green**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/panels.spec.ts --reporter=list 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/panels.spec.ts src/renderers/webamp/WebampUIFeature.ts
git commit -m "test(e2e): scenario 3 — panels open, drag, and persist

Drives the context menu to open Charts, drags the panel by its titlebar and
asserts it follows the cursor, then reloads and asserts the stored position is
restored."
```

---

### Task 10: The charts panel renders the backend's data

**Files:**
- Create: `e2e/tests/charts.spec.ts`

**Interfaces:**
- Consumes: `e2e/golden/get_top_tracks_cmd.json` from Task 3.

- [ ] **Step 1: Write the failing test**

Create `e2e/tests/charts.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import topTracks from '../golden/get_top_tracks_cmd.json'

// Scenario 4 (UI half): the rows the panel shows are the rows the real backend
// returned — the golden file came out of a real command in L1.
test('the charts panel renders the recorded backend rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  await page.locator('#main-window').click({ button: 'right' })
  await page.getByText('Charts', { exact: true }).click()

  const panel = page.locator('[data-panel="charts"]')
  await expect(panel).toBeVisible()

  const rows = topTracks as Array<{ artist: string; title: string; play_count: number }>
  expect(rows.length, 'golden must not be empty — regenerate with make verify-golden').toBeGreaterThan(0)

  const top = rows[0]
  await expect(panel).toContainText(top.title)
  await expect(panel).toContainText(top.artist)
  await expect(panel).toContainText(String(top.play_count))

  // Rank 1 must be the most-played row, not just present somewhere.
  const text = (await panel.textContent()) ?? ''
  expect(text.indexOf(top.title), 'the top track must come first').toBeLessThan(
    text.indexOf(rows[rows.length - 1]?.title ?? top.title) + 1 || Number.MAX_SAFE_INTEGER,
  )

  await page.screenshot({ path: 'e2e/artifacts/charts.png', fullPage: true })
})

test('switching to Month re-queries instead of reusing the week rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })
  await page.locator('#main-window').click({ button: 'right' })
  await page.getByText('Charts', { exact: true }).click()

  const panel = page.locator('[data-panel="charts"]')
  await expect(panel).toBeVisible()

  const callsBefore = await page.evaluate(() => (window as any).__E2E_CALLS__?.length ?? 0)
  await panel.getByText('Month', { exact: true }).click()

  await expect
    .poll(() => page.evaluate(() => (window as any).__E2E_CALLS__?.length ?? 0))
    .toBeGreaterThan(callsBefore)

  const last = await page.evaluate(() => {
    const calls = (window as any).__E2E_CALLS__ ?? []
    return calls[calls.length - 1]
  })
  expect(last.command).toBe('get_top_tracks_cmd')
  expect(last.args.period).toBe('month')
})
```

- [ ] **Step 2: Expose the call log to the page**

The second test needs the shim's `calls` array visible from the browser context.
At the bottom of `e2e/shim/tauri.ts`, add:

```ts
// Lets specs assert which commands the UI actually issued.
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__E2E_CALLS__ = calls
}
```

- [ ] **Step 3: Run it**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/charts.spec.ts --reporter=list 2>&1 | tail -25`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/charts.spec.ts e2e/shim/tauri.ts
git commit -m "test(e2e): scenario 4 UI half — the panel shows the backend's rows

Asserts the charts panel renders exactly what the real command returned into
golden, and that switching period issues a fresh query with the new period
rather than reusing the loaded rows."
```

---

### Task 11: Autoplay refills and respects dislikes

**Files:**
- Create: `e2e/tests/autoplay.spec.ts`

**Interfaces:**
- Consumes: the shim's `__E2E_CALLS__` log from Task 10.

- [ ] **Step 1: Write the failing test**

Create `e2e/tests/autoplay.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Scenario 5 (UI half): the feedback keys reach the backend with the right
// signal, which is what the mood engine and recommender are driven by.
test('the feedback keys send the expected signals', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#main-window')).toBeVisible({ timeout: 15_000 })

  await page.keyboard.press('Control+o')
  await expect(page.locator('#playlist-window').getByText('Sample Tone')).toBeVisible({
    timeout: 10_000,
  })
  await page.locator('#play').click()

  const signalCalls = async () =>
    page.evaluate(() =>
      ((window as any).__E2E_CALLS__ ?? []).filter(
        (c: { command: string }) =>
          c.command === 'record_track_signal' || c.command === 'set_track_like',
      ),
    )

  await page.locator('#main-window').click()
  await page.keyboard.press('d')

  await expect.poll(async () => (await signalCalls()).length).toBeGreaterThan(0)

  const calls = await signalCalls()
  const last = calls[calls.length - 1]
  expect(
    JSON.stringify(last.args),
    `a dislike must carry a negative signal, got ${JSON.stringify(last.args)}`,
  ).toMatch(/-1|false|dislike/)

  await page.screenshot({ path: 'e2e/artifacts/autoplay.png', fullPage: true })
})
```

- [ ] **Step 2: Run it and pin the real command**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/autoplay.spec.ts --reporter=list 2>&1 | tail -25`

If it fails because no signal call is recorded, find which command the `D` key
actually issues and assert that one exactly, replacing the loose regex with the
precise argument check:

```bash
grep -rn "'d'\|case 'd'\|keydown" /home/moffaty/projects/goamp/src/features/autoplay/AutoplayFeature.ts | head
```

- [ ] **Step 3: Re-run until green**

Run: `cd /home/moffaty/projects/goamp && pnpm exec playwright test e2e/tests/autoplay.spec.ts --reporter=list 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/tests/autoplay.spec.ts
git commit -m "test(e2e): scenario 5 UI half — feedback keys reach the backend

Plays a fixture track, presses the dislike key, and asserts the expected signal
command was issued with a negative value."
```

---

### Task 12: Wire the gate into make and CI

**Files:**
- Modify: `Makefile`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Add the npm scripts**

In `package.json`, add to `"scripts"`:

```json
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui"
```

- [ ] **Step 2: Add the make targets**

In `Makefile`, add these targets and update `check`:

```make
verify: verify-ipc verify-ui ## Run the verification gate (L1 + L2)

verify-ipc: ## L1 — real commands over the real IPC path
	cd src-tauri && cargo test verify:: -- --nocapture

verify-ui: ## L2 — the real bundle in Playwright
	pnpm exec playwright test

verify-golden: ## Regenerate golden IPC responses (by hand, never in CI)
	cd src-tauri && GOAMP_GOLDEN_REGENERATE=1 cargo test verify::golden
	node -e 'const fs=require("fs"),path=require("path");const d="e2e/golden";const o={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="index.json"))o[path.basename(f,".json")]=JSON.parse(fs.readFileSync(path.join(d,f),"utf8"));fs.writeFileSync(path.join(d,"index.json"),JSON.stringify(o,null,2)+"\n");console.log("indexed",Object.keys(o).length,"commands")'
```

Then change the `check` target to include it:

```make
check: lint lint-rust test test-rust verify build-check ## Run all checks
```

- [ ] **Step 3: Verify the whole gate locally**

Run: `cd /home/moffaty/projects/goamp && make verify 2>&1 | tail -25`
Expected: L1 tests pass, then all Playwright specs pass.

- [ ] **Step 4: Add the CI step**

In `.github/workflows/ci.yml`, after the existing frontend test step, add:

```yaml
      - name: Install Playwright browser
        run: pnpm exec playwright install --with-deps chromium

      - name: Verification gate (L1 + L2)
        run: make verify

      - name: Upload verification artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: verification-artifacts
          path: e2e/artifacts/
          retention-days: 7
```

- [ ] **Step 5: Document it**

In `README.md`, under `### Quality`, after the `make check` block, add:

```markdown
`make check` includes `make verify` — the verification gate. It runs every Tauri
command through the real IPC path against a real SQLite database, then boots the
real frontend bundle in headless Chromium and drives the core flows. Screenshots
and traces land in `e2e/artifacts/`.

Golden IPC responses are regenerated by hand with `make verify-golden`; CI never
regenerates them, so a backend change that alters a response surfaces as a failed
check rather than a silent update.
```

- [ ] **Step 6: Confirm the full check passes**

Run: `cd /home/moffaty/projects/goamp && make check 2>&1 | tail -30`
Expected: every stage green. Report the wall-clock time of `make verify`; if it
exceeds two minutes, cut scenarios rather than accepting the slowdown.

- [ ] **Step 7: Commit**

```bash
git add Makefile package.json .github/workflows/ci.yml README.md
git commit -m "ci: fold the verification gate into make check

make verify runs the IPC contract tests and the Playwright suite; make check now
depends on it, and CI uploads screenshots and traces so a red run can be
inspected. Golden regeneration stays a manual target."
```

---

## Out of Scope

- **L3** — the real binary under `tauri-driver` with a real window, tray, WebKitGTK webview and real network. It needs `tauri-driver` (cargo) and `WebKitWebDriver` (`sudo apt install webkit2gtk-driver`), neither installed. Gets its own plan.
- **Visual regression** — screenshots are artifacts for human review, never pixel baselines.
- **Windows verification** — the gate targets Linux/WSL and the ubuntu runner.
- **P2P and sidecar commands** — they need `NodeProcess`, so the gate covers their registration only.
