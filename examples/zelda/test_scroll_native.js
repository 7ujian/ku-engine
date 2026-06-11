// test_scroll_native.js — Minimal SDL2 scroll test, same backend as ku, no engine overhead.
// Run: node test_scroll_native.js [vsync]
//   vsync=1 (default) or vsync=0
// Keys: V=toggle vsync, ESC=quit

import sdl from '@kmamal/sdl';
import { createCanvas } from '@napi-rs/canvas';

const W = 640, H = 480, SCALE = 2;
const GRID_STEP = 20;
const SPEED = 1.5;
const CAM_MIN = 320, CAM_MAX = 704, CAM_Y = 240;

let useVsync = process.argv[2] !== '0';

let win = sdl.video.createWindow({
  title: `Native SDL2 Scroll Test (vsync=${useVsync})`,
  width: W * SCALE, height: H * SCALE,
  vsync: useVsync,
  resizable: true,
});

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

let camX = CAM_MIN;
let dir = 1;
let running = true;

let lastTime = performance.now();
let fpsAccum = 0, fpsFrames = 0, displayFps = 0, displayFt = 0;

win.on('close', () => { running = false; });
win.on('keyDown', ({ key }) => {
  if (key === 'Escape') { running = false; return; }
  if (key === 'v' || key === 'V') {
    useVsync = !useVsync;
    win.destroy();
    win = sdl.video.createWindow({
      title: `Native SDL2 Scroll Test (vsync=${useVsync})`,
      width: W * SCALE, height: H * SCALE,
      vsync: useVsync,
      resizable: true,
    });
    win.on('close', () => { running = false; });
    win.on('keyDown', arguments.callee); // re-register
    console.log(`VSync: ${useVsync ? 'ON' : 'OFF'}`);
  }
});

function frame() {
  if (!running || win.destroyed) return;

  const now = performance.now();
  const dt = now - lastTime;
  lastTime = now;

  fpsAccum += dt;
  fpsFrames++;
  displayFt = dt;
  if (fpsAccum >= 1000) {
    displayFps = (fpsFrames * 1000 / fpsAccum).toFixed(1);
    fpsFrames = 0;
    fpsAccum = 0;
  }

  // Move camera
  camX += SPEED * dir;
  if (camX >= CAM_MAX) { camX = CAM_MAX; dir = -1; }
  if (camX <= CAM_MIN) { camX = CAM_MIN; dir = 1; }

  const camI = Math.floor(camX);
  const camIY = Math.floor(CAM_Y);
  const offX = W / 2 - camI;
  const offY = H / 2 - camIY;

  // Clear white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // World-space rectangles (camera offset applied)
  ctx.fillStyle = '#cc8888';
  ctx.fillRect(100 + offX - 100, 100 + offY - 100, 200, 200);
  ctx.fillStyle = '#8888cc';
  ctx.fillRect(400 + offX - 100, 300 + offY - 100, 200, 200);

  // Screen-space grid (reference, no camera offset)
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y <= H; y += GRID_STEP) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
  }
  for (let x = 0; x <= W; x += GRID_STEP) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
  }
  ctx.stroke();

  // FPS text
  ctx.fillStyle = '#666';
  ctx.font = '12px monospace';
  ctx.fillText(`FPS: ${displayFps}  Frame: ${displayFt.toFixed(2)}ms  Cam: ${camX.toFixed(2)}  VSync: ${useVsync}`, 8, H - 8);

  // Present
  const buffer = canvas.data();
  win.render(W, H, W * 4, 'rgba32', buffer);

  setImmediate(frame);
}

// Start loop
setImmediate(frame);
