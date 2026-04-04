# GOAMP Mood-Based Recommendations — Design Spec

**Date:** 2026-04-04
**Status:** Approved

---

## Goal

Replace passive genre radio with a mood-aware recommendation engine. Users tune into a mood channel (calm, energetic, focus, discovery + custom) that plays an infinite stream of tracks ranked by their personal taste profile filtered through mood context. Moods are learned passively from listening behavior and can be nudged explicitly via ↑/✕ signals.

---

## Core Decisions

| Question | Decision |
|---|---|
| Mood types | Preset (calm, energetic, focus, discovery) + user-custom |
| Primary experience | Mood radio — infinite stream, not a saved playlist |
| Secondary experience | Personal playlists tagged with a mood; tagged tracks seed that channel |
| UI placement | Mood tabs in main Winamp player window, below track title |
| Taste model | Shared global track universe; each mood has independent scoring weights |
| Mood learning | Listening context (primary) + Last.fm audio tags (cold-start fallback) |
| P2P sharing | Mood centroids only (float vectors); raw scores stay local |
| Explicit signals | ↑ / ✕ buttons in context menu with scope submenu (mood-specific or global) |
| Settings | Merged into Feature Flags panel: tag chip management + sensitivity sliders |

---

## Architecture

Three-layer system stacked on top of the existing recommendation foundation (Phase 1: track identity + listen history):

```
┌─────────────────────────────────────────────┐
│  Layer 3: P2P Centroid Exchange             │
│  Mood centroids → TasteProfile proto        │
│  Peer centroids → seed discovery queue      │
├─────────────────────────────────────────────┤
│  Layer 2: Mood Scoring Engine               │
│  Cold start → tag similarity                │
│  With history → completion_rate scoring     │
│  Centroid active → vector cosine ranking    │
├─────────────────────────────────────────────┤
│  Layer 1: Data Collection                   │
│  listen_history (source_mood column)        │
│  mood_track_scores                          │
│  track_features (Last.fm tag vectors)       │
│  mood_centroids                             │
└─────────────────────────────────────────────┘
```

---

## Data Model

### New tables

```sql
-- Mood channel definitions
CREATE TABLE IF NOT EXISTS mood_channels (
    id TEXT PRIMARY KEY,          -- 'calm', 'energetic', 'focus', 'discovery', or custom UUID
    name TEXT NOT NULL,
    is_preset INTEGER NOT NULL DEFAULT 0,
    seed_tags TEXT NOT NULL,      -- JSON array of Last.fm tag names used for cold start
    created_at INTEGER DEFAULT (unixepoch())
);

-- Per-track, per-mood context scores (updated on every play)
CREATE TABLE IF NOT EXISTS mood_track_scores (
    mood_id TEXT NOT NULL,
    canonical_id TEXT NOT NULL,
    play_count INTEGER DEFAULT 0,
    completion_rate REAL DEFAULT 0.0,   -- avg (listened_secs / duration_secs)
    skip_rate REAL DEFAULT 0.0,
    last_played_at INTEGER,
    PRIMARY KEY (mood_id, canonical_id)
);

-- Last.fm tag feature vectors per track
CREATE TABLE IF NOT EXISTS track_features (
    canonical_id TEXT PRIMARY KEY,
    tags_json TEXT NOT NULL,      -- {"chill":85,"ambient":60,"electronic":40,...}
    feature_vec TEXT NOT NULL,    -- JSON float array (normalized, ~30 dims)
    fetched_at INTEGER DEFAULT (unixepoch())
);

-- Per-mood centroid (average of member track feature vectors)
CREATE TABLE IF NOT EXISTS mood_centroids (
    mood_id TEXT PRIMARY KEY,
    centroid_vec TEXT NOT NULL,   -- JSON float array
    track_count INTEGER DEFAULT 0,
    updated_at INTEGER DEFAULT (unixepoch())
);

-- Explicit like/dislike signals with scope
CREATE TABLE IF NOT EXISTS track_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_id TEXT NOT NULL,
    signal INTEGER NOT NULL,      -- 1 = boost, -1 = block
    scope TEXT NOT NULL,          -- 'global' or 'mood:<mood_id>'
    tag_penalty_applied INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
);
```

### Modified tables

```sql
-- Add source_mood to existing listen_history
ALTER TABLE listen_history ADD COLUMN source_mood TEXT NULL;
-- NULL = no mood active; 'calm', 'energetic', etc. = mood was active
```

### Preset mood seed tags

| Mood | Seed tags |
|---|---|
| calm | chill, ambient, acoustic, sleep, relaxing, meditation |
| energetic | energetic, workout, upbeat, dance, hype, party |
| focus | focus, concentration, study, instrumental, deep work |
| discovery | obscure, underground, experimental, rare |

---

## Scoring Pipeline

Three stages; system advances automatically as data accumulates.

### Stage 1 — Cold start (< 50 mood listens)

1. Take global taste pool: top-200 tracks by `global_rank` (from `track_likes` + `listen_history`)
2. For each candidate: fetch `track_features.feature_vec`; if missing, fetch Last.fm tags and compute vector
3. Score = cosine_similarity(mood.seed_tag_vec, track.feature_vec)
4. Sort descending, take top-15 + 5 discovery (lowest familiarity, score > 0.3)

### Stage 2 — Context learning (≥ 50 mood listens)

```
score = 0.4 × global_rank_norm
      + 0.4 × completion_rate(mood, track)
      + 0.2 × cosine_similarity(mood_seed_vec, track_feature_vec)
```

Centroid accumulates in background (recomputed after every 10 new plays).

### Stage 3 — Centroid active (≥ 50 tracks with feature vectors in mood)

Replace seed tag similarity with centroid similarity:
```
score = 0.4 × global_rank_norm
      + 0.4 × completion_rate(mood, track)
      + 0.2 × cosine_similarity(mood_centroid_vec, track_feature_vec)
```

### Explicit signal adjustments

Applied as multipliers on top of the score:
- `track_signals` boost (global or matching mood): score × 1.5
- `track_signals` block (global or matching mood): score × 0.0 (excluded)
- Tag-level penalty: for each blocked tag matching track's top tags, score × 0.6 per tag (cumulative, floor 0.05)

### Queue generation

Batch of 20 tracks per fill:
- 15 scored tracks (from pipeline above)
- 5 discovery: tracks not in top-200 global pool, high mood-fit score, not played in last 30 days

---

## Explicit Signals

### Context menu additions

Right-click on any track adds two items with scope submenu:

```
↑ Recommend similar  ▸  ┌ In <active_mood> only
                         └ Globally (all moods)

✕ Don't recommend    ▸  ┌ In <active_mood> only
                         └ Globally (all moods)
```

If no mood is active, submenu is omitted and action defaults to global.

### Signal effects

**Boost (↑):**
- Inserts row into `track_signals (signal=1, scope=...)`
- Fetches track's top-3 Last.fm tags, upserts boost weight for those tags in `tag_weights` table
- Score multiplier: ×1.5 for matching scope

**Block (✕):**
- Inserts row into `track_signals (signal=-1, scope=...)`
- Fetches track's top-3 Last.fm tags, applies penalty weight
- Score multiplier: ×0.0 (hard exclude)
- Sets `tag_penalty_applied = 1` to avoid duplicate penalty fetches

### tag_weights table

```sql
CREATE TABLE IF NOT EXISTS tag_weights (
    tag TEXT NOT NULL,
    scope TEXT NOT NULL,          -- 'global' or 'mood:<mood_id>'
    weight REAL NOT NULL DEFAULT 1.0,  -- >1 = boost, <1 = penalty
    PRIMARY KEY (tag, scope)
);
```

---

## UI Components

### Main player — mood tabs

Below the track title in the Winamp main window:

```
▶ Artist - Track Title
[● calm] [focus] [energetic] [discovery] [+ add]
```

- Active mood: green background, `●` prefix
- Click to switch mood (stops current queue, generates new batch)
- `+ add` opens inline name input to create custom mood
- No mood active by default (tabs shown but none selected)

### Context menu

Additions to existing GOAMP right-click menu (in `goamp-menu.ts`):
- `↑ Recommend similar ▸` (with scope submenu)
- `✕ Don't recommend similar ▸` (with scope submenu)
- Placed after existing "Search similar" if present, otherwise after playlist section

### Feature Flags panel — Rec Settings section

New section at bottom of `FeatureFlagsPanel.ts`:

**Boosted tags:** Tag chips with × button. Click × removes the boost (deletes from `tag_weights`).
**Blocked tags:** Tag chips with × button. Click × removes the block.
**Sliders:**
- *Mood influence*: controls the β weight (completion_rate coefficient), range 0.1–0.7, default 0.4
- *Discovery ratio*: controls discovery track count per batch, range 0–10, default 5
- *Explicit signal weight*: controls boost/block multiplier strength, range 1.1–3.0, default 1.5

Settings stored as feature flags in existing `settings` SQLite table.

---

## P2P Integration

### TasteProfile proto addition

```protobuf
message MoodCentroid {
  repeated float vec = 1;    // ~30 dimensions, Last.fm tag space
  int32 track_count = 2;
  int64 updated_at = 3;
}

message TasteProfile {
  // existing fields...
  map<string, MoodCentroid> mood_centroids = 5;  // key = mood_id
}
```

### Sync behavior

- Centroids synced with same 5–10 min cadence as global taste profile
- Only moods with `track_count >= 10` are included in sync (not enough data = noisy)
- Blocked tags and `track_signals` are **never shared** — local only
- Server finds top-10 peers with closest centroid per mood (cosine similarity on server side)
- Their `mood_track_scores` top-20 tracks (fetched anonymously, no peer ID exposed) seed discovery queue

---

## Dependencies

- **Prerequisite:** Recommendation System Phase 1 (track identity + listen history tables) must be complete
- Last.fm integration: existing `ScrobbleSettings` stores API key; reuse for `track.getTopTags`
- P2P node: `goamp-node` Plan 1 complete; `TasteProfile` proto exists in `proto/goamp.proto`
- Feature Flags panel: existing `FeatureFlagsPanel.ts` + `feature_flags.rs`

---

## Non-Goals (this spec)

- Audio fingerprint-based BPM/energy analysis (too complex, Last.fm tags sufficient)
- Valence/happiness detection (requires Spotify API)
- Cross-user collaborative filtering at scale (that's the server's job, not this spec)
- Mood recommendations for local files without Last.fm match (no tags = no feature vec = excluded from mood scoring, still in global pool)
