# ku-engine Feature Requirements for Spacecraft Shooter

Features needed or strongly desired to build a proper 2D top-down spacecraft shooter on mobile portrait. Organized by priority.

---

## P0 — Game is unplayable without these

### 1. Gravity control per RigidBody

**Current:** `gravity_scale` property exists on `RigidBody` but is never synced to the Matter.js body. All RigidBodies are affected by world gravity equally.

**Needed:** Sync `gravity_scale` to `body.plugin?.gravityScale` or apply gravity force per-body in the physics step. A top-down game needs `gravity_scale: 0` on the player.

**Workaround today:** Set `velocity.y = 0` every frame in `on_frame`. Causes ~3 px/sec downward drift.

### 2. Inter-node property access

**Current:** Script actions (`set`, `move`, etc.) can only read/write the node the script is attached to. No way to read another node's property or write to another node.

**Needed:** At minimum, a `set_on` action: `{ "set_on": "/player", "key": "dead", "to": true }`. Ideally also a way to read other nodes in expressions: `{{/player/score}}`.

**Impact without it:** Score label can't read player's `dead` state (score keeps going after game over). No HUD that reflects game state. No "enemy destroys bullet" logic.

### 3. `emit` → script bridge

**Current:** `emit` action puts events on `EventBus` (pub/sub). But `ScriptEngine.evaluateEvent()` is only called for built-in events (`on_frame`, `on_key`, `on_collision`, etc.). Custom events never reach scripts.

**Needed:** Scripts with `"event": "on_custom"` should fire when another node does `{ "emit": "on_custom" }`. This enables inter-node communication.

**Impact without it:** Player collision → `emit("game_over")` → score label listens for `on_game_over` to freeze the score. Can't build reactive game state.

### 4. Touch / pointer input

**Current:** Only keyboard (`on_key`, `on_key_up`) and mouse click (`on_click` with x,y). No touch, no pointer drag, no virtual joystick.

**Needed for mobile:**
- `on_touch_start`, `on_touch_move`, `on_touch_end` with `{ x, y, pointerId }`
- `on_swipe` with `{ direction, speed }` (higher-level)
- Virtual joystick node type or axis emulation from touch region

**Workaround today:** Keyboard only. Not playable on mobile.

---

## P1 — Game is playable but severely limited

### 5. `spawn` with properties and scripts

**Current:** `spawn` action creates a bare node: `{ "spawn": "RigidBody", "at": { "x": 180, "y": 100 }, "as": "bullet_1" }`. The spawned node gets only `x` and `y` overrides — no custom properties, no scripts.

**Needed:**
```json
{
  "spawn": "RigidBody",
  "as": "bullet_0",
  "at": { "x": "{{x}}", "y": "{{y - 16}}" },
  "properties": { "velocity": { "x": 0, "y": -8 }, "gravity_scale": 0 },
  "scripts": [
    { "event": "on_frame", "condition": { "y": { "lt": -20 } }, "actions": [{ "destroy": "self" }] }
  ]
}
```

**Impact without it:** No bullets, no dynamic enemy waves, no projectiles, no power-up drops. Everything must be pre-placed in the scene and recycled.

### 6. Visual customization for nodes

**Current:** RigidBody renders as hardcoded yellow 30x24 rect. CollisionShape renders as hardcoded green rect. No way to set color, visual shape, or sprite per node.

**Needed:**
- `color` property on any node type (used by debug renderer): `"color": "#ff4444"`
- `width`/`height` on RigidBody for visual size (separate from physics body)
- Or: RigidBody should respect a child `Sprite` or `AnimatedSprite` for rendering

**Impact without it:** Player is always yellow, enemies always green. Can't distinguish bullet types, power-ups, or enemy variants visually.

### 7. RigidBody configurable collision size

**Current:** `syncBody` in `physics.ts` hardcodes `Matter.Bodies.rectangle(x, y, 32, 32, ...)`. All RigidBodies are 32x32.

**Needed:** Read `width`/`height` from node properties, or use a child `CollisionShape` to define the RigidBody's physics body size.

**Impact without it:** Collision hitbox doesn't match visual or intended size. Small enemies have oversized hitboxes relative to large ones.

### 8. `on_timer` event

**Current:** `Timer` node type exists with `wait_time`, `one_shot`, `autostart` properties, but no `on_timer` script event is ever fired.

**Needed:** When a Timer node's interval elapses, fire `on_timer` on that node (or on parent/scene). Enable timed spawning, power-up durations, difficulty scaling.

**Impact without it:** Can't create timed enemy waves or periodic events. All timing is frame-count based (and there's no modulo operator).

---

## P2 — Nice to have for a polished game

### 9. Expression modulo operator

**Current:** Expression evaluator supports `+`, `-`, `*`, `/`, `random()`, negation, and property references. No modulo `%`.

**Needed:** `{{frame % 60}}` for "every Nth frame" logic, or `{{score % 100}}` for milestone detection.

**Workaround:** Use a counter property and reset it, but this is fragile.

### 10. Screen wrapping

**Current:** No built-in screen wrap. Must use wall CollisionShapes or manual position reset scripts.

**Needed:** `wrap` property on Node2D/RigidBody: `{ "wrap": "horizontal" }` or `{ "wrap": true }`. When a node exits one edge, it appears on the opposite edge.

### 11. Collision layers / groups

**Current:** All bodies collide with all other bodies. RigidBody vs CollisionShape is the only collision pair that physically resolves. No filtering.

**Needed:** `collision_layer` and `collision_mask` properties (Godot-style bitmask). Enables: bullets pass through player, enemies don't collide with each other, power-ups only interact with player.

**Impact without it:** Bullets (RigidBody) would collide with the player RigidBody. Must use creative workarounds or forgo bullet mechanics.

### 12. `on_area_enter` / `on_area_exit` events

**Current:** `Area` nodes create sensor bodies in Matter.js, but no enter/exit overlap events are fired distinct from collision events.

**Needed:** Proper area monitoring — fire `on_area_enter` when a body enters an Area's region, `on_area_exit` when it leaves.

**Use cases:** Power-up collection zones, trigger zones, safe zones, spawn regions.

### 13. `move_toward` action

**Current:** Only `move` (relative delta) and `set` (absolute). No smooth interpolation toward a target.

**Needed:** `{ "move_toward": { "x": 180, "y": 100, "speed": 3 } }` — move toward target position at given speed.

**Use cases:** Enemy homing behavior, smooth camera follow, magnetic power-up attraction.

### 14. Node destruction with `self` reference

**Current:** `{ "destroy": "/path/to/node" }` requires an absolute path. Spawned nodes with generated IDs can't self-destruct easily.

**Needed:** `{ "destroy": "self" }` — destroys the current node. Useful for bullets that expire, timed explosives, etc.

### 15. Sound playback

**Current:** `AudioPlayer` node exists with `stream`, `volume`, `playing` properties. Not implemented in the game loop or renderer.

**Needed:** When `playing` is set to `true`, play the audio file from `stream` at `volume`.

**Impact without it:** Silent game. No shooting sounds, explosions, or music.

---

## Summary

| Priority | Feature | Category |
|----------|---------|----------|
| P0 | gravity_scale sync | Physics |
| P0 | Inter-node property access | Script |
| P0 | emit → script bridge | Script |
| P0 | Touch / pointer input | Input |
| P1 | spawn with properties & scripts | Script |
| P1 | Visual customization (color) | Renderer |
| P1 | RigidBody configurable size | Physics |
| P1 | on_timer event | Script |
| P2 | Modulo operator | Expression |
| P2 | Screen wrapping | Engine |
| P2 | Collision layers | Physics |
| P2 | Area enter/exit events | Physics |
| P2 | move_toward action | Script |
| P2 | self-destruct | Script |
| P2 | Audio playback | Audio |
