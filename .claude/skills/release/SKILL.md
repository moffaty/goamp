---
name: release
description: Prepare and publish a new GOAMP release via GitHub Actions
---

# Release GOAMP

## Usage

`/release` — prepare a new release

## Steps

1. **Verify readiness:**
   - All tests pass: `pnpm test` and `cargo test --manifest-path src-tauri/Cargo.toml`
   - TypeScript clean: `npx tsc --noEmit`
   - Clippy clean: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
   - No uncommitted changes: `git status`

2. **Bump version** in these files:
   - `package.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `version`

3. **Commit version bump:**
   ```bash
   git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
   git commit -m "release: vX.Y.Z"
   ```

4. **Create and push tag:**
   ```bash
   git tag vX.Y.Z
   git push origin master --tags
   ```

5. **Monitor release:**
   The `release.yml` workflow triggers on `v*` tags and:
   - Builds for Linux, macOS, Windows
   - Creates a draft GitHub release with all platform binaries
   - Includes Tauri updater JSON

6. **Finalize:**
   - Review the draft release on GitHub
   - Edit release notes if needed
   - Publish the release
