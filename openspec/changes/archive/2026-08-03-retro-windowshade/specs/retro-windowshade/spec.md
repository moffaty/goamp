## Purpose

Lets a retro window collapse to its titlebar and expand again, the Winamp way, so
panels can be parked compactly without being closed.

## ADDED Requirements

### Requirement: Double-click titlebar toggles the body

Double-clicking a retro window's titlebar SHALL hide the window body when it is
visible, and restore it when it is hidden. The titlebar SHALL remain visible in both
states.

#### Scenario: Collapse on double-click
- **WHEN** a retro window's body is visible and its titlebar is double-clicked
- **THEN** the body is hidden and the titlebar stays visible

#### Scenario: Restore on second double-click
- **WHEN** a collapsed retro window's titlebar is double-clicked again
- **THEN** the body becomes visible again

### Requirement: Close remains available while collapsed

Collapsing to titlebar-only SHALL NOT disable the close control.

#### Scenario: Close a collapsed window
- **WHEN** a collapsed retro window's close button is clicked
- **THEN** the window's onClose is invoked
