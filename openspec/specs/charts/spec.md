# charts Specification

## Purpose
Shows the user what they actually listen to — a "Your Top Tracks" panel ranked from
local listen history over a week/month/all window, plus a Community tab that sums the
same counts across taste profiles already gossiped in from peers.

## Requirements
### Requirement: Personal top tracks over a period

The system SHALL rank tracks by number of completed plays within a period, most-played
first, and SHALL return at most the requested number of entries. Only completed plays
SHALL count. The supported periods are the last week, the last 30 days, and all time.

#### Scenario: Ranked by completed plays
- **WHEN** a user opens their charts for a period
- **THEN** the tracks played to completion in that window are returned most-played first,
  each with its artist, title and play count

#### Scenario: Incomplete plays are excluded
- **WHEN** a track was started but never played to completion
- **THEN** it does not appear in the charts

#### Scenario: Period bounds the window
- **WHEN** a track's plays fall outside the requested period
- **THEN** those plays are not counted for that period, while the all-time view still
  counts them

#### Scenario: Empty history
- **WHEN** there are no completed plays at all
- **THEN** an empty result is returned rather than an error

### Requirement: One entry per track regardless of source

A track known under several sources SHALL appear exactly once, and its play count SHALL
reflect the number of listens only — never multiplied by how many identity rows the
track has.

#### Scenario: Track known from two sources
- **WHEN** the same canonical track has identity rows from more than one source
- **THEN** the charts contain a single entry for it with its true play count

### Requirement: Community charts from peer profiles

The system SHALL produce a community chart by summing the user's own completed plays
with the top-track counts carried in taste profiles already received from peers, ranked
most-played first and bounded by the requested limit. It SHALL read only locally stored
peer profiles — producing the chart SHALL NOT require a network call. Because gossiped
profiles are snapshots without per-play timestamps, community charts SHALL be all-time
only.

#### Scenario: Local and peer counts are summed
- **WHEN** a track appears both in the user's history and in peers' profiles
- **THEN** one entry is returned whose play count is the sum of both contributions

#### Scenario: Malformed peer profile is skipped
- **WHEN** a stored peer profile cannot be parsed
- **THEN** it is ignored and the remaining profiles still produce a chart

#### Scenario: No peers yet
- **WHEN** no peer profiles have been received
- **THEN** the community chart falls back to the user's own all-time counts

### Requirement: Charts panel

The app SHALL expose the charts through a context-menu entry that toggles a panel. The
panel SHALL offer the three personal periods and the community view, load the selected
one on demand, and render each row with its rank position, title, artist and play count.
It SHALL show a distinct message when there is nothing to show, and another when the
data could not be loaded.

#### Scenario: Switching view re-queries
- **WHEN** the user selects a different period or the community tab
- **THEN** that view's data is fetched and the ranked list is replaced with it

#### Scenario: Nothing listened to yet
- **WHEN** the selected view returns no entries
- **THEN** the panel says there are no plays yet instead of showing an empty box

#### Scenario: Load failure is visible
- **WHEN** the charts cannot be loaded
- **THEN** the panel shows an error message rather than staying on "Loading..."
