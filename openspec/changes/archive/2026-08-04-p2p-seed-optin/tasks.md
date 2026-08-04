## 1. Backend

- [x] 1.1 `parse_seed_enabled(Option<String>) -> bool` (default OFF) + `seed_enabled(app)`
- [x] 1.2 Gate `download_track` seeding behind `seed_enabled`
- [x] 1.3 `set_seed_enabled` / `get_seed_enabled` commands + register in lib.rs
- [x] 1.4 Rust unit test for `parse_seed_enabled`

## 2. Frontend

- [x] 2.1 `seeding-service.ts`: getSeedEnabled / setSeedEnabled
- [x] 2.2 `goamp-menu.ts`: cached-state "Seed downloads (P2P)" checkbox toggling + persisting
- [x] 2.3 TS tests: service wrappers + menu item toggle

## 3. Verify

- [x] 3.1 `cargo test` + `pnpm test --run` + `tsc --noEmit` green
- [x] 3.2 `openspec validate p2p-seed-optin --strict` passes
