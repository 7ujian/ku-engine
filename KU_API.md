# ku Engine API Reference

## Node Types

All 14 built-in node types with their properties and defaults.

### Node

Base container node. No spatial transform.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `position` | `{x, y}` | `{x:0, y:0}` | Internal position |
| `rotation` | number | `0` | Rotation (degrees) |
| `scale` | number | `1` | Uniform scale |

### Node2D

Spatial node with 2D transform. All renderable/physics nodes extend this.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `x` | number | `0` | Local X position |
| `y` | number | `0` | Local Y position |
| `rotation` | number | `0` | Rotation (radians) |
| `scale_x` | number | `1` | X scale factor |
| `scale_y` | number | `1` | Y scale factor |
| `visible` | boolean | `true` | Render visibility |

### Sprite

Displays a texture or atlas region.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `texture` | string | `''` | Texture file path |
| `flip_h` | boolean | `false` | Horizontal flip |
| `flip_v` | boolean | `false` | Vertical flip |
| `frame` | number | `0` | Current frame index |
| `hframes` | number | `1` | Horizontal frame count |
| `atlas` | string | `''` | Atlas identifier |
| `region` | string | `''` | Atlas region name |

### AnimatedSprite

Frame-based animation from atlas.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `frames` | number[] | `[]` | Frame indices |
| `speed` | number | `10` | Frames per second |
| `playing` | boolean | `false` | Is animating |
| `atlas` | string | `''` | Atlas identifier |
| `animations` | object | `{}` | Named animation definitions |
| `animation` | string | `''` | Current animation name |

### RigidBody

Physics-driven body. Receives gravity, collisions, velocity.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `x` | number | `0` | Position X |
| `y` | number | `0` | Position Y |
| `velocity` | `{x, y}` | `{x:0, y:0}` | Velocity vector |
| `mass` | number | `1` | Body mass |
| `width` | number | `32` | Collision rectangle width |
| `height` | number | `32` | Collision rectangle height |
| `gravity_scale` | number | `1` | Gravity multiplier (0 = no gravity) |
| `linear_damping` | number | `0` | Velocity damping |
| `rotation` | number | `0` | Rotation (radians) |
| `scale_x` | number | `1` | X scale |
| `scale_y` | number | `1` | Y scale |
| `collision_layer` | number | `0x0001` | Category bitmask |
| `collision_mask` | number | `0xFFFF` | Filter bitmask |
| `color` | string | `'#ffff00'` | Debug overlay color |

### Area

Detection zone (sensor, no physical response). Fires overlap events.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `x` | number | `0` | Position X |
| `y` | number | `0` | Position Y |
| `width` | number | `32` | Area width |
| `height` | number | `32` | Area height |
| `monitorable` | boolean | `true` | Can be detected |
| `collision_layer` | number | `0x0001` | Category bitmask |
| `collision_mask` | number | `0xFFFF` | Filter bitmask |

### CollisionShape

Defines a collision shape. Can be child of RigidBody (follows parent) or standalone.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `shape` | string | `'rect'` | Shape type: `rect` or `circle` |
| `width` | number | `32` | Rectangle width |
| `height` | number | `32` | Rectangle height |
| `radius` | number | `0` | Circle radius |
| `x` | number | `0` | Local offset X |
| `y` | number | `0` | Local offset Y |
| `dynamic` | boolean | `false` | Static if false |
| `collision_layer` | number | `0x0001` | Category bitmask |
| `collision_mask` | number | `0xFFFF` | Filter bitmask |
| `color` | string | `'#33cc33'` | Debug overlay color |

### Camera2D

Follows a node. The renderer centers on the first Camera2D found.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `zoom` | number | `1` | Zoom level |
| `offset_x` | number | `0` | Horizontal offset |
| `offset_y` | number | `0` | Vertical offset |
| `smoothing` | number | `0` | Smoothing factor |

### Label

Renders text at the node's position.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `text` | string | `''` | Display text |
| `font_size` | number | `16` | Size in pixels |
| `color` | string | `'#ffffff'` | Text color |

### TileMap

Grid-based tile rendering.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `tileset` | string | `''` | Tileset identifier |
| `cell_size` | number | `16` | Tile size in pixels |
| `columns` | number | `0` | Grid columns |
| `rows` | number | `0` | Grid rows |
| `data` | string | `''` | Serialized tile indices |

### Timer

Fires `on_timer` events at intervals.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `wait_time` | number | `1` | Interval in seconds |
| `one_shot` | boolean | `false` | Fire once then stop |
| `autostart` | boolean | `false` | Start on scene load |
| `playing` | boolean | `false` | Is running |

### AudioPlayer

Plays WAV audio files.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `stream` | string | `''` | Audio file path |
| `volume` | number | `1` | Volume (0-1) |
| `playing` | boolean | `false` | Is playing |

### AnimationPlayer

Drives property animations on a target node. No visual output of its own — writes interpolated values to the target each frame.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `target` | string | `''` | Path to node being animated |
| `animations` | object | `{}` | Named animation definitions |
| `current` | string | `''` | Currently playing animation name |
| `playing` | boolean | `false` | Playback state |
| `speed` | number | `1` | Playback speed multiplier |
| `loop` | boolean | `false` | Loop playback |

#### Animation Definition

Each named animation has a `duration` (seconds), optional `loop` override, and `tracks` mapping property names to keyframe sequences:

```json
{
  "animations": {
    "jump": {
      "duration": 0.6,
      "loop": false,
      "tracks": {
        "y": {
          "keyframes": [
            { "t": 0, "value": 250 },
            { "t": 0.15, "value": 150 },
            { "t": 0.45, "value": 150 },
            { "t": 0.6, "value": 250 }
          ],
          "easing": "ease_out"
        },
        "rotation": {
          "keyframes": [
            { "t": 0, "value": 0 },
            { "t": 0.3, "value": -0.5 }
          ]
        }
      }
    }
  }
}
```

Each track key (`"y"`, `"rotation"`, `"scale_x"`, `"frame"`, etc.) is a property path on the target node. The `t` values are normalized progress (0 to 1). Between keyframes, values are linearly interpolated after applying the easing function.

Each track can optionally specify a `target` property to override the AnimationPlayer's default target for that track. This allows a single AnimationPlayer to drive properties on multiple nodes simultaneously. When `target` is omitted, the track applies to the AnimationPlayer's `target` node.

```json
{
  "pop_in": {
    "duration": 0.4,
    "loop": false,
    "tracks": {
      "scale_x": {
        "target": "panel",
        "keyframes": [
          { "t": 0, "value": 0 },
          { "t": 0.6, "value": 1.2 },
          { "t": 1, "value": 1 }
        ],
        "easing": "ease_out"
      },
      "scale_y": {
        "keyframes": [
          { "t": 0, "value": 0 },
          { "t": 0.6, "value": 1.2 },
          { "t": 1, "value": 1 }
        ],
        "easing": "ease_out"
      },
      "rotation": {
        "target": "panel/icon",
        "keyframes": [
          { "t": 0, "value": 0 },
          { "t": 1, "value": 6.28 }
        ],
        "easing": "linear"
      }
    }
  }
}
```

#### Easing Functions

| Name | Curve |
|------|-------|
| `linear` | Uniform (default) |
| `ease_in` | Quadratic ease in |
| `ease_out` | Quadratic ease out |
| `ease_in_out` | Quadratic ease in/out |
| `bounce` | Bounce at end |

#### Events

| Event | Data | When |
|-------|------|------|
| `on_animation_finished` | `{animation, node}` | Non-looping animation completes |

### Block

Visual-only colored rectangle. No physics body. Useful for backgrounds, platforms, and UI elements.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `width` | number | `32` | Rectangle width |
| `height` | number | `32` | Rectangle height |
| `color` | string | `'#ffffff'` | Fill color |
| `visible` | boolean | `true` | Render visibility |

---

## Script System

Scripts are JSON rules attached to nodes. Each rule has an event trigger, optional filter/condition, and a list of actions.

### Rule Structure

```json
{
  "event": "on_key",
  "name": "jump",
  "filter": { "key": "SPACE" },
  "condition": { "grounded": { "eq": true } },
  "actions": [
    { "set": "velocity.y", "to": -250 },
    { "set": "grounded", "to": false }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `event` | yes | Event name that triggers the rule |
| `name` | no | Named rules can be called via `call` action |
| `filter` | no | Match event data fields |
| `condition` | no | Check node properties |
| `actions` | yes | Actions to execute in order |

---

## Events

### Input Events

| Event | Data | Triggered by |
|-------|------|--------------|
| `on_key` | `{key}` | Key press (first press, no repeat) |
| `on_key_up` | `{key}` | Key release |
| `on_click` | `{x, y}` | Mouse click |
| `on_axis` | `{name, value}` | Analog axis |
| `on_touch_start` | `{x, y, pointerId}` | Touch begin |
| `on_touch_move` | `{x, y, pointerId}` | Touch move |
| `on_touch_end` | `{x, y, pointerId}` | Touch end |

### Game Loop Events

| Event | Data | Triggered by |
|-------|------|--------------|
| `on_enter` | `{}` | Scene loaded / game starts |
| `on_frame` | `{frame, dt}` | Every frame (60 FPS) |
| `on_timer` | `{timer}` | Timer node fires |

### Collision Events

| Event | Data | Triggered by |
|-------|------|--------------|
| `on_collision` | `{node, other, otherTags}` | Bodies start overlapping |
| `on_collision_exit` | `{node, other, otherTags}` | Bodies stop overlapping |
| `on_area_enter` | `{node, other, otherTags}` | Entity enters Area |
| `on_area_exit` | `{node, other, otherTags}` | Entity exits Area |

### Custom Events

Any string can be used as an event name, emitted via the `emit` action:

```json
{ "emit": "scored", "data": { "points": 100 } }
```

```json
{
  "event": "scored",
  "actions": [{ "set": "total", "to": "{{total + 1}}" }]
}
```

---

## Filters

Filters match event data fields by exact value. The special `with` filter matches collisions flexibly:

```json
{ "filter": { "key": "SPACE" } }
{ "filter": { "with": "enemy" } }
```

`with` matches by: other node ID, tag in `otherTags` array, or `data.with` value.

---

## Conditions

Conditions check node properties before executing actions. All conditions must pass (AND logic).

```json
{ "condition": { "hp": { "gt": 0 }, "dead": { "neq": true } } }
```

| Operator | Value | Example |
|----------|-------|---------|
| `eq` | any | `{ "active": { "eq": true } }` |
| `neq` | any | `{ "dead": { "neq": true } }` |
| `gt` | number | `{ "x": { "gt": 100 } }` |
| `lt` | number | `{ "y": { "lt": 0 } }` |
| `gte` | number | `{ "score": { "gte": 10 } }` |
| `lte` | number | `{ "hp": { "lte": 0 } }` |
| `in` | array | `{ "key": { "in": ["UP", "DOWN"] } }` |
| `between` | [min, max] | `{ "x": { "between": [0, 640] } }` |

---

## Actions

### set

Set property on the current node.

```json
{ "set": "velocity.y", "to": -250 }
{ "set": "score", "to": "{{score + 1}}" }
{ "set": "text", "to": "HP: {{hp}}" }
```

### set_on

Set property on another node.

```json
{ "set_on": "/ui/score_label", "key": "text", "to": "{{score}}" }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `set_on` | string | Target node path |
| `key` | string | Property name on target |
| `to` | any | Value (supports expressions) |

### move

Add offset to current position.

```json
{ "move": { "x": -2.5, "y": 0 } }
```

### move_toward

Move toward target at constant speed per frame.

```json
{ "move_toward": { "x": 300, "y": 200, "speed": 5 } }
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `x` | number | required | Target X |
| `y` | number | required | Target Y |
| `speed` | number | `3` | Pixels per frame |

### spawn

Create a new node.

```json
{
  "spawn": "CollisionShape",
  "as": "bullet_0",
  "at": { "x": 100, "y": 200 },
  "properties": { "width": 8, "height": 14, "color": "#ffff00" },
  "scripts": [{ "event": "on_frame", "actions": [{ "move": { "x": 0, "y": -5 } }] }]
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `spawn` | string | required | Node type |
| `as` | string | `"{type}_{ts}"` | Node ID |
| `at.x` | number | current `x` | Spawn X |
| `at.y` | number | current `y` | Spawn Y |
| `properties` | object | `{}` | Initial properties |
| `scripts` | array | `[]` | Script rules |

### destroy

Remove a node.

```json
{ "destroy": "self" }
{ "destroy": "{{other}}" }
{ "destroy": "/enemies/drone1" }
```

`"self"` destroys the current node.

### emit

Fire a custom event.

```json
{ "emit": "game_over", "data": { "score": 100 } }
```

### call

Invoke a named script rule on the same node.

```json
{ "call": "reset_game" }
```

The target rule must have a `name` field matching the call.

### play

Start animation or audio playback.

```json
{ "play": "explosion_sound" }
{ "play": "/player/sprite", "from": 0 }
```

### stop

Stop animation or audio.

```json
{ "stop": "bgm" }
```

### change_scene

Load a different scene. Fires `on_enter` on all nodes in the new scene.

```json
{ "change_scene": "level2" }
```

### animate

Start an animation on an AnimationPlayer node.

```json
{ "animate": "jump", "on": "/player/anims" }
{ "animate": "walk", "on": "/player/anims", "animate_speed": 1.5 }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `animate` | string | Animation name (from `animations`) |
| `on` | string | Path to AnimationPlayer node |
| `animate_speed` | number | Optional speed multiplier override |

### animate_stop

Stop an AnimationPlayer.

```json
{ "animate_stop": "/player/anims" }
```

### log

Print to server stdout.

```json
{ "log": "Score: {{score}}" }
```

---

## Expressions

Expressions use `{{...}}` template syntax. If the entire value is a single `{{expr}}`, the raw value is returned (not stringified).

### Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `+` | Add / concatenate | `{{score + 1}}` |
| `-` | Subtract | `{{hp - 10}}` |
| `*` | Multiply | `{{speed * dt}}` |
| `/` | Divide | `{{distance / 60}}` |
| `%` | Modulo | `{{frame % 4}}` |
| `-val` | Negate | `{{-velocity.y}}` |

### Symbol Resolution

| Syntax | Resolves to | Example |
|--------|-------------|---------|
| `name` | Current node property | `{{score}}` |
| `path.to.prop` | Nested property | `{{velocity.x}}` |
| `/node/path` | Cross-node reference | `{{/player/score}}` |
| `/node/path.prop` | Cross-node nested | `{{/player/velocity.x}}` |
| `other` | Event context (collision partner ID) | `{{other}}` |
| `otherTags` | Tags array from other node | `{{otherTags}}` |

### Functions

| Function | Returns | Example |
|----------|---------|---------|
| `random(min, max)` | Random float in [min, max) | `{{random(0, 640)}}` |
| `min(a, b)` | Minimum | `{{min(hp, 100)}}` |
| `max(a, b)` | Maximum | `{{max(x, 0)}}` |
| `abs(val)` | Absolute value | `{{abs(velocity.x)}}` |
| `floor(val)` | Round down | `{{floor(x / 32)}}` |
| `ceil(val)` | Round up | `{{ceil(hp / 10)}}` |

---

## JS Scripting

For complex logic beyond JSON scripts, nodes can reference JS files:

```json
{ "js_script": "scripts/player.js" }
```

JS scripts run in a sandboxed VM. Each node with a `js_script` gets its own isolated execution context. Scripts register event handlers on the global `handlers` object.

### Handler Registration

```javascript
handlers.on_frame = function(ctx) { ... };
handlers.on_key = function(ctx) { ... };
handlers.on_collision = function(ctx) { ... };
// Any event name works: handlers.on_enter, handlers.on_timer, custom events
```

Unregistered events are silently ignored. A node can have both JSON `scripts` and a `js_script` — they run independently.

### Context API

| API | Returns | Description |
|-----|---------|-------------|
| `ctx.node.id` | `string` | Current node ID |
| `ctx.node.type` | `string` | Current node type |
| `ctx.node.get(prop)` | `any` | Get property (dot-path: `"velocity.x"`) |
| `ctx.node.set(prop, val)` | `void` | Set property on current node |
| `ctx.scene.get(path, prop)` | `any` | Get property on another node (path: `"/player/x"`) |
| `ctx.scene.set(path, prop, val)` | `void` | Set property on another node |
| `ctx.scene.spawn(type, id, props?)` | `void` | Create node as child of root. **Note:** returns void; use the `id` you passed to reference the node later |
| `ctx.scene.destroy(path)` | `void` | Remove node by path |
| `ctx.scene.find(path)` | `object\|null` | Get node handle `{id, type, get, set}` |
| `ctx.emit(name, data?)` | `void` | Emit custom event (received by JSON scripts and JS handlers) |
| `ctx.log(...args)` | `void` | Print to script log (view with `ku query logs`) |
| `ctx.dt` | `number` | Delta time in ms since last frame |
| `ctx.data` | `object` | **Persistent per-node state** + event data (see below) |

### Per-Node State (`ctx.data`)

`ctx.data` is a shared object that persists between handler calls for the same node. It starts empty `{}` and is not reset between frames. Use it for counters, timers, flags, or any state that survives across events:

```javascript
handlers.on_frame = function(ctx) {
  // Initialize once
  if (!ctx.data.speed) ctx.data.speed = 100;

  // Accumulate across frames
  ctx.data.distance = (ctx.data.distance || 0) + ctx.data.speed * (ctx.dt / 1000);

  if (ctx.data.distance > 500) {
    ctx.log('Reached 500m!');
    ctx.data.distance = 0; // Reset
  }
};
```

Event data is merged into `ctx.data` for each handler call. For example, `on_key` sets `ctx.data.key`, but your persistent fields (`ctx.data.speed`) remain intact:

```javascript
handlers.on_key = function(ctx) {
  ctx.log('Key: ' + ctx.data.key);       // event data
  ctx.log('Speed: ' + ctx.data.speed);   // persistent state
};
```

### Event Data by Type

| Event | `ctx.data` fields |
|-------|-------------------|
| `on_key` / `on_key_up` | `key` |
| `on_click` | `x`, `y` |
| `on_axis` | `name`, `value` |
| `on_touch_*` | `x`, `y`, `pointerId` |
| `on_frame` | `frame` (use `ctx.dt` for delta) |
| `on_collision` / `on_collision_exit` | `node`, `other`, `otherTags` |
| `on_area_enter` / `on_area_exit` | `node`, `other`, `otherTags` |
| `on_timer` | `timer` (timer node ID) |
| `on_animation_finished` | `animation`, `node` |

### Complete Example: Movement + Collision

```javascript
// scripts/player.js
handlers.on_frame = function(ctx) {
  if (!ctx.data.vx) ctx.data.vx = 0;

  // Apply gravity
  var vy = ctx.node.get('velocity.y') || 0;
  ctx.node.set('velocity.y', vy + 200 * (ctx.dt / 1000));

  // Horizontal movement
  ctx.node.set('velocity.x', ctx.data.vx);
};

handlers.on_key = function(ctx) {
  if (ctx.data.key === 'LEFT') ctx.data.vx = -100;
  if (ctx.data.key === 'RIGHT') ctx.data.vx = 100;
  if (ctx.data.key === 'SPACE') ctx.node.set('velocity.y', -250);
};

handlers.on_key_up = function(ctx) {
  if (ctx.data.key === 'LEFT' || ctx.data.key === 'RIGHT') ctx.data.vx = 0;
};

handlers.on_collision = function(ctx) {
  if (ctx.data.otherTags.indexOf('coin') >= 0) {
    ctx.scene.destroy(ctx.data.other);
    ctx.emit('coin_collected', { from: ctx.node.id });
  }
};
```

### Reading Script Logs

```bash
ku query logs          # View all script log output
ku query logs --clear  # View and clear logs
```

---

## Physics

### Coordinate System

- Origin at top-left of window
- X increases right, Y increases down
- Rotation in radians, counter-clockwise positive
- Transforms compose hierarchically (child relative to parent)

### Collision Layers

Collision filtering uses bitmasks. Two bodies collide when:

```
(bodyA.collision_layer & bodyB.collision_mask) !== 0
AND (bodyB.collision_layer & bodyA.collision_mask) !== 0
```

Example layer setup:

```json
{ "collision_layer": 1, "collision_mask": 6 }  // layer 1, sees layers 2+3
{ "collision_layer": 2, "collision_mask": 1 }  // layer 2, sees layer 1
{ "collision_layer": 4, "collision_mask": 1 }  // layer 3, sees layer 1
```

### Transform Hierarchy

- `getWorldTransform(node)` — compute world transform by walking parent chain
- `localToWorld(node, x, y)` — convert local coordinates to world
- `worldToLocal(node, x, y)` — convert world coordinates to local
- `SceneTree.move()` preserves world position across reparenting
- Container nodes (`Node`, `Timer`) return identity transform

---

## Input

### Key Names

Keys are normalized to uppercase. Common values:

| Key | Name |
|-----|------|
| Space | `SPACE` |
| Arrow keys | `UP`, `DOWN`, `LEFT`, `RIGHT` |
| Enter | `ENTER` |
| Escape | `ESCAPE` |
| Shift | `SHIFT` |
| Control | `CONTROL` |
| Alt | `ALT` |
| Tab | `TAB` |
| Backspace | `BACKSPACE` |
| Letters | `A` through `Z` |
| Digits | `0` through `9` |
| F-keys | `F1` through `F12` |

### CLI Input Commands

```bash
ku input key <key> down      # Key press
ku input key <key> up        # Key release
ku input click <x> <y>       # Mouse click
ku input axis <name> <value> # Analog input (-1 to 1)
```

---

## Audio

- Supported format: WAV (PCM, 44100 Hz, stereo, s16)
- Multiple simultaneous sounds via software mixing
- Volume clamped to prevent overflow
- AudioPlayer nodes triggered via `play`/`stop` script actions
- Files resolved relative to project directory

---

## Scene Instancing

Nodes can reference external scene files, resolved at load time:

```json
{
  "type": "Sprite",
  "id": "player_sprite",
  "instance": "scenes/player_sprite.json",
  "properties": { "x": 100 }
}
```

- Template properties, children, and scripts merge with overrides
- Circular reference detection prevents infinite loops
- Reduces duplication for repeated entities

---

## Prefab CLI

```bash
# Create from type
ku node new Sprite /player sprite

# Instance a scene file as node
ku node instance scenes/enemy.json /enemies drone1

# Clone sub-tree
ku node duplicate /player /clones player_copy

# Save sub-tree as reusable scene
ku node save /player player_template
```
