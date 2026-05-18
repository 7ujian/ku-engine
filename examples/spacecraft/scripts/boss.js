// Boss behavior for spacecraft game
// Spawns at score 500, sweeps left-right, fires bullet spreads, punches with claws, takes 30 hits to kill

var SPAWN_SCORE = 500;
var MAX_HP = 30;
var SWEEP_SPEED = 1.5;
var FIRE_INTERVAL = 40;
var FLASH_FRAMES = 6;
var BULLET_COUNT = 5;
var PUNCH_INTERVAL = 80;
var CLAW_EXTEND_MAX = 60;
var CLAW_RETRACT_SPEED = 4;

var fireTimer = 0;
var nextBullet = 0;
var spawned = false;
var punchTimer = 0;

handlers.on_enter = function(ctx) {
  ctx.node.set('hp', MAX_HP);
  ctx.node.set('active', false);
  ctx.node.set('sweep_dir', 1);
  ctx.node.set('flash_timer', 0);
  ctx.node.set('punch_timer', 0);
  ctx.node.set('punching', false);
  ctx.node.set('claw_extend', 0);
};

handlers.on_frame = function(ctx) {
  var active = ctx.node.get('active');
  var playerScore = ctx.scene.get('player', 'score') || 0;
  var playerDead = ctx.scene.get('player', 'dead');

  // Spawn boss when score threshold reached
  if (!active && !spawned && playerScore >= SPAWN_SCORE) {
    spawned = true;
    ctx.node.set('active', true);
    ctx.node.set('x', 180);
    ctx.node.set('y', 80);
    ctx.node.set('hp', MAX_HP);
    ctx.node.set('color', '#cc00ff');
    ctx.node.set('velocity', { x: 0, y: 0 });
    ctx.node.set('claw_extend', 0);
    ctx.node.set('punching', false);
    ctx.node.set('punch_timer', 0);
  }

  if (!active) return;

  // Stop moving if player is dead
  if (playerDead) {
    ctx.node.set('color', '#444444');
    ctx.node.set('claw_extend', 0);
    ctx.node.set('punching', false);
    return;
  }

  var x = ctx.node.get('x') || 180;
  var sweepDir = ctx.node.get('sweep_dir') || 1;

  // Sweep left-right
  x += SWEEP_SPEED * sweepDir;
  if (x > 300) sweepDir = -1;
  if (x < 60) sweepDir = 1;
  ctx.node.set('x', x);
  ctx.node.set('sweep_dir', sweepDir);
  ctx.node.set('velocity', { x: 0, y: 0 });

  // Flash effect when hit
  var ft = ctx.node.get('flash_timer') || 0;
  if (ft > 0) {
    ft--;
    ctx.node.set('flash_timer', ft);
    ctx.node.set('color', ft % 2 === 0 ? '#ffffff' : '#cc00ff');
  } else {
    ctx.node.set('color', '#cc00ff');
  }

  // Handle claw punch animation
  var punchTimer = ctx.node.get('punch_timer') || 0;
  var punching = ctx.node.get('punching') || false;
  var clawExtend = ctx.node.get('claw_extend') || 0;

  if (punching) {
    punchTimer++;
    clawExtend = Math.min(clawExtend + 8, CLAW_EXTEND_MAX);
    ctx.node.set('claw_extend', clawExtend);

    // Claws fully extended, start retracting
    if (punchTimer >= 20) {
      punching = false;
      ctx.node.set('punching', false);
    }
  } else {
    // Retract claws when not punching
    if (clawExtend > 0) {
      clawExtend = Math.max(clawExtend - CLAW_RETRACT_SPEED, 0);
      ctx.node.set('claw_extend', clawExtend);
    }
  }

  // Punch timer logic
  var pt = ctx.node.get('punch_timer') || 0;
  if (pt > 0 && !punching) {
    pt--;
    ctx.node.set('punch_timer', pt);
  }

  // Trigger punch at intervals
  if (pt === 0 && clawExtend === 0) {
    var frameCount = ctx.node.get('_frameCount') || 0;
    ctx.node.set('_frameCount', frameCount + 1);
    if (frameCount >= PUNCH_INTERVAL) {
      ctx.node.set('_frameCount', 0);
      ctx.node.set('punching', true);
      ctx.node.set('punch_timer', 1);
      // Move claws outward
      ctx.scene.set('boss/claw_left', 'x', -44 - CLAW_EXTEND_MAX);
      ctx.scene.set('boss/claw_right', 'x', 44 + CLAW_EXTEND_MAX);
    }
  } else {
    var fc = ctx.node.get('_frameCount') || 0;
    ctx.node.set('_frameCount', fc + 1);
  }

  // Update claw positions based on extend
  var extend = ctx.node.get('claw_extend') || 0;
  ctx.scene.set('boss/claw_left', 'x', -44 - extend);
  ctx.scene.set('boss/claw_right', 'x', 44 + extend);

  // Fire bullets periodically (only when not punching)
  fireTimer++;
  if (fireTimer >= FIRE_INTERVAL && !punching) {
    fireTimer = 0;
    fireAtPlayer(ctx);
  }

  // Update HP label
  var hp = ctx.node.get('hp') || 0;
  ctx.scene.set('boss_hp_label', 'text', 'BOSS: ' + hp + '/' + MAX_HP);
};

function fireAtPlayer(ctx) {
  var bx = ctx.node.get('x') || 180;
  var by = (ctx.node.get('y') || 80) + 25;

  // Fire a spread of 3 bullets
  var bulletId = 'boss_bullet_' + nextBullet;
  nextBullet = (nextBullet + 1) % BULLET_COUNT;

  ctx.scene.set(bulletId, 'x', bx);
  ctx.scene.set(bulletId, 'y', by);
  ctx.scene.set(bulletId, 'active', true);
}

handlers.on_collision = function(ctx) {
  var active = ctx.node.get('active');
  if (!active) return;

  // Only react to player bullets
  var tags = ctx.data.otherTags;
  if (!tags || tags.indexOf('bullet') === -1) return;

  var hp = (ctx.node.get('hp') || 1) - 1;
  ctx.node.set('hp', hp);
  ctx.node.set('flash_timer', FLASH_FRAMES);

  if (hp <= 0) {
    ctx.node.set('active', false);
    ctx.node.set('y', -200);
    ctx.node.set('color', '#444444');
    ctx.node.set('claw_extend', 0);
    ctx.scene.set('boss_hp_label', 'text', '');
    ctx.scene.set('boss/claw_left', 'x', -44);
    ctx.scene.set('boss/claw_right', 'x', 44);
    var score = ctx.scene.get('player', 'score') || 0;
    ctx.scene.set('player', 'score', score + 1000);
    ctx.emit('boss_killed');
  }
};

handlers.game_over = function(ctx) {
  ctx.node.set('active', false);
  ctx.node.set('color', '#444444');
  ctx.node.set('claw_extend', 0);
  ctx.node.set('punching', false);
  ctx.scene.set('boss/claw_left', 'x', -44);
  ctx.scene.set('boss/claw_right', 'x', 44);
  // Deactivate all boss bullets
  for (var i = 0; i < BULLET_COUNT; i++) {
    ctx.scene.set('boss_bullet_' + i, 'active', false);
    ctx.scene.set('boss_bullet_' + i, 'y', -100);
  }
};

handlers.boss_killed = function(ctx) {
  // Victory effects could go here
};