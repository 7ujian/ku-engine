# ku

A CLI-based 2D game engine for AI agents. AI agents act as both developers (creating scenes, editing nodes) and players (sending input, reacting to game state).

## Architecture

One editor + multiple play instances, each a separate OS process connected via WebSocket:

```
┌──────────┐     WebSocket     ┌──────────────────┐
│  ku CLI  │ ◄───────────────► │  edit :21200      │
│          │                    │  (scene editing)  │
│  AI SDK  │ ◄───────────────► │  play1 :OS-port   │
│          │     WebSocket     │  (game loop)      │
│          │ ◄───────────────► │  play2 :OS-port   │
└──────────┘                    │  (game loop)      │
                                └──────────────────┘
```

- **Editor** (`edit`, port 21200) — persistent, scene editing, no game loop, saves to disk
- **Play instances** (`play1`, `play2`, ...) — ephemeral, loads scenes from disk, runs full game loop (physics + scripts + input + rendering). Each gets its own window and OS-assigned port. Optional `--watch` for hot reload on scene file changes.

The scene graph is a tree of typed nodes (Godot-inspired). 14 built-in node types: `Node`, `Node2D`, `Sprite`, `AnimatedSprite`, `RigidBody`, `Area`, `CollisionShape`, `Camera2D`, `Label`, `TileMap`, `Timer`, `AudioPlayer`, `AnimationPlayer`, `Block`. Nodes are addressed by slash-separated path (e.g. `player/sprite`).

Game logic is pure JSON — event-driven scripts with triggers (`on_key`, `on_collision`, `on_frame`, `on_timer`, `on_area_enter`, `on_touch_start`, `on_animation_finished`) and actions (`set`, `move`, `spawn`, `destroy`, `emit`, `play`, `change_scene`, `animate`, `log`). Cross-node references via `{{/player/score}}` expressions. Optional JS scripting via sandboxed `vm` engine.

## Quick Start

```bash
npm install && npm run build

# Create a project
mkdir my-game && cd my-game
echo '{"window":{"width":640,"height":480},"entry":"scenes/main.json"}' > project.json

# Start the editor and open a shell
ku edit main -i

# In the shell:
play            # launches play1 (opens SDL2 window, loads entry scene)
play            # launches play2
instances       # lists edit, play1, play2
attach play1    # switch to play1
```

Or non-interactive:

```bash
ku edit main            # start editor
ku play                 # start play1 (loads entry scene)
ku play level2          # start play1 with specific scene
ku play --name play2    # start play2 (entry scene)
ku input key space down # send input to attached instance
```

## CLI Commands

### Instance management

| Command | Description |
|---------|-------------|
| `ku edit [scene]` | Start editor instance |
| `ku play [scene]` | Start play instance (loads scene, or entry scene if none given; `--name` to set instance name; `--watch` for hot reload) |
| `ku stop [playN]` | Stop an instance (default: play1) |
| `ku attach <edit\|playN>` | Attach CLI to an instance |
| `ku detach` | Detach CLI from current instance |
| `ku instances` | List running instances |

### Scene editing

| Command | Description |
|---------|-------------|
| `ku scene create <name>` | Create a new scene |
| `ku scene save [name]` | Save current scene to disk |
| `ku scene load <name>` | Load a scene into editor |
| `ku scene list` | List all scenes |
| `ku scene rm <name>` | Delete a scene file |

### Node operations

| Command | Description |
|---------|-------------|
| `ku node new <type> [path] [id]` | Create node from type |
| `ku node instance <scene> [path] [id]` | Instance a scene as a node |
| `ku node duplicate <path> [parent] [id]` | Clone a sub-tree |
| `ku node save <path> [scene-name]` | Save sub-tree as scene file |
| `ku node add <path> <type> <id>` | Add child node |
| `ku node rm <path>` | Remove node |
| `ku node set <path.prop> <value>` | Set property |
| `ku node get <path[.prop]>` | Get property or full node |
| `ku node list <path>` | List children |
| `ku node move <path> <newParent>` | Reparent node |

### Runtime (play instances)

| Command | Description |
|---------|-------------|
| `ku pause` | Pause game loop |
| `ku resume` | Resume game loop |
| `ku step` | Advance one frame |

### Input (play instances)

| Command | Description |
|---------|-------------|
| `ku input key <key> <down\|up>` | Simulate key event |
| `ku input click <x> <y>` | Simulate click |
| `ku input axis <name> <value>` | Set axis value (-1 to 1) |

### Query

| Command | Description |
|---------|-------------|
| `ku query scene` | Full scene state as JSON |
| `ku query nodes [type]` | List nodes, optionally filtered by type |
| `ku query node <path>` | Get single node state |
| `ku query diff` | Frame-over-frame property deltas |
| `ku query collisions` | Active collision pairs |
| `ku query logs [--clear]` | View script log output |

### Build

| Command | Description |
|---------|-------------|
| `ku build [--output <dir>]` | Package project for distribution |

## Scene JSON Format

```json
{
  "scene": "main",
  "root": {
    "id": "world",
    "type": "Node",
    "properties": {},
    "children": [
      {
        "id": "player",
        "type": "RigidBody",
        "properties": {
          "x": 100, "y": 250,
          "mass": 1,
          "velocity": { "x": 0, "y": 0 },
          "tags": ["player"]
        },
        "children": [],
        "scripts": [
          {
            "event": "on_key",
            "filter": { "key": "space" },
            "actions": [
              { "set": "velocity.y", "to": -250 }
            ]
          },
          {
            "event": "on_collision",
            "filter": { "with": "enemy" },
            "actions": [
              { "emit": "game_over", "data": {} },
              { "log": "hit enemy!" }
            ]
          }
        ]
      }
    ],
    "scripts": []
  }
}
```

## Script System

Scripts are event-driven JSON rules with three optional filtering stages:

- **event** — which event triggers the script (`on_frame`, `on_key`, `on_collision`, `on_enter`, `on_timer`, `on_area_enter`, `on_touch_start`)
- **filter** — key-value match against event data (e.g. `{"key": "space"}` or `{"with": "pipe"}`)
- **condition** — expression evaluated against node properties (e.g. `{"gt": ["score", 10]}`)

### Actions

| Action | Example | Description |
|--------|---------|-------------|
| `set` | `{"set": "velocity.y", "to": -250}` | Set property |
| `set_on` | `{"set_on": "/player", "prop": "visible", "to": false}` | Set property on another node |
| `move` | `{"move": {"x": -2}}` | Apply offset |
| `move_toward` | `{"move_toward": {"x": 300, "y": 0}}` | Move toward target |
| `spawn` | `{"spawn": "bullet", "at": "player"}` | Spawn from prefab |
| `destroy` | `{"destroy": "{{other}}"}` | Remove node |
| `emit` | `{"emit": "scored", "data": {}}` | Fire custom event |
| `play` | `{"play": "shoot.wav"}` | Play audio/animation |
| `change_scene` | `{"change_scene": "level2"}` | Switch scene |
| `animate` | `{"animate": "jump", "on": "/player/anims"}` | Start AnimationPlayer |
| `animate_stop` | `{"animate_stop": "/player/anims"}` | Stop AnimationPlayer |
| `log` | `{"log": "hit pipe!"}` | Debug log |

### Expressions

Template expressions use `{{...}}` syntax:

- `"{{score + 1}}"` — arithmetic with node properties
- `"{{velocity.y}}"` — dot-path property access
- `"{{/player/score}}"` — cross-node reference
- `"{{other}}"` — event context variable (collision partner)
- `"{{otherTags}}"` — array of tags from the other node

### JS Scripts

For complex logic, nodes can have JS scripts loaded from the `scripts/` directory:

```javascript
// scripts/player.js
handlers.on_frame = function(ctx) {
  var vx = ctx.node.get('velocity.x');
  ctx.node.set('velocity.x', vx + ctx.dt * 100);
  if (ctx.data.jumps > 3) ctx.emit('tired', {});
};
```

## Project Configuration

`project.json`:

```json
{
  "name": "my-game",
  "entry": "main",
  "window": { "width": 640, "height": 480 },
  "debug_physics": false
}
```

## Tech Stack

- Node.js 20+, TypeScript
- `commander` — CLI framework
- `ws` — WebSocket server/client
- `matter-js` — 2D physics engine
- `@kmamal/sdl` — SDL2 window rendering + audio
- `@napi-rs/canvas` — software canvas rendering
- `vitest` — testing

## Development

```bash
npm test                       # run all tests
npx vitest run                 # run tests once
npx vitest run test/file.test.ts  # single test file
npm run build                  # compile TypeScript
```
