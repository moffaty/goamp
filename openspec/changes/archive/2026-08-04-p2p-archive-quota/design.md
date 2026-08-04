## Archive (sdk/archive/archive.go)

- `key(trackID) = hex(sha256(trackID))` — flat, fixed-length, traversal-proof filename.
  Store/Retrieve use `filepath.Join(dir, key(id))`.
- `LocalArchive` gains `used int64` and `count int` (replacing reliance on quota.UsedBytes
  alone). `New` scans `dir` (os.ReadDir + Stat) to seed `used`/`count` from disk.
- `Store`: compute `key`; if it already exists, overwrite and adjust `used` by the size
  delta (don't double-count); else, when `quota.TotalBytes > 0` and `used+len > TotalBytes`,
  return an error before writing; on success bump `used` (+delta) and `count`.
  // ponytail: no eviction — a full archive just refuses new writes; LRU eviction later.
- `Quota()` returns `{TotalBytes, UsedBytes: used}`. `Stats() (count int, used int64)`.

## Frontend (goamp-menu.ts)

- In the seeding toggle action, when turning ON (`!seedEnabled`), call
  `confirm("Seeding shares your downloaded tracks with other users. You are
  responsible for the content you share. Enable?")`; only enable + persist if accepted.
  Turning OFF is immediate (no prompt).

## Testing

- Go `archive_test.go`: slash/colon id round-trips (no nested dirs); over-quota store
  errors and usage unchanged; New over a pre-populated dir reports prior usage; Stats
  count+bytes after stores.
- TS `goamp-menu.test.ts`: enabling with confirm→true calls set_seed_enabled(true);
  confirm→false does not. (stub window.confirm.)
