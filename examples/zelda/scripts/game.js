// game.js — Camera follow, HUD update, game state management
var SMOOTH = 0.08;

handlers.on_frame = function (ctx) {
  updateCamera(ctx);
  updateHUD(ctx);
};

function updateCamera(ctx) {
  var px = ctx.scene.get('/player', 'x');
  var py = ctx.scene.get('/player', 'y');
  if (px === undefined) return;

  var cx = ctx.scene.get('/camera', 'offset_x') || px;
  var cy = ctx.scene.get('/camera', 'offset_y') || py;

  var nx = cx + (px - cx) * SMOOTH;
  var ny = cy + (py - cy) * SMOOTH;

  ctx.scene.set('/camera', 'offset_x', nx);
  ctx.scene.set('/camera', 'offset_y', ny);
}

function updateHUD(ctx) {
  var hp = ctx.scene.get('/player', 'hp');
  var score = ctx.scene.get('/player', 'score') || 0;
  var maxHp = ctx.scene.get('/player', 'max_hp') || 5;
  if (hp === undefined) return;

  var camX = ctx.scene.get('/camera', 'offset_x') || 400;
  var camY = ctx.scene.get('/camera', 'offset_y') || 320;
  var hudLeft = camX - 285;
  var hudTop = camY - 205;

  for (var i = 1; i <= 5; i++) {
    var path = '/heart_' + i;
    try {
      ctx.scene.set(path, 'x', hudLeft + (i - 1) * 24);
      ctx.scene.set(path, 'y', hudTop + 12);
      if (i <= hp) {
        ctx.scene.set(path, 'text', '\u2764');
        ctx.scene.set(path, 'color', '#ff3333');
      } else if (i <= maxHp) {
        ctx.scene.set(path, 'text', '\u2661');
        ctx.scene.set(path, 'color', '#666666');
      }
    } catch (e) {}
  }

  try {
    ctx.scene.set('/hud_score', 'x', hudLeft + 400);
    ctx.scene.set('/hud_score', 'y', hudTop + 14);
    ctx.scene.set('/hud_score', 'text', 'Score: ' + score);
  } catch (e) {}

  // Gameover panel follows camera
  var dead = hp <= 0;
  if (dead) {
    try {
      ctx.scene.set('/gameover_panel', 'visible', true);
      ctx.scene.set('/gameover_panel', 'x', camX);
      ctx.scene.set('/gameover_panel', 'y', camY);
    } catch (e) {}
  }
}

handlers.on_key = function (ctx) {
  if (ctx.data.key === 'R') {
    var hp = ctx.scene.get('/player', 'hp');
    if (hp !== undefined && hp <= 0) {
      ctx.emit('restart_game', {});
    }
  }
};

handlers.restart_game = function (ctx) {
  ctx.emit('change_scene', { scene: 'main' });
};

handlers.player_died = function (ctx) {
  try { ctx.scene.set('/gameover_panel', 'visible', true); } catch (e) {}
};

handlers.chest_opened = function (ctx) {
  // Score is already updated by player.js
};
