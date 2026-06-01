# UI System Design

Full-featured node-based UI system for ku game engine. Serves both in-game HUDs/menus and application-style interfaces (editors, forms, data tables).

## Node Type Hierarchy

```
Node (existing)
├── Node2D (existing — world nodes)
│   ├── Sprite, AnimatedSprite, RigidBody, Area, etc.
│   └── Camera2D
├── CanvasLayer (NEW — rendering plane)
└── Control (NEW — base for all UI)
    ├── Panel (migrated)
    ├── Button (migrated)
    ├── ImageRect (migrated)
    ├── ScrollView (migrated)
    ├── Label (migrated)
    ├── Slider (new P1)
    ├── Toggle (new P1)
    ├── ListItem (new P2)
    ├── Grid (new P2)
    ├── TreeView (new P2)
    ├── Splitter (new P2)
    ├── Accordion (new P2)
    ├── TextInput (new P2)
    └── TextArea (new P2)
```

**Key decisions**:
- `Control` extends `Node` directly (not `Node2D`) — UI nodes live in parent-relative space, not world space
- `CanvasLayer` extends `Node` — sits between world and screen, defines an independent rendering plane
- Existing GUI types become `Control` children
- `Block` stays as world-space Node2D (not migrated)

## Anchor System

Anchors are 0-1 fractions of parent rect. Margins are pixel offsets from anchor positions. Final rect:

```
left   = parent_width  * anchor_left   + margin_left
right  = parent_width  * anchor_right  + margin_right
top    = parent_height * anchor_top    + margin_top
bottom = parent_height * anchor_bottom + margin_bottom
```

### Anchor Presets

| Preset | anchor_left | anchor_right | anchor_top | anchor_bottom |
|--------|-------------|--------------|------------|---------------|
| `fullscreen` | 0 | 1 | 0 | 1 |
| `top_left` | 0 | 0 | 0 | 0 |
| `top_right` | 1 | 1 | 0 | 0 |
| `bottom_left` | 0 | 0 | 1 | 1 |
| `bottom_right` | 1 | 1 | 1 | 1 |
| `center` | 0.5 | 0.5 | 0.5 | 0.5 |
| `left_wide` | 0 | 0 | 0 | 1 |
| `top_wide` | 0 | 1 | 0 | 0 |
| `right_wide` | 1 | 1 | 0 | 1 |
| `bottom_wide` | 0 | 1 | 1 | 1 |
| `vcenter_wide` | 0 | 1 | 0.5 | 0.5 |
| `hcenter_wide` | 0.5 | 0.5 | 0 | 1 |

Presets write all 4 anchors + 4 margins at once. After applying preset, margins can be adjusted individually.

### Migration Compatibility

Old nodes without anchors render at absolute `x, y`. Anchors default to all-zero with margins set to `[x, y, x+width, y+height]`. Result: identical layout to current behavior. Setting any `anchor_*` property opts into anchored layout.

## CanvasLayer

Defines an independent rendering plane between world and screen. Multiple CanvasLayers stack by `layer` int (lower = behind).

```
CanvasLayer properties:
  layer: 0                // render order (-128..127)
  follow_viewport: true   // false = independent of camera
  offset_x: 0            // pixel offset from viewport
  offset_y: 0
  scale: 1.0             // uniform scale for this layer
  visible: true
```

**Use cases**:
- HUD layer (follow_viewport=true, layer=1) — moves with camera
- Parallax layer (follow_viewport=false, scale=0.5) — independent scroll
- Screen overlay (root Controls) — pause menu, toast notifications

### Viewport (P2 only)

Viewport node renders a subtree to an offscreen canvas texture. Used for minimaps, split-screen, or render-to-texture effects. Deferred to P2 — depends on offscreen canvas support in `@napi-rs/canvas`.

```
Viewport properties:
  width, height          // offscreen canvas size
  render_target: true    // false = don't render to texture
  transparent_bg: false
  world_2d: ''           // optional separate scene path
```

## Container Layout System

Containers are Control nodes that run layout algorithms on children.

### Size Flags (on every Control)

```
size_flags_horizontal: 'fill'    // fill | expand | shrink
size_flags_vertical: 'fill'      // fill | expand | shrink
```

- `fill`: take allocated space
- `expand`: grow to share extra space (flex-grow equivalent)
- `shrink`: take minimum size only

### Container Types

**VBoxContainer** — children stacked vertically.
```
  separation: 4      // pixel gap between children
```
Layout: sum children min heights + separation. Distribute remaining space to `expand` children. Width = max child width.

**HBoxContainer** — children stacked horizontally.
```
  separation: 4
```
Layout: mirror of VBox horizontally.

**MarginContainer** — single child with padding.
```
  padding_left: 0, padding_right: 0
  padding_top: 0, padding_bottom: 0
```
Layout: child rect = self rect minus padding. Named `padding_*` to avoid confusion with Control's anchor `margin_*`.

**CenterContainer** — single child centered.
```
  use_top_left: false   // false = center, true = top-left
```
Layout: child placed at center of container minus half child size.

### Layout Resolution

Runs before rendering each frame:
1. Parent container queries each child's `min_size`
2. Distributes space based on container rules + size_flags
3. Writes computed `width`/`height`/`x`/`y` to each child's `_computed`
4. Children render at computed positions

## Control Base Properties

Every Control node has:

```
// Anchoring
anchor_left: 0, anchor_right: 0, anchor_top: 0, anchor_bottom: 0
margin_left: 0, margin_right: 0, margin_top: 0, margin_bottom: 0

// Growth direction (when parent gives more space than min)
grow_horizontal: 'end'       // begin | center | end
grow_vertical: 'end'         // begin | center | end

// Layout hints
size_flags_horizontal: 'fill'  // fill | expand | shrink
size_flags_vertical: 'fill'

// Minimum size
min_size: { width: 0, height: 0 }

// Focus
focus_mode: 'none'            // none | click | all
focus_next: ''                // explicit path
focus_previous: ''            // explicit path

// Common
visible: true
modal: false                  // capture all input + darken background
```

## Widget Specifications

### Phase 1 Widgets

**Panel** (migrated from existing)
```
Existing props unchanged. Gains Control base properties.
Colored rect with optional border/radius. No behavior change.
```

**Button** (migrated from existing)
```
Existing props + Control base. New props:
  disabled: false        // grey out, ignore input
  toggle_mode: false     // act as toggle (stays pressed)
  pressed: false         // toggle state (when toggle_mode=true)
  action: ''             // script event name to emit on click
Events: on_gui_click with { node, pressed, toggle_mode }
```

**ImageRect** (migrated from existing)
```
Existing props unchanged + Control base. No behavior change.
```

**Label** (migrated from existing)
```
Existing props + Control base. New props:
  align: 'left'          // left | center | right
  valign: 'top'          // top | center | bottom
  autowrap: false        // word wrap within width
```

**ScrollView** (migrated from existing)
```
Existing props + Control base. clip renamed to clip_content.
Scroll offset applies to children positions during render.
```

**Slider** (new)
```
  min_value: 0
  max_value: 100
  value: 0
  step: 1
  orientation: 'horizontal'   // horizontal | vertical
  direction: 'left_to_right'  // right_to_left, top_to_bottom, bottom_to_top
  track_color: '#3a3a5e'
  fill_color: '#6a6aff'
  handle_color: '#ffffff'
  handle_size: 12
Events: on_value_change with { value }
```

**Toggle** (new)
```
  pressed: false
  group: ''              // radio group name (empty = checkbox)
  on_color: '#6a6aff'
  off_color: '#3a3a5e'
  label: ''              // text beside toggle
Events: on_toggle with { pressed }
Radio behavior: same group → only one pressed at a time.
```

### Phase 2 Widgets

**ListItem**
```
  text: ''
  icon: ''               // optional texture path
  selected: false
  selectable: true
Container: used inside ListContainer (VBoxContainer with selection logic)
Events: on_select, on_deselect
```

**Grid**
```
  columns: 1
  column_spacing: 4
  row_spacing: 4
  column_min_width: 0    // 0 = auto
Children laid out in row-major grid.
```

**TreeView**
```
  data: []               // hierarchical JSON array
  selected_item: ''
  indent: 16             // pixels per level
  item_height: 24
Events: on_item_select with { path, item }
Custom renderer — not a container, draws its own items.
```

**Splitter**
```
  split_offset: 0        // position of split handle
  min_split: 0           // minimum size for first pane
  max_split: 0           // maximum (0 = unlimited)
  orientation: 'horizontal'
  split_color: '#555555'
Events: on_split_moved with { offset }
Exactly 2 children — left/top + right/bottom.
```

**Accordion**
```
  expanded_section: -1   // index, -1 = all collapsed
  section_header_height: 28
  section_spacing: 2
Events: on_section_toggle with { index, expanded }
Children treated as sections. First child of each section = header (clickable).
```

**TextInput**
```
  text: ''
  placeholder: ''
  max_length: 0          // 0 = unlimited
  editable: true
  caret_position: 0
  selection_start: 0
  secret: false          // password mode (shows bullets)
Events: on_text_change, on_text_submit (enter key)
Requires keyboard focus system.
```

**TextArea** (extends TextInput concept)
```
  text: ''
  wrap_mode: 'word'      // word | char | off
  scrollable: true
  line_count: 0          // 0 = auto from height
Same events as TextInput.
```

## Focus System

```
FocusManager (module, not a node):
  focused_node: Node | null
  focus_stack: Node[]          // for focus trapping in modal
```

`focus_mode` on each Control: `'none'` | `'click'` | `'all'`
- `none` = never receives focus (Panel, Label)
- `click` = focus on click (Button, Slider)
- `all` = focus on click + keyboard nav (TextInput, TextArea)

**Focus chain**: `focus_next` / `focus_previous` explicit paths. If not set, tree-order traversal finds next/previous Control with `focus_mode != 'none'`.

**Keyboard navigation**: Tab/Shift+Tab walks focus chain. Arrow keys navigate within containers (Grid, TreeView).

**Modal**: `modal: true` on Control blocks input to everything behind. Focus traps within modal subtree.

## Input Routing Pipeline

```
1. Raw input event arrives (key, mouse, touch)
2. Focus check: if key event → route to focused_node first
3. GUI hit test (screen space):
   a. Find topmost Control under cursor
   b. Walk up to find handler for event type
   c. If node has matching script trigger → execute
   d. If event consumed (stop_propagation) → stop
4. World hit test (camera space): same as current
5. Unhandled: route to global scripts
```

**Event consumption**: `stop_propagation: false` on events. Set true in handler to stop bubbling.

**Control events**:
```
on_gui_click      → mouse button down + up on same node
on_gui_input      → any mouse/touch event while hovered
on_mouse_enter    → cursor enters node rect
on_mouse_exit     → cursor leaves node rect
```

Existing `on_touch_start`, `on_key` events unchanged for non-UI world-space nodes.

## Rendering Pipeline

Modified from 2-pass to 3-pass:

```
Renderer.draw(tree):
  1. Clear screen
  2. Disable image smoothing
  3. Handle stretch mode (existing)

  4. WORLD PASS (existing, unchanged):
     - Apply Camera2D transform
     - drawNodeRecursive for non-GUI, non-CanvasLayer children
     - Draw debug overlay
     - Restore transform

  5. CANVAS LAYER PASSES (new):
     - Collect all CanvasLayer nodes from root children
     - Sort by layer property ascending
     - For each CanvasLayer:
       a. Save context
       b. If follow_viewport: apply camera offset + layer offset/scale
       c. Else: apply only layer offset/scale
       d. drawControlTree for each Control child
       e. Restore context

  6. GUI PASS (modified):
     - Draw root-level Control nodes (not inside any CanvasLayer)
     - Screen-space, no camera, no layer transform
     - Sorted by tree order (last = on top)

  7. Present to window
```

**drawControlTree(node)**:
```
1. Compute node rect from anchors + margins + parent rect
2. Cache computed rect on node._computed (for hit testing)
3. Render node by type (panel, button, label, etc.)
4. If container: compute child rects via layout algorithm
5. For each child: recurse drawControlTree
6. If ScrollView: apply clip before children, restore after
```

## Computed Rect Caching

Each Control gets internal `_computed` after layout resolution:

```
_computed: {
  x, y, width, height    // absolute screen-space rect
  parent_rect             // reference to parent's _computed
}
```

Used by renderer (where to draw), hit testing (point-in-rect), layout (parent reads children's min_size and _computed), and script expressions (`{{/node/width}}`).

## Theme System

One Theme node per scene (optional). All Controls look up unresolved style properties from theme before falling back to defaults.

```
Theme node properties:
  colors: {
    bg_color: '#1a1a2e'
    fg_color: '#ffffff'
    accent_color: '#6a6aff'
    error_color: '#ff4444'
    disabled_color: '#666666'
    border_color: '#555555'
  }
  font_size: {
    normal: 14
    small: 12
    large: 18
    title: 24
  }
  constants: {
    margin: 8
    spacing: 4
    corner_radius: 4
    border_width: 1
  }
```

**Resolution order** for a style property:
1. Node's own property (e.g. `node.color`)
2. Theme override for type+property (e.g. `theme.Button.color`)
3. Theme default (e.g. `theme.colors.bg_color`)
4. Factory default (hardcoded in node-types.ts)

If no Theme node exists, factory defaults apply everywhere.

## Phasing

### P1: UI Foundation
- Control base type with anchor system
- CanvasLayer node
- Container layout engine (VBox, HBox, Margin, Center)
- Migrate Panel, Button, ImageRect, ScrollView, Label to Control
- Slider + Toggle widgets
- FocusManager + keyboard nav
- Modified rendering pipeline (3-pass)
- Computed rect caching
- Theme node (basic colors + constants)
- Hit test update for Control nodes
- Script events: on_gui_click, on_gui_input, on_mouse_enter/exit

### P2: Advanced Widgets
- ListItem + ListContainer
- Grid container
- TreeView
- Splitter
- Accordion
- TextInput + TextArea
- Viewport node (offscreen render)

### P3: Polish
- Theme inheritance / multiple themes
- Animation integration (animate Control properties)
- Accessibility: tab order hints, minimum tap target enforcement
- Debug overlay for Control rects

## File Changes

| File | Change |
|------|--------|
| `src/engine/node-types.ts` | Add Control, CanvasLayer, VBoxContainer, HBoxContainer, MarginContainer, CenterContainer, Slider, Toggle, Theme factories. Migrate existing GUI types to Control-based. |
| `src/engine/layout.ts` | **NEW** — Layout resolver. Computes rects from anchors + container rules. |
| `src/engine/focus.ts` | **NEW** — FocusManager module. Focus chain, keyboard nav. |
| `src/engine/anchor.ts` | **NEW** — Anchor presets, rect computation from anchor + margin. |
| `src/engine/hit-test.ts` | Update to use `_computed` rects for Control nodes. Two-pass stays. |
| `src/engine/script-engine.ts` | Add on_gui_input, on_mouse_enter, on_mouse_exit events. stop_propagation support. |
| `src/engine/types.ts` | Add ControlData, AnchorPreset, SizeFlags types. |
| `src/renderer/renderer.ts` | 3-pass pipeline: world → canvas layers → GUI. Call layout resolver before draw. |
| `src/renderer/gui-renderer.ts` | Add Slider, Toggle renderers. Update existing to use _computed rects. |
| `src/renderer/label-renderer.ts` | Use _computed rect for Label positioning. |
| `src/server/input-manager.ts` | Route through FocusManager. Add on_mouse_enter/exit tracking. |
| `src/server/message-handler.ts` | Support Theme node CRUD. Focus queries. |

**Note**: P2 widgets (Grid, TreeView, Splitter, Accordion, TextInput, TextArea) will add their own renderer updates and new node type factories when implemented. File changes above cover P1 scope.

## Testing

- `test/layout.test.ts` — VBox/HBox distribution, expand/shrink, nested containers, MarginContainer, CenterContainer
- `test/anchor.test.ts` — All presets, margin offsets, edge cases
- `test/focus.test.ts` — Focus chain, modal trapping, keyboard nav
- `test/control-migration.test.ts` — Old scenes render identically with no anchors set
- `test/canvas-layer.test.ts` — Layer ordering, follow_viewport, offset/scale
