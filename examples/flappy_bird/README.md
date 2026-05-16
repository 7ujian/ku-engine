# Flappy Bird Example

A simple Flappy Bird clone built entirely with ku's JSON scene format and scripting system.

## How to play

1. Build the engine from the project root:
```bash
cd ../../          # back to ku-engine root
npm run build
```

2. From this directory, start the editor with the scene loaded, then play:
```bash
cd examples/flappy_bird
node ../../src/bin/ku.ts edit main
```
In a new terminal (same directory):
```bash
node ../../src/bin/ku.ts play
```

3. A window opens — press **SPACE** or **Up arrow** to flap. Avoid the green pipes and ground/ceiling.

4. To restart after game over:
```bash
node ../../src/bin/ku.ts stop play
node ../../src/bin/ku.ts play
```

## How it works

- **Bird**: A `RigidBody` node that falls with gravity. The `on_key` script (space/up) sets `velocity.y` to -4, making the bird flap upward.
- **Pipes**: `CollisionShape` nodes (static bodies). `on_frame` scripts scroll them left at 2.5 px/frame. A second `on_frame` script with a condition (`x < -30`) wraps them back to the right edge.
- **Ground/Ceiling**: Static `CollisionShape` rects at the bottom and top.
- **Death**: The bird's `on_collision` script sets `dead = true`, zeroes velocity, and disables gravity.
- **Visuals**: The renderer draws yellow rects for `RigidBody` nodes and green rects for `CollisionShape` nodes. No texture assets needed.

## Node tree

```
root
├── ground        (CollisionShape 640x40 at y=460)
├── ceiling       (CollisionShape 640x40 at y=-20)
├── bird          (RigidBody at x=150, y=220)
├── pipe_0_top    (CollisionShape 52x90)
├── pipe_0_bot    (CollisionShape 52x170)
├── pipe_1_top    (CollisionShape 52x150)
├── pipe_1_bot    (CollisionShape 52x110)
├── pipe_2_top    (CollisionShape 52x70)
├── pipe_2_bot    (CollisionShape 52x190)
└── title_label   (Label "FLAPPY BIRD — SPACE to flap")
```
