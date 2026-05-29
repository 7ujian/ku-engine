# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A Zelda-like top-down action-adventure game built with the ku engine. Example project demonstrating JS scripting, combat, enemy AI, HUD, scene transitions, camera follow, and the wrapper+level scene architecture.

## Scene architecture (wrapper + level)

- **main.json**: wrapper — camera, HUD hearts, score, gameover panel, game_controller. App-level nodes (Profiler, ProfilerGui) added at runtime.
- **village.json**: level content — village_map (TileMap), player, slime_0, slime_1, chest. Loaded into root via `ctx.scene.load_scene('/', 'village')`.
- **house.json**: self-contained scene — has its own camera, player, HUD, game_controller.

### Restart flow
- Player dies → R key → `restart_game` handler
- Detects wrapper scene via `ctx.scene.find('/village_map') !== null`
- Destroys level nodes (village_map, player, slimes, chest, spawn_point)
- Calls `ctx.scene.load_scene('/', 'village')` — sync load, tree updated immediately
- App nodes (Profiler, HUD, camera) untouched

### Scene transition (house)
- Door Area → `change_scene('house')` — replaces entire tree
- `systemNodeSetup` callback re-adds Profiler/ProfilerGui to new tree
- House exit → `change_scene('main')` — back to wrapper

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
├── project.json              # Window 640x480, entry "main", profiling, debug_physics
├── assets/
│   ├── player.atlas.json     # Player sprite sheet (10 actions × 4-6 frames)
│   ├── slime.atlas.json      # Slime sprite sheet
│   ├── fonts/
│   │   ├── Silkscreen-Regular.ttf  # Pixel font for HUD
│   │   └── Silkscreen-Bold.ttf
│   ├── tiled/
│   │   ├── village.tmj       # Tiled map (base64 layer data)
│   │   └── Terrain_All_Tile.tsj  # Tileset with tile collision objects
│   └── Cute_Fantasy_Free/    # Asset pack (PNG sprites)
├── scenes/
│   ├── main.json             # Wrapper — camera, HUD, game_controller
│   ├── village.json          # Level — tilemap, player, enemies, chest
│   └── house.json            # Self-contained interior scene
└── scripts/
    ├── player.js             # Movement, combat, health, interaction
    ├── enemy.js              # Patrol/chase AI, jump attack, damage
    ├── game.js               # Camera follow, HUD, level load/restart
    └── chest.js              # Chest visual feedback
```

## Script architecture

### player.js — attached to `player` RigidBody
- **Death**: hp ≤ 0 stops velocity, plays `death` animation (die_0..3, loop:false, stops at last frame).
- **Movement**: WASD/arrows → velocity on RigidBody. gravity_scale=0 (top-down).
- **Animation**: Sets `animation` to `walk_<dir>` / `idle_<dir>` / `attack_<dir>`, flips via `flip_h`.
- **Combat**: Space → enables `sword_hitbox` CollisionShape (mask toggles 0↔2).
- **Health**: 5 HP, 1s invincibility frames, flicker effect (toggles `visible`).
- **Interaction**: E key → opens chest (checks distance).

### enemy.js — attached to each slime RigidBody
- **AI**: Patrol random directions, chase player within CHASE_RANGE (140px).
- **Jump attack state machine**: idle → jumping (200ms, 2.0 speed toward player) → landing (100ms, damage on impact) → sliding_back (350ms, 1.0 speed) → idle (800ms cooldown).
- **Attack range**: stops at ATTACK_RANGE (32px), jumps ~12px for half-body overlap.
- **Combat**: Takes sword damage via `on_collision`. Flash effect on hit.
- **Death**: 600ms timer → hides body, sets collision_mask=0.

### game.js — attached to `game_controller` Node
- **Camera**: Smooth lerp (SMOOTH=0.08) follows `/player` position via `offset_x/y`.
- **HUD**: Positions hearts (❤/♡) and score relative to camera. Font: Silkscreen 14px.
- **Restart**: Container-based — destroys level nodes, sync-loads village.json.
- **Transition**: `hasVillageMap` check → wrapper uses load_scene, self-contained uses change_scene.

### chest.js — attached to chest AnimatedSprite
- Minimal; interaction logic in player.js. Tracks `opened` state.

## Collision layers

| Layer | Bit | Used by |
|-------|-----|---------|
| 1 | 0x01 | Player |
| 2 | 0x02 | Enemies |
| 4 | 0x04 | Sword hitbox |
| 8 | 0x08 | World obstacles (tile compound body) |
| 16 | 0x10 | Interaction zones (doors) |

- Player mask: 24 (8+16) — obstacles + interaction. No enemy collision (no push).
- Enemy mask: 10 (2+8) — other enemies + obstacles. No player collision.
- Sword: layer 4, mask toggles 0↔2 on attack. Hits enemies only.

## Key patterns

- **`ctx.scene.load_scene(path, file)`**: Sync-loads a scene into container. Tree updated before return. No race condition.
- **`ctx.scene.find(path)`**: Returns node API or null — use for existence checks.
- **Module-level closure vars**: Input state, timers, AI state persist across handler calls.
- **CollisionShape as hitbox**: Sword is child CollisionShape with toggled mask.
- **Area for detection**: Future attack range detection via Area sensor nodes.
- **Font loading**: `assets/fonts/*.ttf` auto-registered by renderer on startup.
