# ku — Design Document

## Overview

ku is a CLI-based 2D game engine designed for AI agents. AI agents act as both developers (creating scenes, editing nodes) and players (sending input, reacting to state). The primary interface is a CLI that communicates with a persistent game server via JSON over WebSocket.

**Stack**: Node.js / TypeScript

---

## 1. Architecture

ku uses a **dual-instance** architecture. The Editor instance and Play instance are separate OS processes sharing the same engine framework but serving different roles.

```
                         ┌─────────────────────────────────────────────┐
                         │           Engine Framework (shared)         │
                         │  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
                         │  │Node Tree │  │ Scripts  │  │ Physics  │ │
                         │  └──────────┘  └──────────┘  └──────────┘ │
                         └──────────┬──────────────────────┬──────────┘
                                    │                      │
              ┌─────────────────────▼──┐    ┌──────────────▼──────────────┐
              │   Editor Instance      │    │     Play Instance           │
              │   (port 21200)         │    │     (port 21201)            │
              │                        │    │                             │
              │  • Scene editing       │    │  • Game loop (60 FPS)       │
              │  • Node CRUD           │    │  • Script execution         │
              │  • No game loop        │    │  • Physics simulation       │
              │  • File persistence    │    │  • Input handling           │
              │  • No physics/scripts  │    │  • Renderer active          │
              │                        │    │  • Ephemeral (snapshot)     │
              └────────────┬───────────┘    └──────────────┬──────────────┘
                           │                               │
              ┌────────────▼───────────────────────────────▼──────────────┐
              │                       ku CLI                              │
              │   ku attach edit | ku attach play | ku detach             │
              └───────────────────────────────────────────────────────────┘
```

- **Editor instance** — persistent process for scene creation and editing. No game loop, no physics, no script execution. Changes are saved to disk.
- **Play instance** — ephemeral process spawned from an Editor snapshot. Syncs the editor's live in-memory tree via WebSocket (not from disk). Runs the full game loop with physics, scripts, and input. State is discarded on stop. Optional `--hot-reload` subscribes to incremental editor deltas.
- **CLI** connects to either instance via WebSocket. Commands are routed based on current attachment.

### Process model

1. `ku edit [scene]` starts the editor instance (or connects to existing one). If a scene name is given, it loads that scene from disk.
2. Editor opens WebSocket on port 21200, writes `.ku.edit.pid` and `.ku.edit.port`
3. `ku play` spawns a play instance that syncs the editor's live tree via WebSocket (not from disk). `ku play --hot-reload` subscribes to incremental deltas so editor edits appear in the running game.
4. Play instance starts on port 21201, writes `.ku.play.pid` and `.ku.play.port`
5. CLI defaults to attached to editor; `ku attach play` switches target
6. `ku stop play` kills the play process — all runtime state is discarded
7. Editor persists across play/stop cycles — scene is never modified by play
8. Multiple CLI clients can attach to the same instance simultaneously

---

## 2. Node System

The scene is a tree of nodes. Every game entity is a node with a type, properties, children, and optional scripts.

### Built-in node types

| Type | Purpose | Key properties |
|------|---------|----------------|
| `Node` | Base container | `position`, `rotation`, `scale` |
| `Node2D` | 2D spatial node | `x`, `y`, `rotation`, `scale_x`, `scale_y` |
| `Sprite` | Renders an image | `texture`, `flip_h`, `flip_v`, `frame`, `hframes` |
| `AnimatedSprite` | Sprite with frames | `frames` (array of textures), `speed`, `playing` |
| `RigidBody` | Physics body | `mass`, `velocity`, `gravity_scale`, `linear_damping`, `width`, `height`, `color` |
| `Area` | Detection zone | `monitorable`, shapes |
| `CollisionShape` | Collision geometry | `shape` (rect/circle/polygon), `size`, `radius`, `color` |
| `Camera2D` | Viewport control | `zoom`, `offset`, `smoothing` |
| `Label` | Text display | `text`, `font_size`, `color` |
| `TileMap` | Grid-based map | `tileset`, `cell_size`, `data` |
| `Timer` | Countdown timer | `wait_time`, `one_shot`, `autostart` |
| `AudioPlayer` | Sound playback | `stream`, `volume`, `playing` |

### Node addressing

Nodes are addressed by path within the tree, similar to a filesystem:

```
/                        → root scene
player                   → top-level node "player"
player/sprite            → child of player
player/hitbox            → another child
enemies/slime_0          → indexed enemy instance
```

### Node data structure

```json
{
  "id": "player",
  "type": "Node2D",
  "properties": {
    "x": 100,
    "y": 300,
    "rotation": 0,
    "scale_x": 1,
    "scale_y": 1,
    "visible": true
  },
  "children": [
    {
      "id": "sprite",
      "type": "Sprite",
      "properties": {
        "texture": "assets/player.png",
        "flip_h": false
      },
      "children": []
    },
    {
      "id": "hitbox",
      "type": "CollisionShape",
      "properties": {
        "shape": "rect",
        "width": 32,
        "height": 48
      },
      "children": []
    }
  ],
  "scripts": []
}
```

---

## 3. Instance Management

### Instance types

| | Editor | Play |
|---|---|---|
| **Purpose** | Scene editing, node CRUD | Game execution, testing |
| **Game loop** | No | Yes (60 FPS) |
| **Physics** | No | Yes |
| **Script execution** | No | Yes |
| **Input handling** | No | Yes (keyboard, mouse, AI) |
| **Renderer** | Optional (preview) | Active |
| **State persistence** | Saved to disk (scene files) | Ephemeral (snapshot, discarded on stop) |
| **Port** | 21200 | 21201 |
| **Discovery files** | `.ku.edit.pid`, `.ku.edit.port` | `.ku.play.pid`, `.ku.play.port` |

### Lifecycle

```
                    ku edit [scene]
                         │
                         ▼
              ┌─────────────────────┐
              │  Editor running     │◄──────────────────────────┐
              │  (port 21200)       │                           │
              └─────────┬───────────┘                           │
                        │                                       │
                   ku play                                      │
                   (snapshot)                                   │
                        │                                       │
                        ▼                                       │
              ┌─────────────────────┐                           │
              │  Play running       │                           │
              │  (port 21201)       │     ku stop play          │
              │  (ephemeral)        │───────────────────────────┘
              └─────────┬───────────┘     (discard state)
                        │
                  ku stop edit
                        │
                        ▼
                 Editor stopped
```

### CLI attachment

The CLI has a **current attachment** that determines which instance receives commands:

- On `ku edit`, CLI is attached to the editor
- On `ku play`, CLI attachment does not change (stays on editor unless explicitly switched)
- `ku attach play` switches CLI to send commands to the play instance
- `ku attach edit` switches back to editor
- `ku detach` disconnects from current instance without stopping it
- `--inst <edit|play>` flag on any command sends to a specific instance without changing attachment

### Concurrent access

- Multiple CLI clients can attach to the same instance
- All clients see the same state
- Write operations are serialized by the instance's command queue
- `ku watch` and `ku log` streams are per-client

---

## 4. CLI Command Surface

All commands output JSON by default. Use `--pretty` for human-readable output.

### Instance management

```
ku edit [scene]              Start editor instance (or connect to existing).
                             Loads scene from disk if name provided.
ku play [--hot-reload]       Spawn play instance synced from editor's live tree.
                             --hot-reload: push editor deltas to running game.
ku stop [edit|play]          Stop an instance (default: play)
ku attach [edit|play]        Attach CLI to an instance
ku detach                    Detach CLI from current instance
ku instances                 List running instances and their status
```

All subsequent commands route to the currently attached instance unless `--inst <edit|play>` is specified.

### Project

```
ku init <name>              Create a new project
ku build                    Validate & bundle project
ku status                   Show server and instance status
```

### Scene (editor instance only)

```
ku scene create <name>      Create empty scene file
ku scene list               List all scenes
ku scene load <name>        Load scene into editor
ku scene tree               Print current node tree
ku scene save [name]        Save editor state to file
```

### Node (editor: read-write | play: read-only)

```
ku node add <path> <type>               Add child node (editor only)
ku node rm <path>                       Remove node (editor only)
ku node set <path>.<prop> <value>       Set property (editor only)
ku node get <path>                      Get all properties (either instance)
ku node get <path>.<prop>               Get single property (either instance)
ku node list <path>                     List children (either instance)
ku node move <path> <new_parent>        Reparent node (editor only)
```

### Runtime control (play instance only)

```
ku pause                     Pause game loop
ku resume                    Resume game loop
ku step                      Advance one frame (when paused)
ku inspect <path>            Detailed node state + scripts (either instance)
ku log [filter]              Stream game log output (either instance)
ku watch <path>.<prop>       Subscribe to property changes (either instance)
```

### AI player input (play instance only)

```
ku input key <key> [down|up]            Simulate key event
ku input click <x> <y>                  Simulate click
ku input axis <name> <value>            Set axis value (-1 to 1)
ku input touch <phase> <x> <y>          Simulate touch (start|move|end)
```

### Query (either instance)

```
ku query scene                          Full scene state as JSON
ku query nodes --type Sprite            Filter nodes by type
ku query collisions                     Active collision pairs (play only)
ku query score                          Custom game variables
ku query diff [since]                   State diff since last query
```

### Output format

Default JSON output:
```json
{"ok": true, "data": {"x": 100, "y": 300}}
```

Error output:
```json
{"ok": false, "error": "node not found: player/legs"}
```

`--pretty` wraps JSON in a formatted view for human reading.

---

## 5. JSON Scene Format

Scenes are stored as `.json` files in the `scenes/` directory.

### Example: `scenes/player.json`

```json
{
  "scene": "player",
  "root": {
    "id": "player",
    "type": "Node2D",
    "properties": {
      "x": 100,
      "y": 300,
      "speed": 200
    },
    "children": [
      {
        "id": "sprite",
        "type": "AnimatedSprite",
        "properties": {
          "frames": ["assets/player_idle.png", "assets/player_run_0.png", "assets/player_run_1.png"],
          "speed": 10,
          "playing": false
        },
        "children": []
      },
      {
        "id": "hitbox",
        "type": "CollisionShape",
        "properties": {
          "shape": "rect",
          "width": 32,
          "height": 48,
          "offset_y": -8
        },
        "children": []
      },
      {
        "id": "camera",
        "type": "Camera2D",
        "properties": {
          "zoom": 2,
          "smoothing": 0.1
        },
        "children": []
      }
    ],
    "scripts": [
      {
        "event": "on_key",
        "filter": {"key": "right"},
        "actions": [
          {"set": "sprite.flip_h", "to": false},
          {"set": "sprite.playing", "to": true},
          {"set": "velocity.x", "to": "{{speed}}"}
        ]
      },
      {
        "event": "on_key",
        "filter": {"key": "left"},
        "actions": [
          {"set": "sprite.flip_h", "to": true},
          {"set": "sprite.playing", "to": true},
          {"set": "velocity.x", "to": "{{-speed}}"}
        ]
      },
      {
        "event": "on_key_up",
        "filter": {"key": "right"},
        "actions": [
          {"set": "sprite.playing", "to": false},
          {"set": "velocity.x", "to": 0}
        ]
      },
      {
        "event": "on_collision",
        "filter": {"with": "coin"},
        "actions": [
          {"destroy": "{{other}}"},
          {"emit": "coin_collected"},
          {"log": "got a coin!"}
        ]
      }
    ]
  }
}
```

### Example: `scenes/level_1.json`

```json
{
  "scene": "level_1",
  "root": {
    "id": "world",
    "type": "Node",
    "properties": {},
    "children": [
      {
        "id": "tilemap",
        "type": "TileMap",
        "properties": {
          "tileset": "assets/tiles.png",
          "cell_size": 16,
          "columns": 40,
          "rows": 25,
          "data": "assets/level_1_map.csv"
        },
        "children": []
      },
      {
        "id": "player",
        "type": "Node2D",
        "properties": {"x": 80, "y": 200},
        "children": [],
        "instance": "scenes/player.json"
      },
      {
        "id": "coins",
        "type": "Node",
        "properties": {},
        "children": [
          {"id": "coin_0", "type": "Sprite", "properties": {"x": 150, "y": 180, "texture": "assets/coin.png", "tag": "coin"}, "children": []},
          {"id": "coin_1", "type": "Sprite", "properties": {"x": 250, "y": 140, "texture": "assets/coin.png", "tag": "coin"}, "children": []}
        ]
      }
    ],
    "scripts": []
  }
}
```

---

## 6. JSON Scripting

Scripts are event-driven rules attached to nodes. Each script has an `event` trigger, an optional `filter`, and a list of `actions`.

### Events

| Event | Trigger | Filter fields |
|-------|---------|---------------|
| `on_key` | Key pressed | `key` |
| `on_key_up` | Key released | `key` |
| `on_frame` | Every frame | `interval` (skip frames) |
| `on_collision` | Collision enters | `with` (node tag or type) |
| `on_collision_exit` | Collision exits | `with` |
| `on_area_enter` | Body enters Area zone | `with` |
| `on_area_exit` | Body leaves Area zone | `with` |
| `on_timer` | Timer node expires | `timer` (node id) |
| `on_touch_start` | Touch/pointer down | — |
| `on_touch_move` | Touch/pointer drag | — |
| `on_touch_end` | Touch/pointer up | — |
| `on_click` | Mouse click | — |
| `on_enter` | Scene loaded | — |
| `on_custom` | Custom event via `emit` | `name` |

### Actions

```json
{"set": "property.path", "to": <value>}
{"set": "property.path", "to": "{{expression}}"}
{"set_on": "target_node", "key": "property", "to": <value>}
{"move": {"x": 10, "y": 0}}
{"move_toward": {"x": 180, "y": 100, "speed": 3}}
{"spawn": "NodeType", "at": {"x": 100, "y": 50}, "as": "bullet_0",
  "properties": {"velocity": {"x": 0, "y": -8}, "gravity_scale": 0},
  "scripts": [{"event": "on_frame", "actions": [...]}]}
{"destroy": "<path_or_self>"}
{"emit": "<event_name>", "data": {...}}
{"play": "<audio_node>", "from": 0}
{"stop": "<audio_node>"}
{"log": "<message>"}
{"call": "<script_name>"}
```

### Expressions

Templates wrapped in `{{ }}` support simple expressions:

```
{{speed}}           → property reference
{{-speed}}          → negated property
{{x + 10}}          → arithmetic (+, -, *, /, %)
{{other.id}}        → collision other's id
{{/player/score}}   → cross-node property reference
{{random(0, 100)}}  → built-in function
```

### Conditions

```json
{
  "event": "on_frame",
  "filter": {"interval": 2},
  "condition": {"velocity.x": {"neq": 0}},
  "actions": [
    {"log": "moving at {{velocity.x}}"}
  ]
}
```

Supported operators: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `in`, `between`.

---

## 7. Client-Server Protocol

Communication happens over WebSocket using JSON messages. Each instance (editor/play) runs its own server on its own port.

### Message format

Every message follows this structure:

```json
{
  "type": "command|query|event|response|diff",
  "id": "unique-message-id",
  "instance": "edit|play",
  "payload": { ... }
}
```

The `instance` field indicates which instance the message targets or originates from. When using `--inst`, the CLI sets this field explicitly. Otherwise it defaults to the currently attached instance.

### Instance discovery

On startup, each instance writes discovery files to the project root:

```
.ku.edit.pid     → editor process ID
.ku.edit.port    → editor WebSocket port (default 21200)
.ku.play.pid     → play process ID (absent if not running)
.ku.play.port    → play WebSocket port (default 21201)
```

The CLI reads these files to find running instances. `ku instances` reports status based on these files plus a liveness check.

### Command (CLI → Server)

```json
{
  "type": "command",
  "id": "cmd-001",
  "payload": {
    "action": "node.set",
    "path": "player",
    "property": "x",
    "value": 150
  }
}
```

### Response (Server → CLI)

```json
{
  "type": "response",
  "id": "cmd-001",
  "payload": {
    "ok": true,
    "data": {"x": 150, "y": 300}
  }
}
```

### State diff (Server → subscribed clients)

```json
{
  "type": "diff",
  "payload": {
    "frame": 1234,
    "changes": [
      {"path": "player.x", "old": 100, "new": 102},
      {"path": "player/sprite.frame", "old": 0, "new": 1}
    ]
  }
}
```

### Event (Server → CLI)

```json
{
  "type": "event",
  "payload": {
    "name": "on_collision",
    "data": {"node": "player", "other": "coin_0"}
  }
}
```

### Connection lifecycle

1. Editor starts, listens on `localhost:21200` (configurable)
2. Play instances listen on `localhost:21201` (configurable)
3. CLI connects, sends command, receives response
4. `ku watch` and `ku log` keep connection open for streaming
5. Multiple CLI clients can connect simultaneously to the same instance
6. Discovery via `.ku.edit.pid`, `.ku.edit.port`, `.ku.play.pid`, `.ku.play.port` files

---

## 8. Project Structure

```
my-game/
├── scenes/
│   ├── player.json
│   ├── enemy.json
│   └── level_1.json
├── assets/
│   ├── sprites/
│   ├── tilesets/
│   ├── audio/
│   └── fonts/
├── scripts/
│   └── (optional reusable script snippets)
├── project.json              Project config
├── ku.json                   Engine config (port, resolution, etc.)
└── README.md
```

### project.json

```json
{
  "name": "hello2d",
  "entry": "scenes/level_1.json",
  "resolution": {"width": 640, "height": 480},
  "physics": {
    "gravity": 980,
    "pixels_per_meter": 100
  }
}
```

---

## 9. Rendering

### Approach

- **Window**: SDL2 via native bindings (e.g., `@kmamal/sdl` or `node-sdl2`)
- **Rendering**: SDL2 renderer API for 2D sprites, shapes, and text
- **Frame loop**: 60 FPS game loop in the server process
- **Camera**: `Camera2D` node determines viewport offset and zoom

### Render pipeline (per frame)

1. Engine updates physics and scripts
2. Renderer traverses node tree depth-first
3. For each visible `Node2D`: compute world transform (parent × child)
4. Draw `Sprite` nodes, `TileMap` nodes, `Label` nodes in tree order
5. `Camera2D` applies viewport offset and zoom to all draws

### Coordinate system

- Origin (0,0) at top-left
- X increases right, Y increases down
- Units are pixels

---

## 10. AI Agent Integration

### AI as developer

The AI agent creates and modifies the game through CLI commands targeting the editor instance:

```bash
# Initialize project
ku init platformer

# Start editing
ku edit level_1

# Build a scene
ku scene create level_1
ku node add / player Node2D --props '{"x":100,"y":300}'
ku node add player sprite Sprite --props '{"texture":"assets/player.png"}'
ku node add player hitbox CollisionShape --props '{"shape":"rect","width":32,"height":48}'

# Add behavior
ku node script player add --event on_key --filter '{"key":"right"}' \
  --actions '[{"set":"velocity.x","to":200}]'

# Save work
ku scene save
```

### AI as player / tester

The AI agent tests its creations by spawning a play instance and interacting with it:

```bash
# Spawn play from current editor state
ku play

# Switch to play instance
ku attach play

# Play the game
ku input key right down        # press right
ku query player.x              # check position: {"x":105}
ku query collisions            # check what player touches

ku input key right up          # release right
ku input key space down        # jump

ku query diff                  # what changed since last check

# Done testing — discard play state, return to editor
ku stop play
ku attach edit
```

### AI iteration workflow

The dual-instance model enables a tight edit-test loop for AI agents:

```bash
ku edit                              # 1. Start editor

# ... create/modify scene ...

ku play                              # 2. Spawn play from snapshot
ku attach play
ku query player.x                    # 3. Inspect play state
ku input key right down              # 4. Test interaction
ku query diff                        # 5. Verify behavior
ku stop play                         # 6. Discard play, return to editor
ku attach edit

# ... fix issues found during testing ...

ku play                              # 7. Re-test with updated scene
```

### Cross-instance queries

AI can query both instances without switching attachment using `--inst`:

```bash
# Compare editor vs play state
ku query scene --inst edit > /tmp/editor_state.json
ku query scene --inst play > /tmp/play_state.json

# Watch play while attached to editor
ku watch player.x --inst play
```

### Key design principles for AI

1. **JSON everywhere** — all input and output is structured JSON, no parsing of prose needed
2. **Queryable state** — `ku query` gives full access to game state
3. **Diffs** — `ku query diff` lets AI understand what changed without re-reading everything
4. **Deterministic** — same inputs produce same outputs (no hidden randomness unless explicitly configured)
5. **Idempotent edits** — `ku node set player.x 100` always produces the same result regardless of current state
6. **Composable** — commands can be scripted and chained
