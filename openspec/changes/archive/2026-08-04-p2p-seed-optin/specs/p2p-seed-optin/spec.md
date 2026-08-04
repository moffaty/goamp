## Purpose

Makes P2P seeding of downloaded tracks a deliberate, user-controlled choice that is
off unless explicitly enabled.

## ADDED Requirements

### Requirement: Seeding is off by default

Until the user turns seeding on, downloading a track SHALL NOT provide it to the P2P
network. The seeding preference SHALL persist across restarts.

#### Scenario: Fresh install does not seed
- **WHEN** a track is downloaded and the user has never enabled seeding
- **THEN** the track is saved to disk but not provided to the network

#### Scenario: Preference persists
- **WHEN** the user enables seeding and restarts the app
- **THEN** seeding remains enabled

### Requirement: Enabling seeding makes downloads seed

When seeding is enabled, downloading a track SHALL provide it to the P2P network;
disabling it again SHALL stop new downloads from being provided.

#### Scenario: Enabled download seeds
- **WHEN** seeding is enabled and a track is downloaded
- **THEN** the track is provided to the network under its content id

#### Scenario: Disabled download does not seed
- **WHEN** seeding is disabled and a track is downloaded
- **THEN** the track is not provided to the network

### Requirement: The seeding toggle is reachable from the UI

The UI SHALL show the current seeding state and let the user turn it on or off.

#### Scenario: Toggle reflects and changes state
- **WHEN** the user opens the menu
- **THEN** a seeding control shows whether seeding is on, and activating it flips and
  persists the preference
