## Backend (commands/youtube.rs)

- Setting key `p2p_seed_enabled`, values "1"/"0". Pure `parse_seed_enabled(Option<String>) -> bool`
  (Some("1") → true; None/anything else → false — default OFF). Testable.
- `seed_enabled(app) -> bool` = `parse_seed_enabled(db.get_setting(KEY))`.
- Gate in `download_track`: `if seed_enabled(&app) { spawn_provide(...) }` (replaces the
  unconditional spawn).
- `#[tauri::command] set_seed_enabled(app, enabled: bool)` → `db.set_setting(KEY, "1"/"0")`.
- `#[tauri::command] get_seed_enabled(app) -> bool` → `seed_enabled(&app)`.
- Register both in lib.rs.

## Frontend

- `seeding-service.ts`: `getSeedEnabled(): Promise<boolean>` / `setSeedEnabled(b): Promise<void>`
  (invoke wrappers).
- `goamp-menu.ts`: module var `seedEnabled` loaded once in `initGoampMenu`
  (`getSeedEnabled().then(...)`). Menu item `${seedEnabled ? "✓ " : "  "}Seed downloads (P2P)`
  in the window-toggle group; action: flip var + `setSeedEnabled(next)`.
  // ponytail: cached in a module var, refreshed on init; good enough for a single toggle.

## Testing

- Rust: `parse_seed_enabled` — None→false, Some("0")→false, Some("1")→true, Some("x")→false.
- TS: seeding-service invoke wrappers; goamp-menu shows the item and toggling it calls
  `setSeedEnabled`.
