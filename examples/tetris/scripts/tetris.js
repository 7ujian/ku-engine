var CELL = 24;
var COLS = 10;
var ROWS = 20;
var GRID_X = 20;
var GRID_Y = 20;

var LAYER_BLOCKS = '/layer_blocks';
var LAYER_EFFECTS = '/layer_effects';
var LAYER_OVERLAY = '/layer_overlay';

var PIECES = [
  { shape: [[1,1,1,1]], color: '#00e5e5' },
  { shape: [[1,1],[1,1]], color: '#e5e500' },
  { shape: [[0,1,0],[1,1,1]], color: '#aa00e5' },
  { shape: [[0,1,1],[1,1,0]], color: '#00e500' },
  { shape: [[1,1,0],[0,1,1]], color: '#e50000' },
  { shape: [[1,0,0],[1,1,1]], color: '#0000e5' },
  { shape: [[0,0,1],[1,1,1]], color: '#e58a00' }
];

var LINE_SCORES = [0, 100, 300, 500, 800];

var grid = null;
var score = 0;
var level = 1;
var linesCleared = 0;
var gameOver = false;
var paused = false;
var dropTimer = 0;
var dropInterval = 1000;
var activePiece = null;
var nextPiece = null;
var blockIds = [];

// Effects state
var particles = [];
var particleSeq = 0;
var shakeAmount = 0;
var shakeDuration = 0;
var shakeTimer = 0;

// --- Grid helpers ---

function cloneShape(shape) {
  var out = [];
  for (var i = 0; i < shape.length; i++) out.push(shape[i].slice());
  return out;
}

function emptyRow() {
  var row = [];
  for (var c = 0; c < COLS; c++) row.push(0);
  return row;
}

function initGrid() {
  var g = [];
  for (var r = 0; r < ROWS; r++) g.push(emptyRow());
  return g;
}

// --- Piece helpers ---

function randomPiece() {
  var idx = Math.floor(Math.random() * PIECES.length);
  var p = PIECES[idx];
  return {
    shape: cloneShape(p.shape),
    color: p.color,
    type: idx,
    x: Math.floor((COLS - p.shape[0].length) / 2),
    y: 0
  };
}

function collides(g, piece, dx, dy) {
  var shape = piece.shape;
  for (var r = 0; r < shape.length; r++) {
    for (var c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      var nr = piece.y + r + dy;
      var nc = piece.x + c + dx;
      if (nc < 0 || nc >= COLS || nr >= ROWS) return true;
      if (nr < 0) continue;
      if (g[nr][nc]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  var rows = shape.length;
  var cols = shape[0].length;
  var rotated = [];
  for (var c = 0; c < cols; c++) {
    var row = [];
    for (var r = rows - 1; r >= 0; r--) row.push(shape[r][c]);
    rotated.push(row);
  }
  return rotated;
}

function tryRotate(piece) {
  var rotated = rotateCW(piece.shape);
  var test = { shape: rotated, x: piece.x, y: piece.y };
  var kicks = [[0,0],[-1,0],[1,0],[0,-1],[-2,0],[2,0],[0,-2]];
  for (var i = 0; i < kicks.length; i++) {
    if (!collides(grid, test, kicks[i][0], kicks[i][1])) {
      piece.shape = rotated;
      piece.x += kicks[i][0];
      piece.y += kicks[i][1];
      return true;
    }
  }
  return false;
}

function ghostY(piece) {
  var dy = 0;
  while (!collides(grid, piece, 0, dy + 1)) dy++;
  return piece.y + dy;
}

// --- Rendering ---

function clearDynamic(ctx) {
  for (var i = 0; i < blockIds.length; i++) {
    ctx.scene.destroy('/' + blockIds[i]);
  }
  blockIds = [];
}

function addBlock(ctx, id, x, y, w, h, color) {
  ctx.scene.spawn('Block', id, { x: x + w / 2, y: y + h / 2, width: w, height: h, color: color }, LAYER_BLOCKS);
  blockIds.push(LAYER_BLOCKS + '/' + id);
}

function addOverlay(ctx, id, x, y, text, fontSize, color) {
  ctx.scene.spawn('Label', id, { x: x, y: y, text: text, font_size: fontSize, color: color }, LAYER_OVERLAY);
  blockIds.push(LAYER_OVERLAY + '/' + id);
}

function render(ctx) {
  clearDynamic(ctx);

  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      if (grid[r][c]) {
        addBlock(ctx, 'b' + r + '_' + c,
          GRID_X + c * CELL + 1, GRID_Y + r * CELL + 1,
          CELL - 2, CELL - 2, grid[r][c]);
      }
    }
  }

  if (gameOver) {
    return;
  }

  if (paused) {
    addOverlay(ctx, 'pause_lbl', 100, 250, 'PAUSED', 24, '#ffff00');
    return;
  }

  if (!activePiece) return;

  // Ghost piece
  var gy = ghostY(activePiece);
  if (gy !== activePiece.y) {
    var shape = activePiece.shape;
    for (var r = 0; r < shape.length; r++) {
      for (var c = 0; c < shape[r].length; c++) {
        if (!shape[r][c]) continue;
        addBlock(ctx, 'gh' + r + '_' + c,
          GRID_X + (activePiece.x + c) * CELL + 1, GRID_Y + (gy + r) * CELL + 1,
          CELL - 2, CELL - 2, '#222244');
      }
    }
  }

  // Active piece
  var shape = activePiece.shape;
  for (var r = 0; r < shape.length; r++) {
    for (var c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      addBlock(ctx, 'ap' + r + '_' + c,
        GRID_X + (activePiece.x + c) * CELL + 1, GRID_Y + (activePiece.y + r) * CELL + 1,
        CELL - 2, CELL - 2, activePiece.color);
    }
  }

  // Next piece preview
  var px = GRID_X + COLS * CELL + 30;
  var py = GRID_Y + 170;
  var ns = nextPiece.shape;
  for (var r = 0; r < ns.length; r++) {
    for (var c = 0; c < ns[r].length; c++) {
      if (!ns[r][c]) continue;
      addBlock(ctx, 'np' + r + '_' + c,
        px + c * CELL + 1, py + r * CELL + 1,
        CELL - 2, CELL - 2, nextPiece.color);
    }
  }
}

function updateLabels(ctx) {
  ctx.scene.set('/score_label', 'text', 'SCORE: ' + score);
  ctx.scene.set('/level_label', 'text', 'LEVEL: ' + level);
  ctx.scene.set('/lines_label', 'text', 'LINES: ' + linesCleared);
}

// --- Effects ---

function spawnParticle(ctx, x, y, vx, vy, size, color, life) {
  var id = 'pt' + (particleSeq++);
  ctx.scene.spawn('Block', id,
    { x: x, y: y, width: size, height: size, color: color },
    LAYER_EFFECTS);
  particles.push({
    id: id, x: x, y: y,
    vx: vx, vy: vy,
    size: size, color: color,
    life: life, maxLife: life
  });
}

function spawnBreakParticles(ctx, cells) {
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var cx = GRID_X + cell.c * CELL + CELL / 2;
    var cy = GRID_Y + cell.r * CELL + CELL / 2;
    var count = 2 + Math.floor(Math.random() * 2);
    for (var j = 0; j < count; j++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 100 + Math.random() * 200;
      spawnParticle(ctx, cx, cy,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 120,
        3 + Math.random() * 5,
        cell.color,
        0.4 + Math.random() * 0.4);
    }
  }
}

function spawnPlaceDebris(ctx, cells) {
  for (var i = 0; i < cells.length; i++) {
    var cell = cells[i];
    var cx = GRID_X + cell.c * CELL + CELL / 2;
    var cy = GRID_Y + cell.r * CELL + CELL / 2;
    if (Math.random() > 0.5) {
      spawnParticle(ctx, cx, cy,
        (Math.random() - 0.5) * 60,
        -30 - Math.random() * 80,
        2 + Math.random() * 3,
        cell.color,
        0.2 + Math.random() * 0.3);
    }
  }
}

function triggerShake(amount, duration) {
  shakeAmount = amount;
  shakeDuration = duration;
  shakeTimer = duration;
}

function tickEffects(ctx) {
  var dt = ctx.dt / 1000;

  // Camera shake
  if (shakeTimer > 0) {
    shakeTimer -= ctx.dt;
    if (shakeTimer <= 0) {
      shakeAmount = 0;
      shakeTimer = 0;
      ctx.scene.set('/camera', 'offset_x', 0);
      ctx.scene.set('/camera', 'offset_y', 0);
    } else {
      var progress = shakeTimer / shakeDuration;
      var intensity = shakeAmount * progress;
      ctx.scene.set('/camera', 'offset_x', (Math.random() * 2 - 1) * intensity);
      ctx.scene.set('/camera', 'offset_y', (Math.random() * 2 - 1) * intensity);
    }
  }

  // Particles
  var alive = [];
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      ctx.scene.destroy(LAYER_EFFECTS + '/' + p.id);
      continue;
    }
    p.vy += 600 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    var scale = p.life / p.maxLife;
    var sz = p.size * scale;
    var path = LAYER_EFFECTS + '/' + p.id;
    ctx.scene.set(path, 'x', p.x);
    ctx.scene.set(path, 'y', p.y);
    ctx.scene.set(path, 'width', sz);
    ctx.scene.set(path, 'height', sz);
    alive.push(p);
  }
  particles = alive;
}

function clearEffects(ctx) {
  for (var i = 0; i < particles.length; i++) {
    ctx.scene.destroy(LAYER_EFFECTS + '/' + particles[i].id);
  }
  particles = [];
  shakeAmount = 0;
  shakeTimer = 0;
  ctx.scene.set('/camera', 'offset_x', 0);
  ctx.scene.set('/camera', 'offset_y', 0);
}

function showPanel(ctx) {
  ctx.scene.set('/panel_score', 'text', 'SCORE: ' + score);
  ctx.scene.set('/gameover_panel', 'scale_x', 0);
  ctx.scene.set('/gameover_panel', 'scale_y', 0);
  ctx.scene.set('/gameover_panel', 'visible', true);
  ctx.scene.set('/panel_anim', 'playing', true);
}

function hidePanel(ctx) {
  ctx.scene.set('/panel_anim', 'playing', false);
  ctx.scene.set('/gameover_panel', 'visible', false);
}

// --- Game logic ---

function clearLines(ctx) {
  var cleared = 0;
  var clearedCells = [];
  for (var r = ROWS - 1; r >= 0; r--) {
    var full = true;
    for (var c = 0; c < COLS; c++) {
      if (!grid[r][c]) { full = false; break; }
    }
    if (full) {
      for (var c = 0; c < COLS; c++) {
        clearedCells.push({ r: r, c: c, color: grid[r][c] });
      }
      cleared++;
      grid.splice(r, 1);
      grid.unshift(emptyRow());
      r++;
    }
  }
  if (cleared > 0) {
    score += (LINE_SCORES[cleared] || 800) * level;
    linesCleared += cleared;
    level = Math.floor(linesCleared / 10) + 1;
    dropInterval = Math.max(80, 1000 - (level - 1) * 80);
    spawnBreakParticles(ctx, clearedCells);
    triggerShake(3 + cleared * 2, 200 + cleared * 100);
  }
}

function placePiece(ctx) {
  var piece = activePiece;
  var shape = piece.shape;
  var placedCells = [];
  for (var r = 0; r < shape.length; r++) {
    for (var c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      var gr = piece.y + r;
      var gc = piece.x + c;
      if (gr >= 0 && gr < ROWS && gc >= 0 && gc < COLS) {
        grid[gr][gc] = piece.color;
        placedCells.push({ r: gr, c: gc, color: piece.color });
      }
    }
  }
  spawnPlaceDebris(ctx, placedCells);
  clearLines(ctx);
  spawnPiece(ctx);
}

function spawnPiece(ctx) {
  activePiece = nextPiece;
  nextPiece = randomPiece();
  activePiece.x = Math.floor((COLS - activePiece.shape[0].length) / 2);
  activePiece.y = 0;

  if (collides(grid, activePiece, 0, 0)) {
    gameOver = true;
    showPanel(ctx);
  }
  dropTimer = 0;
  render(ctx);
  updateLabels(ctx);
}

function startGame(ctx) {
  clearDynamic(ctx);
  clearEffects(ctx);
  hidePanel(ctx);
  grid = initGrid();
  score = 0;
  level = 1;
  linesCleared = 0;
  gameOver = false;
  paused = false;
  dropTimer = 0;
  dropInterval = 1000;
  particleSeq = 0;
  nextPiece = randomPiece();
  spawnPiece(ctx);
}

// --- Handlers ---

handlers.on_enter = function(ctx) {
  startGame(ctx);
};

handlers.on_frame = function(ctx) {
  tickEffects(ctx);

  if (gameOver || paused || !activePiece) return;

  dropTimer += ctx.dt;
  if (dropTimer >= dropInterval) {
    dropTimer -= dropInterval;
    if (!collides(grid, activePiece, 0, 1)) {
      activePiece.y++;
      render(ctx);
    } else {
      placePiece(ctx);
    }
  }
};

handlers.on_key = function(ctx) {
  var key = ctx.data.key;

  if (gameOver) {
    if (key === 'R') startGame(ctx);
    return;
  }

  if (key === 'P') {
    paused = !paused;
    if (paused) render(ctx);
    return;
  }

  if (paused) return;
  if (!activePiece) return;

  switch (key) {
    case 'LEFT':
      if (!collides(grid, activePiece, -1, 0)) {
        activePiece.x--;
        render(ctx);
      }
      break;
    case 'RIGHT':
      if (!collides(grid, activePiece, 1, 0)) {
        activePiece.x++;
        render(ctx);
      }
      break;
    case 'DOWN':
      if (!collides(grid, activePiece, 0, 1)) {
        activePiece.y++;
        score += 1;
        dropTimer = 0;
        render(ctx);
        updateLabels(ctx);
      }
      break;
    case 'UP':
      if (tryRotate(activePiece)) render(ctx);
      break;
    case 'SPACE':
      var dropped = 0;
      while (!collides(grid, activePiece, 0, 1)) {
        activePiece.y++;
        dropped++;
      }
      score += dropped * 2;
      triggerShake(2, 100);
      placePiece(ctx);
      updateLabels(ctx);
      break;
  }
};
