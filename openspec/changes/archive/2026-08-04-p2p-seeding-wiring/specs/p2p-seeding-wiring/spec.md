## Purpose

Wires the desktop app to the node's content protocol so downloaded tracks are seeded
to the network and playback resolves from peers before falling back to yt-dlp.

## ADDED Requirements

### Requirement: The node exposes provide/fetch over HTTP

The node SHALL accept a request to provide a local file as content for a track id
(reading the file and storing+announcing it), and SHALL serve a track's bytes for a
given id, returning a not-found response when it holds none.

#### Scenario: Provide a local file
- **WHEN** the desktop posts a track id and an existing file path to the node
- **THEN** the node stores and announces that track and reports success

#### Scenario: Fetch a held track
- **WHEN** a track id the node can resolve is requested
- **THEN** the node responds with the audio bytes

#### Scenario: Fetch a missing track
- **WHEN** a track id the node cannot resolve is requested
- **THEN** the node responds with a not-found status, not empty success

### Requirement: Downloaded tracks are seeded

After a track is downloaded to disk, the app SHALL provide it to the node under a
stable content id derived from its source and native id, so the same track resolves
to the same id on every peer.

#### Scenario: Download triggers provide
- **WHEN** a track finishes downloading to the Downloads folder
- **THEN** the app provides that file to the node under its content id

### Requirement: Playback resolves from peers first

When resolving a track's audio, the app SHALL first attempt a peer fetch by content
id; on any miss or error it SHALL fall through to the existing yt-dlp path with
unchanged behavior.

#### Scenario: Peer has the track
- **WHEN** a peer serves the requested content id
- **THEN** the app uses the fetched audio without invoking yt-dlp

#### Scenario: No peer has the track
- **WHEN** no peer serves the content id
- **THEN** the app falls back to yt-dlp exactly as before
