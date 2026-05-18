# ku-engine Feature Requirements for Spacecraft Shooter

Remaining features that would improve the spacecraft game. Previous P0 items (gravity_scale, emit bridge, touch input, inter-node access) are now resolved.

---

## P1 — Notable gameplay limitations

### 1. Spawn → physics sync

**Issue:** `spawn` adds nodes to the scene tree but never creates physics bodies for them. Spawned RigidBodies and CollisionShapes are invisible to collision detection.

**Needed:** After script evaluation, scan for new tree nodes not yet in the physics bodyMap and call `syncNode()` for each.

**Workaround:** Pre-create node pools in the scene JSON and recycle them.

### 2. Destroy → physics cleanup

**Issue:** `destroy` removes a node from the scene tree but leaves its Matter.js body in the physics world. Ghost bodies still cause collision events.

**Needed:** After `tree.remove()`, call `physics.removeBody(nodeId)` and `scripts.unregisterNodeById(nodeId)`.

**Workaround:** Recycle enemies by teleporting them off-screen instead of destroying.

### 3. Dynamic `set_on` targets

**Issue:** `set_on` takes a literal string path, not an expression. Cannot rotate through a pool with `set_on: "/bullet_{{next_bullet}}"`.

**Needed:** Evaluate `action.set_on` through `resolveCrossNodeRefs` and `evaluateExpression`.

**Workaround:** One script per pool index (5 scripts for 5 bullets).

### 4. Conditional expressions

**Issue:** No ternary or comparison in expressions. Cannot compute direction from player to touch: `if touch_x > x then 5 else -5`.

**Needed:** `{{touch_x > x ? 5 : -5}}` or a `sign(expr)` built-in function.

**Workaround:** `move_toward` handles direction internally, but keyboard-based touch emulation isn't possible without it.

---

## P2 — Polish

### 5. Audio playback

**Current:** `AudioPlayer` node exists with properties but no playback.

**Needed:** Play sound files when `playing` is set to true. Essential for shooting, explosions, and music.

### 6. Screen wrapping

**Needed:** `{ "wrap": "horizontal" }` property on nodes. When exiting one screen edge, appear on the opposite edge.

### 7. Particle effects

**Needed:** A `Particles` node type with configurable lifetime, emission rate, and color. For explosions, thrust trails, etc.

### 8. Node hierarchy for bullets

**Issue:** Bullets are root-level nodes. They cannot be children of the player node because `CollisionShape` position is relative to its parent in physics sync.

**Needed:** Either fix parent-relative positioning for recycled nodes, or add a "group" concept for managing pools.

---

## Resolved (was P0)

| Feature | Status |
|---------|--------|
| `gravity_scale` sync to Matter.js | Fixed — per-body gravity via `plugin.gravityScale` |
| Inter-node property access (`set_on`) | Implemented |
| `emit` → script bridge | Implemented |
| Touch / pointer input | Implemented |
| Visual customization (`color`) | Implemented |
| RigidBody configurable size | Implemented |
| `on_timer` event | Implemented |
| Modulo operator (`%`) | Implemented |
| `destroy: "self"` | Implemented |
| `move_toward` action | Implemented |
| Cross-node refs (`{{/nodeId/prop}}`) | Implemented |
| Collision layers/masks | Implemented |
