// enemy.js — Enemy patrol/chase AI, damage, death
var PATROL_SPEED = 0.4;
var CHASE_SPEED = 1.2;
var CHASE_RANGE = 140;
var PATROL_INTERVAL = 2000;
var FLASH_TIME = 150;

var patrolDir = 0;
var patrolTimer = 0;
var flashTimer = 0;
var dead = false;

handlers.on_enter = function (ctx) {
  patrolDir = Math.floor(Math.random() * 4);
  patrolTimer = PATROL_INTERVAL * (0.5 + Math.random());
  flashTimer = 0;
  dead = false;
};

handlers.on_frame = function (ctx) {
  var dt = ctx.dt;
  if (dead) return;

  var hp = ctx.node.get('hp');
  if (hp <= 0) {
    handleDeath(ctx, dt);
    return;
  }

  // Get player position
  var px, py;
  try {
    px = ctx.scene.get('/player', 'x');
    py = ctx.scene.get('/player', 'y');
  } catch (e) { px = undefined; }

  var ex = ctx.node.get('x');
  var ey = ctx.node.get('y');
  var vx = 0, vy = 0;
  var speed = PATROL_SPEED;
  var chasing = false;

  if (px !== undefined) {
    var dx = px - ex;
    var dy = py - ey;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < CHASE_RANGE && dist > 0) {
      chasing = true;
      speed = CHASE_SPEED;
      vx = (dx / dist) * speed;
      vy = (dy / dist) * speed;
    }
  }

  if (!chasing) {
    patrolTimer -= dt;
    if (patrolTimer <= 0) {
      patrolDir = Math.floor(Math.random() * 4);
      patrolTimer = PATROL_INTERVAL * (0.5 + Math.random());
    }
    switch (patrolDir) {
      case 0: vy = speed; break;
      case 1: vx = -speed; break;
      case 2: vx = speed; break;
      case 3: vy = -speed; break;
    }
  }

  ctx.node.set('velocity', { x: vx, y: vy });
  ctx.node.set('animation', chasing ? 'move' : 'idle');
  ctx.node.set('playing', true);

  // Damage flash
  if (flashTimer > 0) {
    flashTimer -= dt;
  }
};

handlers.on_collision = function (ctx) {
  var otherTags = ctx.data.otherTags || [];
  var hp = ctx.node.get('hp') || 0;
  if (hp <= 0) return;

  if (otherTags.indexOf('sword') !== -1) {
    ctx.node.set('hp', hp - 1);
    flashTimer = FLASH_TIME;
    if (hp - 1 <= 0) {
      ctx.node.set('hp', 0);
      ctx.node.set('death_timer', 600);
      ctx.node.set('animation', 'death');
      ctx.node.set('playing', true);
    }
  }
};

function handleDeath(ctx, dt) {
  var timer = ctx.node.get('death_timer') || 0;
  timer -= dt;
  if (timer <= 0) {
    dead = true;
    ctx.node.set('velocity', { x: 0, y: 0 });
    ctx.node.set('collision_mask', 0);
    ctx.node.set('visible', false);
  } else {
    ctx.node.set('death_timer', timer);
  }
}
