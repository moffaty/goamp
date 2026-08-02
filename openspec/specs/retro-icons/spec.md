# retro-icons Specification

## Purpose
Provides a small pack of named pixel-art (inline-SVG) glyphs in the Winamp visual
idiom, and lets registry-registered context-menu items display one before their
label so panel entry points read as retro icons rather than bare text.
## Requirements
### Requirement: Named glyph lookup

The icon pack SHALL expose glyphs by name and return inline SVG markup for a known
name. It SHALL include at minimum the glyphs `close`, `charts`, `peers`, `folder`,
and `note`.

#### Scenario: Known glyph resolves to markup
- **WHEN** a caller requests a glyph by a name present in the pack (e.g. `charts`)
- **THEN** it receives non-empty inline SVG markup for that glyph

#### Scenario: Unknown glyph resolves to empty
- **WHEN** a caller requests a glyph name not present in the pack
- **THEN** it receives an empty string (no markup, no error)

### Requirement: Menu items may carry an optional icon

A registered context-menu item MAY declare an icon by glyph name. Items that do not
declare one SHALL behave and render exactly as before this change.

#### Scenario: Item registered with an icon
- **WHEN** a feature registers a menu item and supplies a glyph name
- **THEN** the item carries that glyph name through to rendering

#### Scenario: Item registered without an icon
- **WHEN** a feature registers a menu item and supplies no glyph name
- **THEN** the item renders with its label only, identical to prior behavior

### Requirement: Context menu renders the glyph before the label

When the goamp context menu renders a menu item that carries a known glyph name, it
SHALL display that glyph immediately before the item's label. An item with no glyph,
or an unknown glyph name, SHALL render label-only with no gap artifact.

#### Scenario: Icon-bearing item shows its glyph
- **WHEN** the context menu renders an item whose glyph name is in the pack
- **THEN** the item's row shows the glyph's SVG ahead of the label text

#### Scenario: Icon-less item is unchanged
- **WHEN** the context menu renders an item with no glyph name
- **THEN** the row shows only the label, matching the pre-change layout

