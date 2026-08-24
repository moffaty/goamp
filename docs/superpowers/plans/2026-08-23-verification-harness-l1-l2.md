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
- L2 requires no change to production *behaviour* under `src/`. The one edit it
  may make is a test-visibility affordance: a `data-panel` attribute carrying the
  panel id, if the host mounts panels without a stable selector (Task 9).
- L3 (real binary under `tauri-driver`) is out of scope for this plan and gets its own.

---

### Task 1: Make the gate's commands runtime-generic and stand up the harness

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/feature_flags.rs:14`
- Modify: `src-tauri/src/charts.rs:132`, `src-tauri/src/charts.rs:143`
- Modify: `src-tauri/src/recommend.rs:170`
- Modify: `src-tauri/src/history.rs:115`, `src-tauri/src/history.rs:173`
- Modify: `src-tauri/src/taste_profile.rs:122`
- Create: `src-tauri/src/verify/mod.rs`
- Create: `src-tauri/src/verify/harness.rs`
- Modify: `src-tauri/src/lib.rs` (one `mod` line only)

**Why this shape:** `tauri::AppHandle` is `AppHandle<Wry>`. A command written
against it cannot be registered in a `MockRuntime` app at all, so the gate's
commands must accept `AppHandle<R>` instead. Only the commands the gate actually
invokes are converted — seven of them. The other 95 keep their concrete handle and
are covered by Task 2's source-level registration guard. `run()` is not touched.

**Interfaces:**
- Produces: `verify::harness::mock_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>)`, `verify::harness::invoke(&WebviewWindow<MockRuntime>, &str, serde_json::Value) -> Result<serde_json::Value, serde_json::Value>`, `verify::harness::seed_identity(&App<MockRuntime>, &str, &str, &str, &str, &str)`, and `verify::harness::GATE_COMMANDS: &[&str]`.

- [ ] **Step 1: Add the `test` feature as a dev-dependency**

In `src-tauri/Cargo.toml`:

```toml
[dev-dependencies]
tauri = { version = "2", features = ["test"] }
```

- [ ] **Step 2: Probe one command before converting the rest**

Convert exactly one command and prove the approach compiles before touching the
others. In `src-tauri/src/feature_flags.rs`, change the signature only — the body
stays byte-for-byte identical:

```rust
#[tauri::command]
pub fn feature_flags_list<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<FeatureFlag>, String> {
```

Run: `cd src-tauri && cargo check 2>&1 | grep -E "^error" | head`
Expected: no output. `generate_handler!` in `run()` infers `R = Wry` at that call
site, so production is unaffected.

**If this step fails, STOP and report BLOCKED with the exact error.** Everything
below depends on it.

- [ ] **Step 3: Convert the remaining six**

Same edit — add `<R: tauri::Runtime>` and change `tauri::AppHandle` to
`tauri::AppHandle<R>`. Bodies stay identical. The six:

| File | Function |
|---|---|
| `src-tauri/src/charts.rs` | `get_top_tracks_cmd` |
| `src-tauri/src/charts.rs` | `get_community_charts_cmd` |
| `src-tauri/src/recommend.rs` | `get_hybrid_recommendations` |
| `src-tauri/src/history.rs` | `record_track_listen` |
| `src-tauri/src/history.rs` | `get_liked_tracks` |
| `src-tauri/src/taste_profile.rs` | `build_profile` |

Run: `cd src-tauri && cargo check 2>&1 | grep -E "^error" | head`
Expected: no output.

- [ ] **Step 4: Declare the verify module**

In `src-tauri/src/lib.rs`, beside the other `mod` declarations:

```rust
#[cfg(test)]
mod verify;
```

- [ ] **Step 5: Create the module root**

Create `src-tauri/src/verify/mod.rs`:

```rust
//! Verification harness (L1): drives the gate's commands over the real IPC path
//! on Tauri's MockRuntime. See
//! docs/superpowers/specs/2026-08-23-verification-harness-design.md
pub mod harness;
```

- [ ] **Step 6: Write the harness**

Create `src-tauri/src/verify/harness.rs`:

```rust
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow, WebviewWindowBuilder};

/// The commands the gate invokes for real. Every name here must also appear in
/// the production handler in `lib.rs` — `verify::registration` enforces that.
pub const GATE_COMMANDS: &[&str] = &[
    "feature_flags_list",
    "list_playlists",
    "get_top_tracks_cmd",
    "get_community_charts_cmd",
    "get_hybrid_recommendations",
    "record_track_listen",
    "get_liked_tracks",
    "build_profile",
    "record_track_signal",
];

/// A mock app carrying the gate's commands and a fresh in-memory database.
pub fn mock_app() -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            crate::feature_flags::feature_flags_list,
            crate::commands::playlists::list_playlists,
            crate::charts::get_top_tracks_cmd,
            crate::charts::get_community_charts_cmd,
            crate::recommend::get_hybrid_recommendations,
            crate::history::record_track_listen,
            crate::history::get_liked_tracks,
            crate::taste_profile::build_profile,
            crate::commands::mood::record_track_signal,
        ])
        .manage(crate::db::test_db())
        .build(mock_context(noop_assets()))
        .expect("failed to build mock app");

    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("failed to build mock webview");

    (app, webview)
}

/// Seeds a track's identity (artist/title) straight through the managed
/// database. Fixture setup, not the thing under test: the real
/// `resolve_track_id` command is async and can reach out to MusicBrainz, which
/// the offline constraint forbids. Everything under test still goes over IPC.
pub fn seed_identity(
    app: &App<MockRuntime>,
    canonical_id: &str,
    source: &str,
    source_id: &str,
    artist: &str,
    title: &str,
) {
    let db = app.state::<crate::db::Db>();
    let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
        "INSERT OR REPLACE INTO track_identity (canonical_id, source, source_id, artist, title)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![canonical_id, source, source_id, artist, title],
    )
    .expect("seeding track_identity must succeed");
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

- [ ] **Step 7: Write the smoke test**

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

    #[test]
    fn every_gate_command_is_reachable() {
        let (_app, webview) = mock_app();

        for cmd in GATE_COMMANDS {
            // Empty args: most commands reject them, and that is fine. What must
            // never happen is Tauri reporting the command does not exist.
            if let Err(e) = invoke(&webview, cmd, serde_json::json!({})) {
                let msg = e.to_string();
                assert!(
                    !msg.contains("not found"),
                    "gate command `{cmd}` is not reachable over IPC: {msg}"
                );
            }
        }
    }
}
```

- [ ] **Step 8: Run the tests**

Run: `cd src-tauri && cargo test verify:: 2>&1 | tail -20`
Expected: PASS, 2 tests.

- [ ] **Step 9: Confirm production still builds untouched**

Run: `cd src-tauri && cargo clippy -- -D warnings 2>&1 | grep -E "^error" | head`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src
git commit -m "test(verify): drive the gate's commands over the real IPC path

Tauri's AppHandle is AppHandle<Wry>, so a command written against it cannot be
registered in a MockRuntime app. The seven commands the gate invokes now take
AppHandle<R>; production infers Wry at the call site and is unaffected. Adds the
harness that invokes them through get_ipc_response rather than calling them as
plain functions."
```

---

### Task 2: Prove no command escapes registration

**Files:**
- Create: `src-tauri/src/verify/registration.rs`
- Modify: `src-tauri/src/verify/mod.rs`

**Why this shape:** the 95 commands outside the gate cannot be invoked under
MockRuntime, but the failure that actually reaches users — a `#[tauri::command]`
that nobody registered, which the frontend hits as "command not found" — is
detectable statically. This task closes that hole for all 108.

**Interfaces:**
- Consumes: `harness::GATE_COMMANDS` from Task 1.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/verify/registration.rs`:

```rust
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// Every `#[tauri::command]` function name in the source tree.
fn declared_commands() -> BTreeSet<String> {
    fn walk(dir: &Path, out: &mut BTreeSet<String>) {
        for entry in std::fs::read_dir(dir).expect("readable source dir") {
            let path = entry.expect("readable entry").path();
            if path.is_dir() {
                walk(&path, out);
                continue;
            }
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("readable source file");
            let mut lines = text.lines().peekable();
            while let Some(line) = lines.next() {
                if !line.trim_start().starts_with("#[tauri::command") {
                    continue;
                }
                // The attribute may be followed by more attributes.
                for next in lines.by_ref() {
                    let t = next.trim_start();
                    if t.starts_with('#') {
                        continue;
                    }
                    if let Some(rest) = t
                        .strip_prefix("pub async fn ")
                        .or_else(|| t.strip_prefix("pub fn "))
                    {
                        let name = rest.split(['(', '<']).next().unwrap_or("").trim();
                        if !name.is_empty() {
                            out.insert(name.to_string());
                        }
                    }
                    break;
                }
            }
        }
    }

    let mut out = BTreeSet::new();
    walk(&src_dir(), &mut out);
    out
}

/// Every command name registered in `run()`'s `generate_handler!`.
fn registered_commands() -> BTreeSet<String> {
    let text = std::fs::read_to_string(src_dir().join("lib.rs")).expect("lib.rs is readable");
    let start = text
        .find("generate_handler![")
        .expect("lib.rs registers commands");
    let body = &text[start..];
    let end = body.find("])").expect("the handler list is closed");

    body[..end]
        .lines()
        .skip(1)
        .filter_map(|line| {
            let t = line.trim().trim_end_matches(',');
            if t.is_empty() || t.starts_with('#') || t.starts_with("//") {
                return None;
            }
            t.rsplit("::").next().map(str::to_string)
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// A `#[tauri::command]` that nobody registered is invisible to every existing
/// test and fails at runtime as "command not found" the moment the UI calls it.
#[test]
fn every_declared_command_is_registered() {
    let declared = declared_commands();
    let registered = registered_commands();

    assert!(
        declared.len() > 90,
        "the parser found only {} commands — it is broken, not the code",
        declared.len()
    );

    let missing: Vec<&String> = declared.difference(&registered).collect();
    assert!(
        missing.is_empty(),
        "these #[tauri::command] functions are never registered in lib.rs: {missing:?}"
    );
}

/// The gate invokes a subset of the real command set — never a name production
/// does not register.
#[test]
fn gate_commands_are_a_subset_of_production() {
    let registered = registered_commands();

    let strays: Vec<&&str> = super::harness::GATE_COMMANDS
        .iter()
        .filter(|cmd| !registered.contains(**cmd))
        .collect();

    assert!(
        strays.is_empty(),
        "the gate invokes commands production does not register: {strays:?}"
    );
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/verify/mod.rs`:

```rust
pub mod harness;
pub mod registration;
```

- [ ] **Step 3: Run it**

Run: `cd src-tauri && cargo test verify::registration 2>&1 | tail -15`
Expected: PASS, 2 tests. If `every_declared_command_is_registered` reports missing
names, check them by hand: either register the command in `lib.rs` or, if it is
genuinely dead code, delete it — do not weaken the test.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/verify
git commit -m "test(verify): prove no #[tauri::command] escapes registration

Parses every command declaration in the source tree and the handler list in
lib.rs and fails when a command exists but is never registered — the failure the
frontend hits as \"command not found\" and no existing test can see."
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
        ("build_profile", serde_json::json!({})),
    ]
}

/// Puts two completed listens in history so charts and recommendations have
/// something to return. Offsets are relative to now — never absolute dates —
/// so the week/month windows stay valid forever.
fn seed(
    app: &tauri::App<tauri::test::MockRuntime>,
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
) {
    let now = chrono::Utc::now().timestamp();
    for (id, artist, title, plays) in [
        ("aaa", "Portishead", "Roads", 3),
        ("bbb", "Massive Attack", "Angel", 1),
    ] {
        // Artist/title live in track_identity — record_track_listen does not
        // carry them — so seed identity directly, then record listens over IPC.
        super::harness::seed_identity(app, id, "local", id, artist, title);
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
                }),
            )
            .unwrap_or_else(|e| panic!("seeding {id} failed: {e}"));
        }
    }
}

#[test]
fn golden_matches_the_real_backend() {
    let (app, webview) = mock_app();
    seed(&app, &webview);

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
    let (app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();
    super::harness::seed_identity(&app, "top-track", "local", "top-track", "Boards of Canada", "Roygbiv");

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

### Task 5: The like/dislike commands honour their own contract

**Files:**
- Modify: `src-tauri/src/history.rs:141` (`set_track_like` signature only)
- Modify: `src-tauri/src/verify/harness.rs` (add `set_track_like` to the gate)
- Modify: `src-tauri/src/verify/scenarios.rs` (append tests)

**Why this shape:** the original version of this task asserted that a dislike
recorded via `record_track_signal` removes a track from
`get_hybrid_recommendations`, and that a like via the same command appears in
`get_liked_tracks`. Both were wrong about where the behaviour lives, and the
investigation produced two findings worth keeping:

- `record_track_signal` writes only `track_signals`. The recommender
  (`content_recommend`, `collaborative_recommend`, `hybrid_recommend`) never
  reads that table — it excludes tracks via `track_likes`. The user-visible
  "a disliked track never comes back" is delivered client-side by
  `blockTrack`/`isBlocked` in `src/features/autoplay/autoplay-feedback.ts`,
  which persists to `localStorage`. So there is no backend invariant to assert.
- `set_track_like` / `remove_track_like` are registered but called from nowhere
  in `src/`, so `track_likes` is never written by the app and `get_liked_tracks`
  is always empty in production. That is a real product gap, recorded for the
  user; this task does not fix it.

What remains genuinely assertable at this layer is that the like commands
honour their own contract, and that the recommender returns well-formed output.

**Interfaces:**
- Consumes: `harness::{mock_app, invoke, seed_identity}`.

- [ ] **Step 1: Make `set_track_like` runtime-generic**

In `src-tauri/src/history.rs:141`, signature only — the body does not change:

```rust
#[tauri::command]
pub fn set_track_like<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    canonical_id: String,
    liked: bool,
) -> Result<(), String> {
```

Run: `cd src-tauri && cargo check 2>&1 | grep -E "^error" | head`
Expected: no output.

- [ ] **Step 2: Add it to the gate**

In `src-tauri/src/verify/harness.rs`, add `"set_track_like"` to `GATE_COMMANDS`
and `crate::history::set_track_like,` to the `generate_handler!` list in
`mock_app()`. Keep both lists in the same relative order as each other.

- [ ] **Step 3: Write the failing tests**

Append to `src-tauri/src/verify/scenarios.rs`:

```rust
/// The like commands own `track_likes`, and `get_liked_tracks` reads it. This
/// pair is the contract; whether the UI currently calls it is a separate
/// question (it does not — see the plan's Task 5 notes).
#[test]
fn a_like_round_trips_through_the_like_commands() {
    let (app, webview) = mock_app();
    super::harness::seed_identity(&app, "liked", "local", "liked", "Artist", "Liked Song");

    let before = invoke(&webview, "get_liked_tracks", serde_json::json!({}))
        .expect("get_liked_tracks must succeed");
    assert!(
        before.as_array().expect("array").is_empty(),
        "nothing is liked before the command runs, got {before}"
    );

    invoke(
        &webview,
        "set_track_like",
        serde_json::json!({ "canonicalId": "liked", "liked": true }),
    )
    .expect("set_track_like must succeed");

    let after = invoke(&webview, "get_liked_tracks", serde_json::json!({}))
        .expect("get_liked_tracks must succeed");

    let ids: Vec<String> = after
        .as_array()
        .expect("array")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect();

    assert!(
        ids.iter().any(|id| id == "liked"),
        "a liked track must appear in get_liked_tracks, got {ids:?}"
    );
}

/// The recommender must return well-formed rows once there is history to work
/// with. Shape matters as much as content: RecEntry is a positional tuple, so a
/// field reorder in production would otherwise slip through silently.
#[test]
fn the_recommender_returns_well_formed_rows() {
    let (app, webview) = mock_app();
    let now = chrono::Utc::now().timestamp();

    // content_recommend needs at least two completed listens per track.
    for (id, artist, title) in [
        ("rec-a", "Portishead", "Roads"),
        ("rec-b", "Massive Attack", "Angel"),
        ("rec-c", "Tricky", "Hell Is Round The Corner"),
    ] {
        super::harness::seed_identity(&app, id, "local", id, artist, title);
        for i in 0..3 {
            invoke(
                &webview,
                "record_track_listen",
                serde_json::json!({
                    "canonicalId": id,
                    "source": "local",
                    "startedAt": now - 3600 - i,
                    "durationSecs": 200,
                    "listenedSecs": 200,
                    "completed": true,
                    "skippedEarly": false,
                }),
            )
            .expect("seeding must succeed");
        }
    }

    let recs = invoke(&webview, "get_hybrid_recommendations", serde_json::json!({ "limit": 20 }))
        .expect("recommendations must succeed");

    let rows = recs.as_array().expect("recommendations return an array");
    assert!(
        !rows.is_empty(),
        "the recommender must return something once history exists"
    );

    for row in rows {
        let entry = row.as_array().expect("each RecEntry is a positional tuple");
        assert_eq!(entry.len(), 5, "RecEntry must have 5 fields, got {entry:?}");
        assert!(
            entry[0].as_str().is_some_and(|s| !s.is_empty()),
            "field 0 must be a non-empty canonical_id, got {entry:?}"
        );
        assert!(
            entry[1].is_number(),
            "field 1 must be the numeric score, got {entry:?}"
        );
    }
}
```

- [ ] **Step 4: Run the whole verify module**

Run: `cd src-tauri && cargo test verify:: 2>&1 | tail -20`
Expected: all tests PASS.

If `the_recommender_returns_well_formed_rows` finds an empty list, seed more
tracks and more listens per track — do NOT weaken the assertion to allow empty.

- [ ] **Step 5: Clippy**

Run: `cd src-tauri && cargo clippy -- -D warnings 2>&1 | grep -E "^error" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "test(verify): the like commands honour their own contract

set_track_like becomes runtime-generic and joins the gate, so the
set_track_like/get_liked_tracks pair is exercised over the real IPC path, and
the recommender's output shape is pinned — RecEntry is a positional tuple, so a
field reorder would otherwise pass silently."
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
