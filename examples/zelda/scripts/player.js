// player.js — Player movement, animation, combat, health
var SPEED = 2.0;
var ATTACK_DURATION = 250;
var ATTACK_COOLDOWN = 400;
var INVINCIBLE_TIME = 1000;
var SWORD_OFFSET = 24;

var keys = { LEFT: false, RIGHT: false, UP: false, DOWN: false, A: false, D: false, W: false, S: false };
var attackTimer = 0;

handlers.on_enter = function (ctx) {
  ctx.node.set('hp', 5);
  ctx.node.set('max_hp', 5);
  ctx.node.set('score', 0);
  ctx.node.set('attacking', false);
  ctx.node.set('attack_timer', 0);
  ctx.node.set('attack_cooldown', 0);
  ctx.node.set('invincible_timer', 0);
  ctx.node.set('direction', 'down');
  ctx.node.set('moving', false);
  ctx.node.set('animation', 'idle_down');
  ctx.node.set('playing', true);
  attackTimer = 0;
  keys = { LEFT: false, RIGHT: false, UP: false, DOWN: false, A: false, D: false, W: false, S: false };
};

handlers.on_key = function (ctx) {
  var k = ctx.data.key;
  if (k === 'LEFT' || k === 'A') keys.LEFT = true;
  if (k === 'RIGHT' || k === 'D') keys.RIGHT = true;
  if (k === 'UP' || k === 'W') keys.UP = true;
  if (k === 'DOWN' || k === 'S') keys.DOWN = true;

  if (k === 'SPACE') {
    var cd = ctx.node.get('attack_cooldown') || 0;
    var attacking = ctx.node.get('attacking');
    if (cd <= 0 && !attacking) {
      ctx.node.set('attacking', true);
      ctx.node.set('attack_timer', ATTACK_DURATION);
      ctx.node.set('attack_cooldown', ATTACK_COOLDOWN);
      attackTimer = ATTACK_DURATION;
      // Enable sword hitbox
      var dir = ctx.node.get('direction') || 'down';
      var ox = 0, oy = SWORD_OFFSET;
      if (dir === 'up') oy = -SWORD_OFFSET;
      else if (dir === 'left') { ox = -SWORD_OFFSET; oy = 0; }
      else if (dir === 'right') { ox = SWORD_OFFSET; oy = 0; }
      try {
        ctx.scene.set('/player/sword_hitbox', 'x', ox);
        ctx.scene.set('/player/sword_hitbox', 'y', oy);
        ctx.scene.set('/player/sword_hitbox', 'collision_mask', 2);
      } catch (e) {}
    }
  }

  // Chest interaction
  if (k === 'E') {
    var px = ctx.node.get('x');
    var py = ctx.node.get('y');
    try {
      var cx = ctx.scene.get('/chest', 'x');
      var cy = ctx.scene.get('/chest', 'y');
      var dx = px - cx, dy = py - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 36) {
        var opened = ctx.scene.get('/chest', 'frame') || 0;
        if (opened === 0) {
          ctx.scene.set('/chest', 'frame', 1);
          var score = (ctx.node.get('score') || 0) + 100;
          ctx.node.set('score', score);
          ctx.emit('chest_opened', { score: score });
        }
      }
    } catch (e) {}
  }
};

handlers.on_key_up = function (ctx) {
  var k = ctx.data.key;
  if (k === 'LEFT' || k === 'A') keys.LEFT = false;
  if (k === 'RIGHT' || k === 'D') keys.RIGHT = false;
  if (k === 'UP' || k === 'W') keys.UP = false;
  if (k === 'DOWN' || k === 'S') keys.DOWN = false;
};

handlers.on_frame = function (ctx) {
  var dt = ctx.dt;
  var hp = ctx.node.get('hp');
  if (hp <= 0) return;

  // Movement
  var vx = 0, vy = 0;
  var direction = ctx.node.get('direction') || 'down';

  if (keys.LEFT) { vx = -SPEED; direction = 'left'; }
  else if (keys.RIGHT) { vx = SPEED; direction = 'right'; }
  if (keys.UP) { vy = -SPEED; direction = 'up'; }
  else if (keys.DOWN) { vy = SPEED; direction = 'down'; }

  ctx.node.set('velocity', { x: vx, y: vy });
  var isMoving = vx !== 0 || vy !== 0;
  ctx.node.set('moving', isMoving);
  ctx.node.set('direction', direction);

  // Animation + flip
  var attacking = ctx.node.get('attacking');
  ctx.node.set('flip_h', direction === 'left');
  if (attacking) {
    ctx.node.set('animation', 'attack_' + direction);
  } else if (isMoving) {
    ctx.node.set('animation', 'walk_' + direction);
  } else {
    ctx.node.set('animation', 'idle_' + direction);
  }

  // Attack timer
  if (attackTimer > 0) {
    attackTimer -= dt;
    if (attackTimer <= 0) {
      attackTimer = 0;
      ctx.node.set('attacking', false);
      ctx.node.set('attack_timer', 0);
      try { ctx.scene.set('/player/sword_hitbox', 'collision_mask', 0); } catch (e) {}
    }
  }

  // Cooldowns
  var cd = ctx.node.get('attack_cooldown') || 0;
  if (cd > 0) ctx.node.set('attack_cooldown', Math.max(0, cd - dt));

  var inv = ctx.node.get('invincible_timer') || 0;
  if (inv > 0) {
    ctx.node.set('invincible_timer', Math.max(0, inv - dt));
    // Flicker effect
    ctx.node.set('visible', Math.floor(inv / 80) % 2 === 0);
  } else {
    ctx.node.set('visible', true);
  }
};

handlers.on_collision = function (ctx) {
  var otherTags = ctx.data.otherTags || [];
  var hp = ctx.node.get('hp') || 0;
  var inv = ctx.node.get('invincible_timer') || 0;

  if (otherTags.indexOf('enemy') !== -1 && inv <= 0 && hp > 0) {
    var newHp = hp - 1;
    ctx.node.set('hp', newHp);
    ctx.node.set('invincible_timer', INVINCIBLE_TIME);
    if (newHp <= 0) {
      ctx.node.set('hp', 0);
      ctx.node.set('velocity', { x: 0, y: 0 });
      ctx.emit('player_died', {});
    }
  }
};
