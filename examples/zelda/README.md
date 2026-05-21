# Zelda-like Example

A top-down action-adventure game built with the ku engine, using the [Cute Fantasy Free](https://pixel-poem.itch.io/cute-fantasy-free) pixel art asset pack.

## How to Play

```bash
# From the ku-engine root
npx ku play main
```

## Controls

| Key | Action |
|-----|--------|
| Arrow keys / WASD | Move |
| Space | Attack (sword) |
| E | Interact (open chests) |
| R | Restart (when dead) |

## Features

- **Player movement** with 4-directional walk/idle animations
- **Sword combat** — attack enemies with a directional hitbox
- **Enemy AI** — slimes patrol and chase the player within range
- **Health system** — 5 hearts, invincibility frames on hit
- **Score** — open the treasure chest for points, defeat enemies
- **Scene transitions** — enter the house via the front door, exit to return
- **Camera follow** — smooth lerp tracking
- **Game over / restart** — press R to retry

## Project Structure

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

## Collision Layers

| Layer | Bit | Used by |
|-------|-----|---------|
| 1 | 0x01 | Player |
| 2 | 0x02 | Enemies |
| 4 | 0x04 | Sword hitbox |
| 8 | 0x08 | World obstacles (walls, trees, water) |
| 16 | 0x10 | Interaction zones (doors) |
