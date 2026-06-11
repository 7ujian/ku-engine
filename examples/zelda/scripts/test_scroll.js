// test_scroll.js — Ping-pong camera scroll test for jitter diagnosis
var SPEED = 1.5;       // pixels per frame
var MIN_X = 320;       // left edge (half viewport width)
var MAX_X = 704;       // right edge (map_width - half viewport: 1024 - 320)
var Y = 384;           // fixed Y (half viewport height)
var direction = 1;

handlers.on_enter = function (ctx) {
  ctx.scene.set('/camera', 'offset_x', MIN_X);
  ctx.scene.set('/camera', 'offset_y', Y);
  direction = 1;
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
