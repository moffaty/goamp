# Personal Music Charts — TDD Implementation Plan

**Date:** 2026-07-24
**Scope:** "Your Top Tracks" panel — local listen history only, no network aggregation.
**Approach:** TDD (red-green-refactor), one task per layer.
**Status:** done — shipped and merged to master; community charts followed in a later slice.

---

## Files Touched

| File | Action |
|------|--------|
| `src-tauri/src/charts.rs` | **CREATE** — query fn + `#[tauri::command]` |
| `src-tauri/src/lib.rs` | EDIT — add `mod charts;` + register command in `invoke_handler` |
| `src/services/interfaces.ts` | EDIT — add `ChartEntry`, `ChartPeriod`, `IChartsService` |
| `src/services/ChartsService.ts` | **CREATE** — transport wrapper |
| `src/services/ChartsService.test.ts` | **CREATE** — MockTransport tests |
| `src/features/charts/ChartsFeature.ts` | **CREATE** — IFeature impl (panel + menu) |
| `src/features/charts/ChartsFeature.test.ts` | **CREATE** — feature tests |
| `src/main.ts` | EDIT — wire `ChartsFeature` |

---

## Task 1 — Rust: `get_top_tracks` query function + tests

### 1.1 Write failing test
- [x] Create `src-tauri/src/charts.rs`
- [x] Add `#[cfg(test)] mod tests` with a test `test_top_tracks_ordering`:
  - Seed via `crate::history::record_listen(&conn, ...)`:
    - Track A (`canonical_id = "aaa"`): 5 completed listens at `now - 3600` (within week)
    - Track B (`canonical_id = "bbb"`): 3 completed listens at `now - 3600`
    - Track C (`canonical_id = "ccc"`): 1 completed listen at `now - 3600`
    - Track D (`canonical_id = "ddd"`): 2 listens with `completed = false` (should be excluded)
  - Seed `track_identity` rows for each canonical_id (INSERT artist/title)
  - Call `get_top_tracks(&conn, "week", 10)` and assert:
    - Returns 3 entries (D excluded)
    - Order: A (5), B (3), C (1)
    - Each `ChartEntry` has correct `artist`, `title`, `play_count`
- [x] Add test `test_top_tracks_period_filtering`:
  - Track E: 3 completed listens at `now - 2 days` (inside week)
  - Track F: 4 completed listens at `now - 20 days` (outside week, inside month)
  - Call with `"week"` -> only E returned
  - Call with `"month"` -> both E and F, F first (4 > 3)
  - Call with `"all"` -> both returned
- [x] Add test `test_top_tracks_limit`:
  - Seed 5 tracks with different play counts
  - Call with `limit = 3` -> only top 3 returned
- [x] Add test `test_top_tracks_empty`:
  - No listens seeded
  - Call returns empty `Vec`
- [x] Add test `test_top_tracks_dedupes_identity`:
  - Seed `track_identity` with 2 rows for same `canonical_id` (different sources)
  - Seed completed listens for that canonical_id
  - Assert result has exactly 1 entry (not duplicated)

### 1.2 Make tests pass
- [x] Define `ChartEntry` struct with `Serialize`:
  ```
  #[derive(Serialize, Debug, PartialEq)]
  pub struct ChartEntry {
      pub canonical_id: String,
      pub artist: String,
      pub title: String,
      pub play_count: i32,
  }
  ```
- [x] Implement `get_top_tracks(conn: &Connection, period: &str, limit: i32) -> Vec<ChartEntry>`:
  - Map period to cutoff: `"week"` = `now - 7*86400`, `"month"` = `now - 30*86400`, `"all"` = `0`
  - SQL:
    ```sql
    SELECT h.canonical_id, MAX(t.artist) AS artist, MAX(t.title) AS title, COUNT(*) AS play_count
    FROM listen_history h
    LEFT JOIN track_identity t USING(canonical_id)
    WHERE h.completed = 1 AND h.started_at >= ?1
    GROUP BY h.canonical_id
    ORDER BY play_count DESC
    LIMIT ?2
    ```
  - Use `rusqlite::params![cutoff, limit]`, collect rows into `Vec<ChartEntry>`
- [x] Run `cd src-tauri && cargo test charts` -- all green

### 1.3 Add Tauri command wrapper
- [x] Add `#[tauri::command] pub fn get_top_tracks_cmd(app: tauri::AppHandle, period: String, limit: i32) -> Result<Vec<ChartEntry>, String>` following `history.rs` pattern (lock `app.state::<crate::db::Db>()`)
- [x] In `src-tauri/src/lib.rs`:
  - Add `mod charts;` to the module list
  - Add `charts::get_top_tracks_cmd` to `invoke_handler![...]`
- [x] `cd src-tauri && cargo test` -- full suite still green
- [x] `cd src-tauri && cargo check` -- no warnings

---

## Task 2 — TypeScript: `ChartsService` + types

### 2.1 Add types to interfaces
- [x] In `src/services/interfaces.ts`, add:
  ```ts
  export type ChartPeriod = 'week' | 'month' | 'all'

  export interface ChartEntry {
    canonical_id: string
    artist: string
    title: string
    play_count: number
  }

  export interface IChartsService {
    getTopTracks(period: ChartPeriod, limit?: number): Promise<ChartEntry[]>
  }
  ```

### 2.2 Write failing ChartsService test
- [x] Create `src/services/ChartsService.test.ts`:
  - Test: `getTopTracks calls transport with correct command and args`
    - `transport.setResponse('get_top_tracks_cmd', [...])`
    - Call `svc.getTopTracks('week', 20)`
    - Assert `transport.lastCall.command === 'get_top_tracks_cmd'`
    - Assert `transport.lastCall.args` equals `{ period: 'week', limit: 20 }`
  - Test: `getTopTracks defaults limit to 50`
    - Call `svc.getTopTracks('month')` (no limit arg)
    - Assert args has `limit: 50`
  - Test: `getTopTracks returns response`
    - Set response to `[{ canonical_id: 'x', artist: 'A', title: 'T', play_count: 5 }]`
    - Assert return value matches

### 2.3 Make tests pass
- [x] Create `src/services/ChartsService.ts`:
  ```ts
  import type { ITransport } from './transport'
  import type { IChartsService, ChartEntry, ChartPeriod } from './interfaces'

  export class ChartsService implements IChartsService {
    constructor(private t: ITransport) {}

    getTopTracks(period: ChartPeriod, limit = 50) {
      return this.t.call<ChartEntry[]>('get_top_tracks_cmd', { period, limit })
    }
  }
  ```
- [x] `pnpm test --run` -- ChartsService tests green
- [x] `pnpm exec tsc --noEmit` -- no type errors

---

## Task 3 — TypeScript: `ChartsFeature` (panel + menu registration)

### 3.1 Write failing ChartsFeature tests
- [x] Create `src/features/charts/ChartsFeature.test.ts` using the P2PFeature test as template:
  - Helper `makeCtx()` with `MockTransport`, `EventBus`, mock `ui`, `LocalKVStorage('test-charts')`
  - Test: `has id "charts"`
  - Test: `init registers panel with id "charts"`
    - Assert `ctx.ui.registerPanel` called with `('charts', fn)`
  - Test: `init registers menu item "Charts"`
    - Assert `ctx.ui.registerMenuItem` called with `('Charts', fn)`
  - Test: `"Charts" menu item toggles the charts panel`
    - Extract handler from `registerMenuItem` mock, call it
    - Assert `ctx.ui.togglePanel` called with `'charts'`
  - Test: `panel renders ranked rows with position, title, artist, play count`
    - `transport.setResponse('get_top_tracks_cmd', [ {canonical_id:'a', artist:'Artist1', title:'Song1', play_count:10}, {canonical_id:'b', artist:'Artist2', title:'Song2', play_count:5} ])`
    - Extract render fn from `registerPanel`, call it, await flush
    - Assert el.textContent contains `"1"`, `"Song1"`, `"Artist1"`, `"10"`, `"2"`, `"Song2"`
  - Test: `panel shows empty state when no tracks`
    - `transport.setResponse('get_top_tracks_cmd', [])`
    - Assert el.textContent contains `"No plays yet"`
  - Test: `period toggle re-queries with new period`
    - Render panel, find period buttons, click "Month"
    - Assert transport was called again with `period: 'month'`
  - Test: `destroy cleans up`
    - `feature.destroy()` does not throw
  - Test: `destroy without init does not throw`

### 3.2 Make tests pass
- [x] Create `src/features/charts/ChartsFeature.ts`:
  - `implements IFeature`, `id = 'charts'`
  - Constructor takes `ITransport`, creates `ChartsService`
  - `init(ctx)`:
    - `ctx.ui.registerPanel('charts', () => this.renderChartsPanel())`
    - `ctx.ui.registerMenuItem('Charts', () => ctx.ui.togglePanel('charts'))`
  - `renderChartsPanel()`:
    - Create container div with retro styling (dark bg, green monospace text, inset border -- match P2P panel)
    - Header: "Your Top Tracks"
    - Period toggle: three buttons (Week / Month / All), default "Week" active
    - Ranked list area, initially "Loading..."
    - On render + on period click: call `this.svc.getTopTracks(period)`, populate list
    - Each row: `# / title -- artist / play_count` using `textContent` (no innerHTML)
    - Empty state: "No plays yet -- go listen to something"
    - Error state: "Could not load charts"
  - `destroy()`: clear cleanups array
- [x] `pnpm test --run` -- ChartsFeature tests green

---

## Task 4 — Wire into main.ts + final verification

### 4.1 Wire feature
- [x] In `src/main.ts`:
  - Add import: `import { ChartsFeature } from './features/charts/ChartsFeature'`
  - Add `.feature(new ChartsFeature(transport))` in the GoampCore builder chain (after `P2PFeature`, before `AutoplayFeature`)

### 4.2 Full verification
- [x] `cd /home/moffaty/projects/goamp/src-tauri && cargo test charts` -- Rust tests pass
- [x] `cd /home/moffaty/projects/goamp && pnpm test --run` -- all TS tests pass
- [x] `cd /home/moffaty/projects/goamp && pnpm exec tsc --noEmit` -- no type errors
- [x] `cd /home/moffaty/projects/goamp/goamp-node && go build ./...` -- unaffected, still compiles

---

## Out of Scope

These were explicitly deferred to later slices:

- ~~**Network-aggregated charts** (charts computed from P2P peer data)~~ — shipped
  later as the Community tab (`get_community_charts`), see `openspec/specs/charts`
- ~~**Charts-over-P2P** (sharing/gossiping chart data between peers)~~ — shipped:
  `top_tracks` rides the gossiped taste profile
- **Artist charts** (top artists view -- only top tracks in this slice)
- **Sparklines / graphs / trend indicators** (visual enhancements)
- **Date range picker** (custom date ranges beyond week/month/all)
- **Genre filtering** on charts
- **Album charts**
- **"Most skipped" or other negative charts**
- **Caching / materialized views** (query is simple enough for local SQLite)

---

## Ground Truth Verification

All verified by reading source files:

- `listen_history` schema confirmed in `src-tauri/src/db/mod.rs:188-199` -- columns match spec
- `track_identity` PK is `(source, source_id)` at `db/mod.rs:181` -- canonical_id not unique, GROUP BY + MAX needed
- `record_listen` signature confirmed in `history.rs:7-29` -- usable for test seeding
- `test_db()` returns in-memory `Db` at `db/mod.rs:46-50`
- Command pattern (AppHandle + state lock) confirmed across `history.rs:113-177`
- `invoke_handler` list at `lib.rs:58-162`
- P2PFeature panel/menu pattern at `P2PFeature.ts:39-40`
- MockTransport API at `transport.ts:13-36`
- IFeature interface at `core/IFeature.ts:1-8`
- main.ts wiring at `main.ts:44-57`
- No existing charts code or `IChartsService` in the codebase
