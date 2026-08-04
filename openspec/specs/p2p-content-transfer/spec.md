# p2p-content-transfer Specification

## Purpose
Lets nodes move actual track audio between peers: a node can store and announce a
track it holds, and another node can fetch that track's bytes over a dedicated
peer-to-peer stream protocol.
## Requirements
### Requirement: A node can provide a track's content

A node SHALL be able to store a track's audio bytes under its track id and announce
itself as a provider of that id to the network, so other peers can discover it holds
the track.

#### Scenario: Provide stores and announces
- **WHEN** a node provides a track id together with its audio bytes
- **THEN** the bytes are retrievable locally by that id and the node is discoverable
  as a provider for that id

### Requirement: A peer can fetch a track's content over the stream protocol

A node SHALL serve a requested track's bytes to a connected peer over the content
stream protocol, and a client SHALL be able to request a track by id and receive its
bytes. A request for a track the server does not hold SHALL yield no bytes rather than
corrupt data.

#### Scenario: Fetch returns the provider's bytes
- **WHEN** node B requests a track id that node A has provided, from A
- **THEN** B receives exactly the bytes A stored

#### Scenario: Fetch of an unheld track yields nothing
- **WHEN** a node requests a track id the server does not hold
- **THEN** the client receives no content bytes and no partial/corrupt payload

### Requirement: Local content resolves without the network

When a node already holds a track's bytes, requesting that track SHALL return the
local copy without contacting other peers.

#### Scenario: Local hit skips the network
- **WHEN** a node requests a track id it already stores
- **THEN** it returns the local bytes and performs no provider lookup

