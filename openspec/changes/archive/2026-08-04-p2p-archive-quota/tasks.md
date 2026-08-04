## 1. Archive

- [x] 1.1 `key(trackID) = hex(sha256)`; Store/Retrieve use it (safe, flat filename)
- [x] 1.2 `New` scans dir → seed `used`/`count`; `Store` enforces non-zero quota (overwrite adjusts delta)
- [x] 1.3 `Stats() (count, used)`; `Quota()` reports scanned `used`
- [x] 1.4 `archive_test.go`: slash/colon round-trip, over-quota reject, scan-on-new, stats

## 2. Consent

- [x] 2.1 `goamp-menu.ts`: confirm() before enabling seeding (off is immediate)
- [x] 2.2 TS test: confirm true→enables, false→stays off

## 3. Verify

- [x] 3.1 `go build/test/vet` + `pnpm test --run` + `tsc --noEmit` green
- [x] 3.2 `openspec validate p2p-archive-quota --strict` passes
