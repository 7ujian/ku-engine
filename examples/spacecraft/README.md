# Spacecraft

A 2D top-down spacecraft shooter for mobile portrait view (360x640).

## Gameplay

Pilot your cyan spacecraft, dodge and shoot red/orange enemies raining from above. Enemies get faster each time they're destroyed or recycle. Score points by surviving (+1 every 6 frames) and shooting enemies (+100 each).

## Controls

| Input | Action |
|-------|--------|
| Arrow keys | Move in 4 directions |
| SPACE (hold) | Auto-fire bullets |
| Touch/pointer (hold) | Move toward finger + auto-fire |
| Close window | Quit |

## Run

From the `ku-engine` root:

```bash
npm run build
node dist/bin/ku.js play --project examples/spacecraft
```

## Game Design

- **Player** (cyan, 20x26): RigidBody with `gravity_scale: 0`, collision layer 1
- **Bullets** (yellow, 4x12): 5 CollisionShapes in a rotating pool, collision layer 2 (only hits enemies)
- **Enemies** (red/orange, varied sizes): 8 CollisionShapes with drift and progressive speed, collision layer 4
- **Walls** (dark, off-screen): Keep player in bounds via physics, collision layer 8
- **Score**: +1 every 6 frames alive + 100 per enemy shot
- **Game Over**: On enemy collision — player turns red, enemies freeze and gray out, "GAME OVER" appears

## Engine Features Used

| Feature | Usage |
|---------|-------|
| `gravity_scale: 0` | Zero-gravity top-down movement |
| `color` property | Cyan player, yellow bullets, red/orange enemies |
| `width`/`height` on RigidBody | Custom ship size (20x26) |
| Collision layers (`collision_layer`/`collision_mask`) | Bullets pass through player, only hit enemies |
| `set_on` action | Player activates bullet pool by index |
| `emit` + script bridge | `enemy_killed` → score +100, `game_over` → freeze enemies |
| Cross-node refs `{{/player/score}}` | Score label reads player score directly |
| `move_toward` action | Touch control — player moves toward finger |
| `on_touch_start/move/end` | Mobile touch input |
| `{{random(a,b)}}` expressions | Enemy spawn position randomization |
| `{{speed + 0.1}}` arithmetic | Progressive difficulty |
| `tags` + `with` filter | Collision filtering by role (enemy/bullet) |

## Known Limitations

1. **No spawn → physics sync**: Spawned nodes don't get physics bodies at runtime, so bullets must be pre-created in the scene pool rather than dynamically spawned.
2. **No destroy → physics cleanup**: `destroy` removes nodes from the tree but leaves ghost physics bodies. Enemies are recycled (teleported) instead of destroyed to avoid ghost collisions.
3. **No dynamic `set_on` targets**: `set_on` doesn't evaluate expressions, so bullet pool rotation uses 5 separate scripts (one per index) instead of a single loop.
4. **`move_toward` + RigidBody**: Touch control uses `move_toward` which sets position directly, potentially clipping through walls. Physics resolves on the next frame.
5. **No sound**: `AudioPlayer` nodes exist but audio playback is not implemented.
