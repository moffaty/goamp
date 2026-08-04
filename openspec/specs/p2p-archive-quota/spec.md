# p2p-archive-quota Specification

## Purpose
Makes the content archive safe and bounded — arbitrary track ids map to safe
filenames, storage stays within quota, and enabling seeding requires informed consent.
## Requirements
### Requirement: Any track id maps to a safe filename

The archive SHALL store and retrieve content by a fixed, flat filename derived from
the track id, so ids containing `:`, `/`, or `..` cannot create nested paths or
escape the archive directory. A store followed by a retrieve of the same id SHALL
return the same bytes.

#### Scenario: Id with slashes round-trips
- **WHEN** content is stored under an id like `soundcloud:https://host/x` and then retrieved
- **THEN** the retrieved bytes equal the stored bytes and no nested directories are created

### Requirement: Storage stays within quota

When a non-zero quota is configured, the archive SHALL reject a store that would push
total usage over the quota. A zero quota means unlimited. Usage SHALL be measured from
the archive directory on startup so it is accurate across restarts.

#### Scenario: Over-quota store is rejected
- **WHEN** a store would exceed the configured quota
- **THEN** it returns an error and does not exceed the quota

#### Scenario: Usage reflects existing files on startup
- **WHEN** the archive is opened over a directory that already holds content
- **THEN** its reported usage includes those files

### Requirement: The archive reports usage stats

The archive SHALL report the current number of stored items and total bytes used.

#### Scenario: Stats after stores
- **WHEN** two items have been stored
- **THEN** stats report a count of two and the summed byte size

### Requirement: Enabling seeding requires consent

Turning seeding on from the UI SHALL first present a confirmation; if declined,
seeding SHALL remain off.

#### Scenario: Declined consent leaves seeding off
- **WHEN** the user activates the seeding toggle and declines the confirmation
- **THEN** seeding is not enabled

#### Scenario: Accepted consent enables seeding
- **WHEN** the user activates the seeding toggle and accepts the confirmation
- **THEN** seeding is enabled and the preference is persisted

