# track-download Specification

## Purpose
Lets a user save a searched or playing track as a real, human-named audio file in
their Downloads folder, instead of it living only in the opaque internal cache.
## Requirements
### Requirement: Download a track to the Downloads folder

The system SHALL download a track's audio to the operating system's Downloads
directory and return the saved file path. It SHALL work for both YouTube (by id) and
SoundCloud (by page URL). If the audio cannot be obtained, it SHALL return an error.

#### Scenario: Track saved with a readable name
- **WHEN** a user downloads a track with a known artist and title
- **THEN** an audio file named after the artist and title is saved to the Downloads
  folder and its path is returned

#### Scenario: Download failure reports an error
- **WHEN** the audio cannot be fetched
- **THEN** the operation returns an error rather than a bogus path

### Requirement: Filenames are filesystem-safe

The saved filename SHALL be derived from the artist and title with characters illegal
on common filesystems removed, whitespace collapsed, and overall length bounded. A
track with empty metadata SHALL still produce a non-empty, valid filename.

#### Scenario: Illegal characters are stripped
- **WHEN** the artist or title contains path separators or reserved characters
- **THEN** the resulting filename contains none of them and remains non-empty

#### Scenario: Empty metadata still yields a name
- **WHEN** both artist and title are empty
- **THEN** a non-empty fallback filename is used

