.PHONY: dev build build-win build-android install lint lint-rust test test-watch \
       test-coverage check fmt clean release android-init help \
       verify verify-ipc verify-ui verify-golden

CARGO_PATH := $(HOME)/.cargo/bin
export PATH := $(CARGO_PATH):$(PATH)

TAURI_MANIFEST  := src-tauri/Cargo.toml
RUST_TARGET     := $(shell rustc -Vv 2>/dev/null | grep host | awk '{print $$2}')
NODE_BIN        := src-tauri/binaries/goamp-node-$(RUST_TARGET)
WIN_TARGET     := x86_64-pc-windows-msvc
WIN_OUT        := /mnt/c/Users/Moffaty/Desktop/goamp-dev

# ─── Development ──────────────────────────────────────────────

node-sidecar: ## Build goamp-node sidecar bigfgkljhfsklhfs'klj; nary for current platform
	cd goamp-node && go build -o ../$(NODE_BIN) ./cmd/goamp-node
	@echo "Built sidecar: $(NODE_BIN)"

node-sidecar-win: ## Cross-compile goamp-node sidecar for Windows (GOOS=windows)
	cd goamp-node && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
		go build -o ../src-tauri/binaries/goamp-node-x86_64-pc-windows-msvc.exe ./cmd/goamp-node
	@echo "Built Windows sidecar: src-tauri/binaries/goamp-node-x86_64-pc-windows-msvc.exe"

test-node: ## Run all goamp-node Go tests
	cd goamp-node && go test ./... -timeout 120s

# ─── P2P / Network Tests ──────────────────────────────────────

test-p2p: ## Run all P2P node tests (host + DHT + pubsub + catalog + integration)
	cd goamp-node && go test ./sdk/node/... -timeout 120s -v

test-p2p-host: ## Host connectivity tests (connect, stop, emit)
	cd goamp-node && go test ./sdk/node/... -run 'TestHost' -timeout 30s -v

test-p2p-dht: ## DHT announce / find-providers tests
	cd goamp-node && go test ./sdk/node/... -run 'TestDHT' -timeout 60s -v

test-p2p-pubsub: ## GossipSub profile publish / receive tests
	cd goamp-node && go test ./sdk/node/... -run 'TestGossipSub' -timeout 60s -v

test-p2p-catalog: ## Catalog protocol (remote search over libp2p stream) tests
	cd goamp-node && go test ./sdk/node/... -run 'TestCatalogProtocol' -timeout 30s -v

test-p2p-integration: ## Full end-to-end integration tests (announce→find, profile sync, health)
	cd goamp-node && go test ./sdk/node/... -run 'TestIntegration' -timeout 120s -v

test-p2p-race: ## All P2P tests with race detector (slower, catches data races)
	cd goamp-node && go test ./sdk/node/... -race -timeout 180s -v

dev: node-sidecar ## Run in dev mode (hot-reload)
	GDK_SCALE=1 pnpm tauri dev

dev-wsl: ## Run in dev mode on WSL (software rendering, 1x DPI)
	GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GDK_SCALE=1 pnpm tauri dev

dev-android: ## Run on connected Android device (hot-reload)
	pnpm tauri android dev

# ─── Build ────────────────────────────────────────────────────

build: ## Build for Linux (deb + AppImage)
	pnpm tauri build

build-win: node-sidecar-win ## Cross-compile for Windows + copy all binaries to $(WIN_OUT)
	pnpm build:win
	@mkdir -p $(WIN_OUT)
	@echo "Stopping any running GOAMP processes (Windows locks running .exe files)..."
	-@taskkill.exe /F /IM goamp.exe >/dev/null 2>&1
	-@taskkill.exe /F /IM goamp-node.exe >/dev/null 2>&1
	-@taskkill.exe /F /IM yt-dlp.exe >/dev/null 2>&1
	cp src-tauri/target/$(WIN_TARGET)/release/goamp.exe $(WIN_OUT)/goamp.exe
	cp src-tauri/binaries/goamp-node-$(WIN_TARGET).exe $(WIN_OUT)/goamp-node.exe
	cp src-tauri/binaries/yt-dlp-$(WIN_TARGET).exe $(WIN_OUT)/yt-dlp.exe
	@echo ""
	@echo "✓ Deployed to $(WIN_OUT)/:"
	@ls -lh $(WIN_OUT)/*.exe | awk '{printf "    %-25s %s\n", $$9, $$5}'
	@echo ""
	@echo "Note: sidecars renamed (triple suffix stripped) so Tauri finds them at runtime."

build-android: ## Build APK for Android
	pnpm tauri android build --apk

deploy-win: build-win ## Alias for build-win (kept for backwards compat)
	@echo "deploy-win is now an alias for build-win (which already copies everything)"

# ─── Quality ──────────────────────────────────────────────────

lint: ## TypeScript type check
	npx tsc --noEmit

lint-rust: ## Rust clippy + fmt check
	cargo fmt --manifest-path $(TAURI_MANIFEST) --check
	cargo clippy --manifest-path $(TAURI_MANIFEST) -- -D warnings

build-check: ## Verify the frontend bundles (catches issues tsc misses, e.g. top-level await on old targets)
	pnpm build

check: lint lint-rust test test-rust verify build-check ## Run all checks (lint + tests + verification gate + frontend bundle)

# ─── Verification gate ────────────────────────────────────────

verify: verify-ipc verify-ui ## Run the verification gate (L1 + L2)

verify-ipc: ## L1 — real commands over the real IPC path
	cd src-tauri && cargo test verify:: -- --nocapture

verify-ui: ## L2 — the real bundle in Playwright
	node_modules/.bin/playwright test

verify-golden: ## Regenerate golden IPC responses + argument shapes (by hand, never in CI)
	# Only regenerate the <cmd>.json / args/<cmd>.json files here — NOT
	# golden_index_matches_the_individual_files, which asserts index.json
	# (rebuilt below, from these files) is still fresh. Running it in this
	# same pass would compare against the *old* index and fail spuriously.
	cd src-tauri && GOAMP_GOLDEN_REGENERATE=1 cargo test verify::golden::golden_matches_the_real_backend
	cd src-tauri && GOAMP_GOLDEN_REGENERATE=1 cargo test verify::golden::argument_shapes_match_the_real_backend
	node -e 'const fs=require("fs"),path=require("path");const d="e2e/golden";const o={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="index.json"))o[path.basename(f,".json")]=JSON.parse(fs.readFileSync(path.join(d,f),"utf8"));fs.writeFileSync(path.join(d,"index.json"),JSON.stringify(o,null,2)+"\n");console.log("indexed",Object.keys(o).length,"commands")'
	node -e 'const fs=require("fs"),path=require("path");const d="e2e/golden/args";const o={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")&&f!=="index.json"))o[path.basename(f,".json")]=JSON.parse(fs.readFileSync(path.join(d,f),"utf8"));fs.writeFileSync(path.join(d,"index.json"),JSON.stringify(o,null,2)+"\n");console.log("indexed",Object.keys(o).length,"argument shapes")'
	# Now verify the freshly-rebuilt index against the files it was built from.
	cd src-tauri && cargo test verify::golden::golden_index_matches_the_individual_files

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
