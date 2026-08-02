---
name: build
description: Build GOAMP for Linux or Windows (cargo-xwin cross-compilation)
---

# Build GOAMP

## Usage

`/build` — build for current platform (Linux)
`/build win` — cross-compile for Windows via cargo-xwin

## Linux Build

```bash
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/deb/*.deb` and `*.AppImage`

## Windows Cross-Compile (from WSL2)

```bash
pnpm build:win
```

This runs: `tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin --no-bundle`

After successful build, copy the exe:
```bash
cp src-tauri/target/x86_64-pc-windows-msvc/release/goamp.exe /mnt/c/Users/Moffaty/Desktop/goamp-dev/
```

## Pre-build Checks

Before building, always run:
1. `npx tsc --noEmit` — TypeScript check
2. `PATH="$HOME/.cargo/bin:$PATH" cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` — Rust lint
3. `pnpm test` — frontend tests

## CI

CI builds run automatically on push to master via `.github/workflows/ci.yml`.
Targets: Linux (x86_64), macOS (aarch64), Windows (x86_64).
