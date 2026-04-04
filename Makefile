.PHONY: dev build build-win build-android install lint lint-rust test test-watch \
       test-coverage check fmt clean release android-init help

CARGO_PATH := $(HOME)/.cargo/bin
export PATH := $(CARGO_PATH):$(PATH)

TAURI_MANIFEST  := src-tauri/Cargo.toml
RUST_TARGET     := $(shell rustc -Vv 2>/dev/null | grep host | awk '{print $$2}')
NODE_BIN        := src-tauri/binaries/goamp-node-$(RUST_TARGET)
WIN_TARGET     := x86_64-pc-windows-msvc
WIN_OUT        := /mnt/c/Users/Moffaty/Desktop/goamp-dev

# ─── Development ──────────────────────────────────────────────

node-sidecar: ## Build goamp-node sidecar binary for current platform
	cd goamp-node && go build -o ../$(NODE_BIN) ./cmd/goamp-node
	@echo "Built sidecar: $(NODE_BIN)"

test-node: ## Run goamp-node Go tests
	cd goamp-node && go test ./... -timeout 120s

dev: node-sidecar ## Run in dev mode (hot-reload)
	pnpm tauri dev

dev-wsl: ## Run in dev mode on WSL (software rendering)
	GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 pnpm tauri dev

dev-android: ## Run on connected Android device (hot-reload)
	pnpm tauri android dev

# ─── Build ────────────────────────────────────────────────────

build: ## Build for Linux (deb + AppImage)
	pnpm tauri build

build-win: ## Cross-compile for Windows via cargo-xwin
	pnpm build:win

build-android: ## Build APK for Android
	pnpm tauri android build --apk

deploy-win: build-win ## Build for Windows and copy exe to desktop
	@mkdir -p $(WIN_OUT)
	cp src-tauri/target/$(WIN_TARGET)/release/goamp.exe $(WIN_OUT)/
	@echo "Deployed to $(WIN_OUT)/goamp.exe"

# ─── Quality ──────────────────────────────────────────────────

lint: ## TypeScript type check
	npx tsc --noEmit

lint-rust: ## Rust clippy + fmt check
	cargo fmt --manifest-path $(TAURI_MANIFEST) --check
	cargo clippy --manifest-path $(TAURI_MANIFEST) -- -D warnings

check: lint lint-rust test test-rust ## Run all checks (lint + test)

fmt: ## Format all code
	cargo fmt --manifest-path $(TAURI_MANIFEST)

# ─── Tests ────────────────────────────────────────────────────

test: ## Run frontend tests
	pnpm test

test-watch: ## Run frontend tests in watch mode
	pnpm test:watch

test-coverage: ## Run frontend tests with coverage
	pnpm test:coverage

test-rust: ## Run Rust tests
	cargo test --manifest-path $(TAURI_MANIFEST)

# ─── Setup ────────────────────────────────────────────────────

install: ## Install all dependencies
	pnpm install

android-init: ## Initialize Android project (requires Android SDK + NDK)
	pnpm tauri android init

clean: ## Clean build artifacts
	rm -rf dist
	cargo clean --manifest-path $(TAURI_MANIFEST)

# ─── Release ──────────────────────────────────────────────────

release: check ## Create release (pass VERSION=x.y.z)
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=0.2.0)
endif
	@echo "Bumping version to $(VERSION)..."
	sed -i 's/"version": "[^"]*"/"version": "$(VERSION)"/' package.json
	sed -i 's/^version = "[^"]*"/version = "$(VERSION)"/' $(TAURI_MANIFEST)
	sed -i 's/"version": "[^"]*"/"version": "$(VERSION)"/' src-tauri/tauri.conf.json
	git add package.json $(TAURI_MANIFEST) src-tauri/tauri.conf.json
	git commit -m "release: v$(VERSION)"
	git tag v$(VERSION)
	@echo "Tagged v$(VERSION). Push with: git push origin master --tags"

# ─── Help ─────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
