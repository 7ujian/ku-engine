# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Spacecraft is a 2D top-down dodge game example built entirely with the ku-engine's JSON script system — no custom code. It's a 360x640 portrait mobile game where a player (yellow rectangle) dodges enemy ships (green rectangles) falling from the top, with progressive difficulty.

This example lives at `examples/spacecraft` within the ku-engine monorepo. The engine source is at `src/` in the repo root.

## Running

```bash
# Build the engine first (from repo root)
npm run build

# Play mode (full game loop with SDL2 rendering)
node dist/bin/ku.js play --project examples/spacecraft

# Edit mode (scene editing, no game loop)
node dist/bin/ku.js edit main --project examples/spacecraft

# Send input (from another terminal)
node dist/bin/ku.js input key LEFT down
node dist/bin/ku.js input key LEFT up
```

## File structure

- `project.json` — Engine project config: window size (360x640), entry scene
- `scenes/main.json` — The entire game: node tree, physics properties, and all scripts in one JSON file
- `KU_ENGINE_FEATURE_REQUIREMENT.md` — Prioritized list (P0/P1/P2) of engine features this game needs

## Architecture

Everything is defined in `scenes/main.json` using ku's JSON script system:

- **Player** (`RigidBody`): Arrow key movement via `on_key`/`on_key_up` tracking held keys, `on_frame` applies velocity. Collision with enemies sets `dead=true` and zeroes velocity.
- **Enemies** (`enemy_0`–`enemy_7`, `CollisionShape`): 8 pre-placed nodes that fall via `on_frame` `move` actions. When `y > 680`, they recycle to top with `{{random(30, 330)}}` x-position and `{{speed + 0.15}}` speed increase.
- **Walls** (`wall_*`, `CollisionShape`): Invisible boundaries at screen edges to keep player in bounds.
- **Score** (`Label`): Increments its own counter every frame, displays `"SCORE: {{score}}"`.
- **Movement pattern**: `on_key` sets boolean flags → `on_frame` reads flags and sets velocity → physics applies velocity. Dead player zeroes velocity every frame.
- **Difficulty**: Each enemy has its own `speed`/`drift`/`laps` properties. Speed increases by 0.15 each lap via expression `{{speed + 0.15}}`.

## Known engine limitations affecting this game

See `KU_ENGINE_FEATURE_REQUIREMENT.md` for the full prioritized list. Key blockers:

- **No gravity disable**: `gravity_scale` property isn't synced to Matter.js, causing player drift. Workaround: zero `velocity.y` every frame.
- **No inter-node access**: Score label can't read player's `dead` state, so score keeps incrementing after game over.
- **No visual customization**: RigidBody always renders yellow, CollisionShape always green. All RigidBodies are 32x32 physics bodies.
- **No `emit` → script bridge**: Custom events can't trigger scripts on other nodes.

## Modifying the game

Edit `scenes/main.json` directly. There is no build step for this example — changes take effect on next `ku play`. To add enemies, copy an existing `enemy_N` node block with a new ID and adjusted starting position/speed/drift.
