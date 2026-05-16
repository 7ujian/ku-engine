# Spacecraft

A 2D top-down spacecraft dodge game for mobile portrait view (360x640).

## Gameplay

You pilot a spacecraft (yellow) dodging enemy ships (green) that rain down from the top of the screen. Enemies speed up each time they recycle, making the game progressively harder.

## Controls

| Key | Action |
|-----|--------|
| Arrow keys | Move in 4 directions |
| Close window | Quit |

## Run

From the `ku-engine` root:

```bash
# Build the engine first
npm run build

# Option A: Edit mode (scene editing, no game loop)
node dist/bin/ku.js edit main --project examples/spacecraft

# Option B: Play mode (full game loop with rendering)
node dist/bin/ku.js play --project examples/spacecraft

# Send input via CLI
node dist/bin/ku.js input key LEFT down
node dist/bin/ku.js input key LEFT up
node dist/bin/ku.js input key RIGHT down
node dist/bin/ku.js input key SPACE down
```

## Game Design

- **Player** (yellow rectangle): RigidBody at bottom, moves with arrow keys
- **Enemies** (green rectangles): 8 CollisionShapes that fall from the top with varying speeds and drift
- **Walls** (invisible): CollisionShapes at screen edges keep player in bounds
- **Score**: Increments every frame while alive, displayed top-left
- **Difficulty**: Each enemy speeds up by 0.15 px/frame every time it recycles off-screen
- **Game Over**: On collision with any enemy — player freezes, score stops

## Architecture Notes

This game is built entirely with ku-engine's JSON script system — no custom code:
- Movement uses `on_key`/`on_key_up` events to track held keys, with `on_frame` scripts applying velocity
- Enemy recycling uses `on_frame` with position conditions and `{{random()}}` expressions
- Collision filtering uses `tags` property with `with` filter to distinguish enemies from walls
- Progressive difficulty uses `{{speed + 0.15}}` expression on each enemy recycle

## Known Engine Limitations Encountered

1. **No gravity disable** — `gravity_scale` node property exists but is never synced to Matter.js. The player drifts slowly downward. Workaround: set `velocity.y = 0` every frame in `on_frame`.
2. **No inter-node property access** — Scripts can only read/write their own node's properties. Score label can't read player's `dead` state, so score keeps incrementing after game over.
3. **No `emit` → script bridge** — Custom events emitted via `emit` go to EventBus but never reach `evaluateEvent()`. No inter-node event communication.
4. **No visual customization** — RigidBody always renders as yellow 30x24 rect; CollisionShape always renders as green rect. No way to set color, shape, or size per node.
5. **No touch input** — Mobile touch/swipe not supported. Only keyboard and CLI input.
6. **No shooting** — `spawn` creates bare nodes without custom properties or scripts, making bullet systems impossible. Bullets would need gravity_scale=0, velocity, and on_frame scripts, none of which can be set via spawn.
7. **No `on_timer` event** — Timer nodes exist but don't fire script events. Can't use timed enemy waves.
8. **No modulo operator** — Expression evaluator lacks `%`, making "every Nth frame" logic impossible.
9. **RigidBody physics body hardcoded to 32x32** — Regardless of visual size or desired collision area.
10. **Area nodes not rendered** — Can't use Area (sensor) for the player since the renderer skips Area nodes entirely.
