// test_scroll_rect.js — Minimal ping-pong camera scroll with reference grid
var SPEED = 1.5;
var MIN_X = 320;
var MAX_X = 704;
var Y = 240;
var direction = 1;

handlers.on_enter = function (ctx) {
  ctx.scene.set('/camera', 'offset_x', MIN_X);
  ctx.scene.set('/camera', 'offset_y', Y);
  direction = 1;

  // Build reference grid in screen-space CanvasLayer
  // Block renders centered: fillRect(wx - w/2, wy - h/2, w, h)
  var color = 'rgba(0,0,0,0.08)';
  var step = 20;
  var sw = 640;
  var sh = 480;
  var container = '/grid_layer/grid_container';

  // Horizontal lines (full width, 1px tall)
  for (var y = 0; y <= sh; y += step) {
    ctx.scene.spawn('Block', 'h' + y, { x: sw / 2, y: y, width: sw, height: 1, color: color }, container);
  }
  // Vertical lines (1px wide, full height)
  for (var x = 0; x <= sw; x += step) {
    ctx.scene.spawn('Block', 'v' + x, { x: x, y: sh / 2, width: 1, height: sh, color: color }, container);
  }
};

handlers.on_frame = function (ctx) {
  var cx = ctx.scene.get('/camera', 'offset_x');
  cx = cx + SPEED * direction;

  if (cx >= MAX_X) {
    cx = MAX_X;
    direction = -1;
  } else if (cx <= MIN_X) {
    cx = MIN_X;
    direction = 1;
  }

  ctx.scene.set('/camera', 'offset_x', cx);
};
