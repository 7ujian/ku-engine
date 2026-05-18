// Player spacecraft - handles movement, firing, and collision
// Arrow keys / WASD: move  |  Space: fire  |  Touch: move + fire

var MOVE_SPEED = 5;
var FIRE_COOLDOWN = 8;
var BULLET_COUNT = 5;
var TOUCH_SPEED = 5;
var SCORE_INTERVAL = 6;

var movingLeft = false;
var movingRight = false;
var movingUp = false;
var movingDown = false;
var touching = false;
var firing = false;
var fireCooldown = 0;
var nextBullet = 0;
var tick = 0;

handlers.on_enter = function(ctx) {
  ctx.node.set('dead', false);
  ctx.node.set('score', 0);
  ctx.node.set('tick', 0);
  ctx.node.set('fire_cooldown', 0);
  ctx.node.set('next_bullet', 0);
  ctx.node.set('moving_left', false);
  ctx.node.set('moving_right', false);
  ctx.node.set('moving_up', false);
  ctx.node.set('moving_down', false);
  ctx.node.set('touching', false);
  ctx.node.set('firing', false);
};

handlers.on_key = function(ctx) {
  if (ctx.node.get('dead')) return;

  var key = ctx.data.key;
  if (key === 'LEFT' || key === 'A') ctx.node.set('moving_left', true);
  if (key === 'RIGHT' || key === 'D') ctx.node.set('moving_right', true);
  if (key === 'UP' || key === 'W') ctx.node.set('moving_up', true);
  if (key === 'DOWN' || key === 'S') ctx.node.set('moving_down', true);
  if (key === 'SPACE') ctx.node.set('firing', true);
};

handlers.on_key_up = function(ctx) {
  var key = ctx.data.key;
  if (key === 'LEFT' || key === 'A') ctx.node.set('moving_left', false);
  if (key === 'RIGHT' || key === 'D') ctx.node.set('moving_right', false);
  if (key === 'UP' || key === 'W') ctx.node.set('moving_up', false);
  if (key === 'DOWN' || key === 'S') ctx.node.set('moving_down', false);
  if (key === 'SPACE') ctx.node.set('firing', false);
};

handlers.on_touch_start = function(ctx) {
  if (ctx.node.get('dead')) return;
  ctx.node.set('touch_x', ctx.data.x);
  ctx.node.set('touch_y', ctx.data.y);
  ctx.node.set('touching', true);
  ctx.node.set('firing', true);
};

handlers.on_touch_move = function(ctx) {
  if (ctx.node.get('dead')) return;
  ctx.node.set('touch_x', ctx.data.x);
  ctx.node.set('touch_y', ctx.data.y);
};

handlers.on_touch_end = function(ctx) {
  ctx.node.set('touching', false);
  ctx.node.set('firing', false);
};

handlers.on_frame = function(ctx) {
  if (ctx.node.get('dead')) {
    ctx.node.set('velocity', { x: 0, y: 0 });
    return;
  }

  var vx = 0;
  var vy = 0;

  // Touch movement
  if (ctx.node.get('touching')) {
    ctx.node.set('velocity', { x: 0, y: 0 });
    var tx = ctx.node.get('touch_x') || 0;
    var ty = ctx.node.get('touch_y') || 0;
    var px = ctx.node.get('x') || 0;
    var py = ctx.node.get('y') || 0;
    var dx = tx - px;
    var dy = ty - py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 2) {
      vx = (dx / dist) * TOUCH_SPEED;
      vy = (dy / dist) * TOUCH_SPEED;
    }
  } else {
    // Keyboard movement
    if (ctx.node.get('moving_left')) vx = -MOVE_SPEED;
    else if (ctx.node.get('moving_right')) vx = MOVE_SPEED;

    if (ctx.node.get('moving_up')) vy = -MOVE_SPEED;
    else if (ctx.node.get('moving_down')) vy = MOVE_SPEED;
  }

  ctx.node.set('velocity', { x: vx, y: vy });

  // Fire cooldown
  var fc = ctx.node.get('fire_cooldown') || 0;
  if (fc > 0) ctx.node.set('fire_cooldown', fc - 1);

  // Fire bullets
  if (ctx.node.get('firing') && fc === 0) {
    var nb = ctx.node.get('next_bullet') || 0;
    fireBullet(ctx, nb);
    ctx.node.set('next_bullet', (nb + 1) % BULLET_COUNT);
    ctx.node.set('fire_cooldown', FIRE_COOLDOWN);
  }

  // Score tick
  var t = (ctx.node.get('tick') || 0) + 1;
  ctx.node.set('tick', t);
  if (t >= SCORE_INTERVAL) {
    ctx.node.set('score', (ctx.node.get('score') || 0) + 1);
    ctx.node.set('tick', 0);
  }
};

function fireBullet(ctx, index) {
  var px = ctx.node.get('x') || 0;
  var py = ctx.node.get('y') || 0;
  ctx.scene.set('bullet_' + index, 'x', px);
  ctx.scene.set('bullet_' + index, 'y', py - 16);
  ctx.scene.set('bullet_' + index, 'active', true);
}

handlers.on_collision = function(ctx) {
  if (ctx.node.get('dead')) return;

  var tags = ctx.data.otherTags || [];
  var other = ctx.data.other;

  // Enemy collision
  if (tags.indexOf('enemy') !== -1) {
    killPlayer(ctx);
    ctx.emit('game_over', {});
    return;
  }

  // Boss bullet collision
  if (tags.indexOf('boss_bullet') !== -1) {
    killPlayer(ctx);
    ctx.emit('game_over', {});
    return;
  }
};

function killPlayer(ctx) {
  ctx.node.set('dead', true);
  ctx.node.set('color', '#ff0000');
  ctx.node.set('velocity', { x: 0, y: 0 });
}

handlers.enemy_killed = function(ctx) {
  ctx.node.set('score', (ctx.node.get('score') || 0) + 100);
};

handlers.game_over = function(ctx) {
  ctx.node.set('dead', true);
  ctx.node.set('color', '#444444');
  ctx.node.set('velocity', { x: 0, y: 0 });
  // Stop all bullets
  for (var i = 0; i < BULLET_COUNT; i++) {
    ctx.scene.set('bullet_' + i, 'active', false);
  }
};