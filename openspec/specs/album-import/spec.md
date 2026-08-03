# album-import Specification

## Purpose
Lets a user import a whole album/set/playlist by pasting its URL, turning it into a
playable tracklist with a visible total duration — including SoundCloud sets that
only track-search could not reach.
## Requirements
### Requirement: Import a playlist by URL

The system SHALL resolve a playlist/album/set URL to its full list of tracks, each
carrying at least a title, uploader/artist, and duration. The logical source SHALL be
inferred from the URL host so the same set imports regardless of which profile
re-uploaded it. If no tracks can be resolved, the system SHALL report an error rather
than an empty success.

#### Scenario: SoundCloud set resolves to its tracks
- **WHEN** a SoundCloud `/sets/` URL is imported
- **THEN** every track in the set is returned with its title and duration

#### Scenario: Unresolvable URL errors
- **WHEN** an import URL yields no tracks
- **THEN** the operation returns an error, not an empty list reported as success

### Requirement: Pasting a URL in search imports instead of searching

When the search input contains an album/set/playlist URL, submitting it SHALL import
that URL rather than run a keyword search. A plain (non-URL) query SHALL still search.

#### Scenario: Pasted set URL imports
- **WHEN** the user submits a set/playlist URL in the search box
- **THEN** the overlay imports the album and does not perform a keyword search

#### Scenario: Plain query still searches
- **WHEN** the user submits non-URL text
- **THEN** the overlay performs a keyword search as before

### Requirement: Imported album shows total duration and a bulk queue action

An imported album SHALL display its track count and total duration, and offer an
action to queue all of its tracks at once.

#### Scenario: Total duration is shown
- **WHEN** an album is imported
- **THEN** the status shows the track count and the summed total duration

#### Scenario: Queue-all is offered
- **WHEN** an album is imported
- **THEN** a "Queue all" action is available that appends every track to the queue

