// game.js — Camera follow, HUD update, game state management
var SMOOTH = 1.0;
var LEVEL_FILE = 'village';
var LEVEL_NODES = ['village_map', 'spawn_point', 'chest', 'player', 'slime_0', 'slime_1'];

handlers.on_enter = function (ctx) {
  // Load level content into root (app nodes like camera, HUD stay untouched)
  ctx.scene.load_scene('/', LEVEL_FILE);
};

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

  // Frame-rate independent lerp
  var factor = 1 - Math.pow(1 - SMOOTH, ctx.dt / 16.667);
  var nx = cx + (px - cx) * factor;
  var ny = cy + (py - cy) * factor;

  ctx.scene.set('/camera', 'offset_x', nx);
  ctx.scene.set('/camera', 'offset_y', ny);
}

function updateHUD(ctx) {
  var hp = ctx.scene.get('/player', 'hp');
  var score = ctx.scene.get('/player', 'score') || 0;
  var maxHp = ctx.scene.get('/player', 'max_hp') || 5;
  if (hp === undefined) return;

  var fullTex = 'assets/heart_full.png';
  var emptyTex = 'assets/heart_empty.png';

  for (var i = 1; i <= 5; i++) {
    var path = '/hud/heart_' + i;
    try {
      if (i <= hp) {
        ctx.scene.set(path, 'texture', fullTex);
      } else if (i <= maxHp) {
        ctx.scene.set(path, 'texture', emptyTex);
      }
    } catch (e) {}
  }

  try {
    ctx.scene.set('/hud/hud_score', 'text', 'Score: ' + score);
  } catch (e) {}
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
  // Container-based restart for wrapper scenes (main); change_scene for self-contained (house)
  var hasVillageMap = ctx.scene.find('/village_map') !== null;
  if (hasVillageMap) {
    for (var i = 0; i < LEVEL_NODES.length; i++) {
      try { ctx.scene.destroy('/' + LEVEL_NODES[i]); } catch (e) {}
    }
    ctx.scene.load_scene('/', LEVEL_FILE);
    try { ctx.scene.set('/hud/gameover_panel', 'visible', false); } catch (e) {}
  } else {
    ctx.emit('change_scene', { scene: 'house' });
  }
};

handlers.player_died = function (ctx) {
  try { ctx.scene.set('/hud/gameover_panel', 'visible', true); } catch (e) {}
};

handlers.chest_opened = function (ctx) {
  // Score is already updated by player.js
};
