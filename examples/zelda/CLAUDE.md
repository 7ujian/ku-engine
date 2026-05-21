# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Zelda-like top-down action-adventure game built with the ku engine. Example project demonstrating JS scripting, combat, enemy AI, HUD, scene transitions, and camera follow.

## How to run

```bash
# From the ku-engine root (../../)
npx ku play main
```

Or from this directory after building the engine:
```bash
cd ../.. && npm run build && cd examples/zelda && npx ku play main
```

## Project structure

```
zelda/
├── project.json              # Window 640x480, entry scene "main"
├── assets/
│   ├── player.atlas.json     # Player sprite sheet regions (10 actions × 4-6 frames)
│   ├── slime.atlas.json      # Slime enemy sprite sheet regions
│   └── Cute_Fantasy_Free/    # Asset pack (PNG sprites)
├── scenes/
│   ├── main.json             # Overworld — grass, water, trees, house, enemies, chest
│   ├── house.json            # Interior — floor, walls, exit door
│   └── test.json             # Minimal test scene for debugging
└── scripts/
    ├── player.js             # Movement, combat, health, interaction
    ├── enemy.js              # Patrol/chase AI, damage, death
    ├── game.js               # Camera follow, HUD, game state, restart
    └── chest.js              # Chest visual feedback
```

## Script architecture

All game logic uses the ku JS scripting system (`handlers.on_*`). Scripts are attached to nodes via the `js_script` property in scene JSON.

### player.js — attached to the `player` RigidBody
- **Movement**: Reads key state (WASD/arrows) each frame, sets `velocity` directly on the RigidBody
- **Animation**: Sets `animation` property to `walk_<dir>` / `idle_<dir>` / `attack_<dir>`, flips sprite via `flip_h`
- **Combat**: Space triggers attack — enables the hidden `sword_hitbox` CollisionShape (`collision_mask` toggled between 2 and 0), manages attack duration + cooldown timers
- **Health**: 5 HP, invincibility frames on hit with flicker effect (toggles `visible`)
- **Interaction**: E key checks distance to `/chest`, opens it (sets `frame` to 1), awards score

### enemy.js — attached to each slime RigidBody
- **AI**: Patrols in random cardinal directions, changing every ~2s. Chases player when within `CHASE_RANGE` (140px)
- **Combat**: Takes damage from `sword` tag collisions, death animation then hides (sets `collision_mask` to 0, `visible` false)
- **State**: Uses module-level vars (`patrolDir`, `dead`, `flashTimer`) for per-enemy state since each node gets its own isolated VM context

### game.js — attached to the root `game` node
- **Camera**: Smooth lerp follow on `/player` position via `offset_x`/`offset_y` on the Camera2D node
- **HUD**: Positions heart Labels and score Label relative to camera each frame. Hearts use Unicode (❤/♡)
- **Game state**: Detects player death (hp ≤ 0), shows gameover panel, handles R to restart via `change_scene` event

### chest.js — attached to the chest AnimatedSprite
- Minimal script; interaction logic lives in player.js. Tracks `opened` state.

## Collision layers

| Layer | Bit | Used by |
|-------|-----|---------|
| 1 | 0x01 | Player |
| 2 | 0x02 | Enemies |
| 4 | 0x04 | Sword hitbox |
| 8 | 0x08 | World obstacles (walls, trees, water) |
| 16 | 0x10 | Interaction zones (doors) |

The sword hitbox is a child CollisionShape of the player node. It toggles `collision_mask` between 2 (active, hits enemies) and 0 (inactive).

## Scene transitions

The `change_scene` event triggers level loads. The house door (`/door_area`) fires `on_area_enter` → `change_scene` to `house`. The house exit door does the reverse back to `main`.

## Key patterns

- **Node properties as state**: Scripts use `ctx.node.set()` / `ctx.node.get()` for all persistent state (hp, score, timers, direction). No external state management.
- **try/catch for optional nodes**: Scripts wrap `ctx.scene.get()` / `ctx.scene.set()` in try/catch when the target node might not exist (e.g., enemies querying player position before player spawns).
- **Module-level closure vars**: Used for input state (`keys` object), timers, and flags that persist across handler calls. `ctx.data` is an alternative available in the ku API.
- **CollisionShape as hitbox**: The sword is a CollisionShape child of the player, positioned each attack frame, with mask toggled to enable/disable damage.
- **Camera2D via offset**: Camera follow is manual — `game.js` lerps `offset_x`/`offset_y` each frame rather than using built-in follow. The renderer centers on the first Camera2D found.

## Engine reference

This is an example project for the ku engine. Engine source, build commands, and full API reference are in `../../` (the ku engine root). See `../../CLAUDE.md` for engine architecture and `../../KU_API.md` for the complete node type, script, and expression API reference.
