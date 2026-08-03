# retro-window-state Specification

## Purpose
Gives host-mounted retro panels window-like state: they remember where the user put
them, stay within the visible viewport, and come to the front when clicked.
## Requirements
### Requirement: Panel position is remembered across reopen

When persistence is available, the host SHALL save a panel's position after the user
drags it and restore that position the next time the same panel is opened. With no
persistence available, the host SHALL fall back to a default position and never error.

#### Scenario: Dragged position is restored
- **WHEN** a panel is dragged to a new position, closed, and reopened
- **THEN** it reopens at the position it was last dragged to

#### Scenario: First open uses a default position
- **WHEN** a panel with no saved position is opened
- **THEN** it opens at the default position

### Requirement: Restored position is clamped to the viewport

A restored position SHALL be constrained so the panel's title bar stays within the
current viewport, even if the window was smaller or the panel was dragged partly
off-screen in a previous session.

#### Scenario: Off-screen saved position is pulled back in
- **WHEN** a saved position lies outside the current viewport bounds
- **THEN** the panel opens at a clamped position inside the viewport

### Requirement: Clicking a panel raises it to the front

When the user presses on any part of a panel, that panel SHALL be brought above all
other open panels in stacking order.

#### Scenario: Clicked panel comes forward
- **WHEN** two panels overlap and the user presses on the rear one
- **THEN** the pressed panel's stacking order becomes the highest among open panels

