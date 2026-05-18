// Generates the spacecraft sprite atlas (PNG + JSON) using @napi-rs/canvas
// Pixel-art sprites defined as 2D character arrays for precision
// Run: node scripts/generate-sprites.js

import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dir, '..', 'assets');

// Palette
const P = {
  '.': null,       // transparent
  'c': '#00ccdd',  // player body
  'C': '#44ffff',  // player highlight
  'd': '#005566',  // player cockpit
  'e': '#ff8800',  // engine dim
  'E': '#ffcc00',  // engine bright
  'r': '#dd3333',  // small enemy body
  'R': '#ff6666',  // small enemy highlight
  'y': '#ffff00',  // eyes
  'o': '#cc4422',  // medium enemy body
  'O': '#ff8866',  // medium enemy highlight
  'a': '#993311',  // armor dark
  'l': '#cc6622',  // large enemy body
  'L': '#ffaa66',  // large enemy highlight
  'A': '#885522',  // cannon
  'p': '#aa00dd',  // boss body
  'P': '#dd66ff',  // boss highlight
  'I': '#7700aa',  // boss armor
  'k': '#ff0044',  // boss eye
  'g': '#660088',  // boss cannon
  'm': '#ff00ff',  // core/boss bullet
  'M': '#ff44ff',  // core alt
  'w': '#ffffff',  // white
  'Y': '#ffff44',  // bright yellow
  'j': '#ff8800',  // orange fire
  'J': '#ff4400',  // red fire
  'n': '#aa2200',  // dark fire
  'G': '#555555',  // gray smoke
  'S': '#333333',  // dark smoke
  'D': '#444444',  // mid smoke
  'b': '#000000',  // outline
};

// ── Sprite pixel maps ──

// Player ship (20x26) pointing UP - 4 frames (engine glow varies)
const PLAYER = [
  // frame 0
  [
    '........bb........',
    '.......brrb.......',
    '......brrrrb......',
    '.....brrCrrrb.....',
    '....brrrCrrrrb....',
    '...brrrrCrrrrrb...',
    '..brrrrrCrrrrrrb..',
    '.brrrrrrCrrrrrrrb.',
    'brrrrrrrCrrrrrrrrb',
    '.brrrrrddrrrrrrb..',
    '..brrrddddrrrrb...',
    '...brddddddrb.....',
    '...brddddddrb.....',
    '....bdddddb......',
    '.....bdddb.......',
    '......bdb........',
    '......bHb........',
    '.....bHHHb.......',
    '.....bHHHb.......',
    '......bHb........',
    '......bHb........',
    '.....bHHHb.......',
    '.....bHHHb.......',
    '......bHb........',
    '.......b........',
    '................',
  ],
  // frame 1 - engine brighter
  [
    '........bb........',
    '.......brrb.......',
    '......brrrrb......',
    '.....brrCrrrb.....',
    '....brrrCrrrrb....',
    '...brrrrCrrrrrb...',
    '..brrrrrCrrrrrrb..',
    '.brrrrrrCrrrrrrrb.',
    'brrrrrrrCrrrrrrrrb',
    '.brrrrrddrrrrrrb..',
    '..brrrddddrrrrb...',
    '...brddddddrb.....',
    '...brddddddrb.....',
    '....bdddddb......',
    '.....bdddb.......',
    '......bdb........',
    '......bHb........',
    '.....bHHHb.......',
    '....bHHHHHb......',
    '....bHHHHHb......',
    '.....bHHHb.......',
    '......bHb........',
    '......bHb........',
    '.......b.........',
    '................',
    '................',
  ],
];

// I'll generate simpler but cleaner shapes

const PLAYER_0 = `
....................
.........cc.........
........cccc........
.......ccccc........
......ccccccc.......
.....ccccCccc.......
....cccccccCcc......
...ccccccccCccc.....
..cccccccccCcccc....
.cccccccccddccccc...
.ccccccdddccccccc..
..ccccddddddccccc..
...ccddddddccc.....
....cdddddcc......
.....cddddc........
......cddc..........
.......cc...........
.......ee...........
......eeee..........
......eEEe..........
......eeee..........
.......ee...........
....................
`.trim();

const PLAYER_1 = `
....................
.........cc.........
........cccc........
.......ccccc........
......ccccccc.......
.....ccccCccc.......
....cccccccCcc......
...ccccccccCccc.....
..cccccccccCcccc....
.cccccccccddccccc...
.ccccccdddccccccc..
..ccccddddddccccc..
...ccddddddccc.....
....cdddddcc......
.....cddddc........
......cddc..........
.......cc...........
.......ee...........
......eeee..........
.....eEEEEe.........
......eeee..........
.....eEEEEe.........
.......ee...........
`.trim();

const PLAYER_2 = `
....................
.........cc.........
........cccc........
.......ccccc........
......ccccccc.......
.....ccccCccc.......
....cccccccCcc......
...ccccccccCccc.....
..cccccccccCcccc....
.cccccccccddccccc...
.ccccccdddccccccc..
..ccccddddddccccc..
...ccddddddccc.....
....cdddddcc......
.....cddddc........
......cddc..........
.......cc...........
.......ee...........
......eeee..........
......eEEe..........
......eeee..........
......eEEe..........
.......ee...........
`.trim();

const PLAYER_3 = `
....................
.........cc.........
........cccc........
.......ccccc........
......ccccccc.......
.....ccccCccc.......
....cccccccCcc......
...ccccccccCccc.....
..cccccccccCcccc....
.cccccccccddccccc...
.ccccccdddccccccc..
..ccccddddddccccc..
...ccddddddccc.....
....cdddddcc......
.....cddddc........
......cddc..........
.......cc...........
.......ee...........
......eeee..........
.....eEEEEe.........
......eeee..........
.....eEEEEe.........
......eEEe..........
`.trim();

// Small enemy (16x16) pointing DOWN
const ENEMY_S_0 = `
................
......rrrr......
.....rRRRr......
....rrRRRRrr....
...rrrRRRRrrr...
..rrrrrrrrrrrr..
..rrryyyryyyrr..
..rrrrrrrrrrrr..
.rrrrrrrrrrrrrr.
rrrrrrrrrrrrrrrr
.rrrrrRRRrrrrrr.
..rrrrRRRrrrrr..
...rrrrrrrrrr...
....rrrrrrrr....
.....rrrrrr.....
......rrrr......
`.trim();

const ENEMY_S_1 = `
................
......rrrr......
.....rRRRr......
....rrRRRRrr....
...rrrRRRRrrr...
..rrrrrrrrrrrr..
..rrryyyryyyrr..
..rrrrrrrrrrrr..
.rrrrrrrrrrrrrr.
rrrrrrrrrrrrrrrr
rrrrrrrrrrrrrrrr
.rrrrrRRRrrrrrr.
..rrrrRRRrrrrr..
...rrrrrrrrrr...
....rrrrrrrr....
.....rrrrrr.....
`.trim();

const ENEMY_S_2 = ENEMY_S_0;
const ENEMY_S_3 = `
................
......rrrr......
.....rRRRr......
....rrRRRRrr....
...rrrRRRRrrr...
..rrrrrrrrrrrr..
..rrryyyryyyrr..
..rrrrrrrrrrrr..
.rrrrrrrrrrrrrr.
rrrrrrrrrrrrrrrr
.rrrrrRRRrrrrrr.
..rrrrRRRrrrrr..
...rrrrrrrrrr...
....rrrrrrrr....
.....rrrrrr.....
......rr........
`.trim();

// Medium enemy (24x24) pointing DOWN
const ENEMY_M_0 = `
........................
..........oooo..........
.........oOOOo..........
........ooOOOOoo........
.......oooOOOOooo.......
......ooooOOOOOooo......
.....ooooooOyOoooo......
.....oooooyyyOoooo......
.....ooooooOyOoooo......
....oooooooOOooooooo....
...ooooooooOOoooooooo...
..oooooooooaAOaAoooooooo..
..ooooooooaAAaAAoooooooo..
..oooooooooaAOaAoooooooo..
...oooooooooOOooooooooo...
....oooooooooOOoooooooo....
.....oooooooOOOoooooo......
......ooooooOOOooooo.......
.......oooooOOOoooo........
........ooooOOOooo.........
.........oooOOOoo..........
..........ooOOOo...........
...........oooo............
........................
`.trim();

const ENEMY_M_1 = `
........................
..........oooo..........
.........oOOOo..........
........ooOOOOoo........
.......oooOOOOooo.......
......ooooOOOOOooo......
.....ooooooOyOoooo......
.....oooooyyyOoooo......
.....ooooooOyOoooo......
....oooooooOOooooooo....
...ooooooooOOoooooooo...
..oooooooooaAOaAoooooooo..
..ooooooooaAAaAAoooooooo..
..oooooooooaAOaAoooooooo..
...oooooooooOOooooooooo...
....oooooooooOOoooooooo....
.....oooooooOOOoooooo......
......ooooooOOOooooo.......
.......oooooOOOoooo........
........ooooOOOooo.........
.........oooOOOoo..........
..........ooOOOo...........
...........oooo............
........................
`.trim();

// Large enemy (32x32)
const ENEMY_L_0 = `
................................
..............llllllll..............
.............lLLLLLLl..............
............llLLLLLLll............
...........lllLLLLLLlll...........
..........llllLLLLLLllll..........
.........lllllLLLLLLlllll.........
........lllllllLLLLLLllllll.......
.......lllllllllLLLLLLlllllll......
......lllllllllllLLLLLLllllllll....
.....lllllllllllllLLLLLLlllllllll..
....llllllllllyyylllLLLLlllllllll..
....lllllllllllyyylllLLLLllllllll..
....llllllllllyyylllLLLLlllllllll..
....lllllllllllLLLLLLLLLLLLllllll..
.....llllllLLLLLLLLLLLLLLLLlllll..
......lllllLLLLLLLLLLLLLLLLllll...
.......llllLLLLLLLLLLLLLLLLlll....
........lllLLLLLLLaaLLLaaLLLll....
.........llLLLLLLaaaaLLLaaLLll.....
..........lLLLLLLLLLLLLLLLLLll....
...........llLLLLLLLLLLLLLLl......
............lllLLLLLLLLLLl.......
.............lllLLLLLLLLl........
..............llLLLLLLLLl.......
...............llLLLLLLl........
................llLLLLl.........
.................lllll..........
................................
`.trim();

// Simplify: I'll draw clean shapes directly on canvas instead of pixel maps.
// The pixel map approach is error-prone for these sizes. Let me use canvas drawing.

function main() {
  mkdirSync(outDir, { recursive: true });
  const atlas = createCanvas(256, 256);
  const ctx = atlas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);

  const regions = [];
  let y = 0;

  // Helper: register frames
  function addFrames(prefix, count, w, h, drawFn) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      const x = i * (w + 2);
      drawFn(ctx, x, y, w, h, i);
      regions.push({ name: `${prefix}_${i}`, x, y, width: w, height: h });
      frames.push(`${prefix}_${i}`);
    }
    y += h + 2;
    return frames;
  }

  const playerFrames = addFrames('player', 4, 20, 26, drawPlayer);
  const enemySFrames = addFrames('enemy_small', 4, 16, 16, drawEnemySmall);
  const enemyMFrames = addFrames('enemy_medium', 4, 24, 24, drawEnemyMed);
  const enemyLFrames = addFrames('enemy_large', 4, 32, 32, drawEnemyLarge);
  const bossFrames = addFrames('boss', 4, 60, 40, drawBoss);
  const bulletPFrames = addFrames('bullet_player', 1, 8, 14, drawPlayerBullet);
  const bulletBFrames = addFrames('bullet_boss', 2, 10, 14, drawBossBullet);
  const explosionFrames = addFrames('explosion', 5, 24, 24, drawExplosion);

  // Write PNG
  writeFileSync(resolve(outDir, 'spritesheet.png'), atlas.toBuffer('image/png'));

  // Write atlas JSON
  writeFileSync(resolve(outDir, 'sprites.atlas.json'),
    JSON.stringify({ texture: 'spritesheet.png', regions }, null, 2) + '\n');

  // Write animations JSON
  writeFileSync(resolve(outDir, 'animations.json'),
    JSON.stringify({
      player_idle: { frames: playerFrames, speed: 8, loop: true, ping_pong: true },
      enemy_small_idle: { frames: enemySFrames, speed: 6, loop: true, ping_pong: true },
      enemy_medium_idle: { frames: enemyMFrames, speed: 6, loop: true, ping_pong: true },
      enemy_large_idle: { frames: enemyLFrames, speed: 6, loop: true, ping_pong: true },
      boss_idle: { frames: bossFrames, speed: 4, loop: true, ping_pong: true },
      bullet_player: { frames: bulletPFrames, speed: 1, loop: true },
      bullet_boss: { frames: bulletBFrames, speed: 10, loop: true },
      explosion: { frames: explosionFrames, speed: 12, loop: false },
    }, null, 2) + '\n');

  console.log(`Atlas generated: ${regions.length} regions`);
}

function fill(ctx, color, ...args) { ctx.fillStyle = color; ctx.fillRect(...args); }

function drawPlayer(ctx, ox, oy, w, h, f) {
  // Cyan fighter ship pointing UP, 20x26
  fill(ctx, '#00bbcc', ox+8,oy, 4,3);          // nose tip
  fill(ctx, '#00bbcc', ox+7,oy+3, 6,2);
  fill(ctx, '#00ccdd', ox+5,oy+5, 10,5);        // upper body
  fill(ctx, '#00ccdd', ox+4,oy+10, 12,5);       // mid body
  fill(ctx, '#00bbcc', ox+2,oy+12, 4,6);        // left wing
  fill(ctx, '#00bbcc', ox+14,oy+12, 4,6);       // right wing
  fill(ctx, '#009999', ox+1,oy+16, 2,4);        // left wing tip
  fill(ctx, '#009999', ox+17,oy+16, 2,4);       // right wing tip
  fill(ctx, '#00ccdd', ox+3,oy+15, 14,4);       // lower body
  fill(ctx, '#005566', ox+8,oy+6, 4,3);         // cockpit
  fill(ctx, '#44ffff', ox+9,oy+10, 2,7);        // center stripe
  // Engine glow - varies by frame
  const eLen = [3, 5, 4, 6][f];
  const eCol = ['#ff8800', '#ffcc00', '#ff8800', '#ffaa00'][f];
  fill(ctx, eCol, ox+6,oy+19, 3,eLen);
  fill(ctx, eCol, ox+11,oy+19, 3,eLen);
  fill(ctx, '#ffcc00', ox+7,oy+19, 1,Math.max(1,eLen-1));
  fill(ctx, '#ffcc00', ox+12,oy+19, 1,Math.max(1,eLen-1));
}

function drawEnemySmall(ctx, ox, oy, w, h, f) {
  // Red angular enemy pointing DOWN, 16x16
  fill(ctx, '#cc2222', ox+5,oy, 6,2);           // bottom tip (nose down)
  fill(ctx, '#cc2222', ox+4,oy+2, 8,3);
  fill(ctx, '#dd3333', ox+3,oy+5, 10,3);        // body
  fill(ctx, '#dd3333', ox+2,oy+8, 12,3);
  fill(ctx, '#cc2222', ox+1,oy+11, 14,2);       // wide
  fill(ctx, '#bb1111', ox+0,oy+13, 4,2);        // wing tips
  fill(ctx, '#bb1111', ox+12,oy+13, 4,2);
  fill(ctx, '#ffff00', ox+5,oy+6, 2,2);         // left eye
  fill(ctx, '#ffff00', ox+9,oy+6, 2,2);         // right eye
  fill(ctx, '#ff6666', ox+7,oy+4, 2,3);         // center highlight
  // Animation: slight body shift
  if (f % 2 === 1) {
    fill(ctx, '#dd3333', ox+3,oy+10, 2,2);
    fill(ctx, '#dd3333', ox+11,oy+10, 2,2);
  }
}

function drawEnemyMed(ctx, ox, oy, w, h, f) {
  // Orange wider enemy pointing DOWN, 24x24
  fill(ctx, '#bb3311', ox+8,oy, 8,2);           // nose
  fill(ctx, '#cc4422', ox+6,oy+2, 12,3);
  fill(ctx, '#cc4422', ox+4,oy+5, 16,4);        // body
  fill(ctx, '#cc4422', ox+3,oy+9, 18,4);
  fill(ctx, '#bb3311', ox+2,oy+13, 20,3);       // wide
  fill(ctx, '#aa2200', ox+1,oy+16, 5,3);        // wing armor
  fill(ctx, '#aa2200', ox+18,oy+16, 5,3);
  fill(ctx, '#cc4422', ox+4,oy+16, 16,3);
  fill(ctx, '#cc4422', ox+6,oy+19, 12,3);
  fill(ctx, '#bb3311', ox+8,oy+22, 8,2);
  fill(ctx, '#ffff00', ox+7,oy+6, 3,2);         // eyes
  fill(ctx, '#ffff00', ox+14,oy+6, 3,2);
  fill(ctx, '#ff8866', ox+11,oy+10, 2,5);       // center stripe
  if (f % 2 === 1) {
    fill(ctx, '#cc4422', ox+0,oy+14, 3,3);
    fill(ctx, '#cc4422', ox+21,oy+14, 3,3);
  }
}

function drawEnemyLarge(ctx, ox, oy, w, h, f) {
  // Large orange enemy pointing DOWN, 32x32
  fill(ctx, '#bb5511', ox+11,oy, 10,2);          // nose
  fill(ctx, '#cc6622', ox+9,oy+2, 14,3);
  fill(ctx, '#cc6622', ox+7,oy+5, 18,4);         // upper body
  fill(ctx, '#cc6622', ox+5,oy+9, 22,4);         // mid body
  fill(ctx, '#cc6622', ox+3,oy+13, 26,4);        // lower body
  fill(ctx, '#bb5511', ox+2,oy+17, 28,4);        // wide base
  fill(ctx, '#aa4411', ox+1,oy+21, 30,3);
  fill(ctx, '#aa4411', ox+2,oy+24, 28,3);
  fill(ctx, '#993311', ox+0,oy+17, 4,4);         // wing armor
  fill(ctx, '#993311', ox+28,oy+17, 4,4);
  fill(ctx, '#885522', ox+0,oy+21, 3,4);         // cannons
  fill(ctx, '#885522', ox+29,oy+21, 3,4);
  fill(ctx, '#cc6622', ox+4,oy+24, 24,3);
  fill(ctx, '#bb5511', ox+6,oy+27, 20,2);
  fill(ctx, '#bb5511', ox+9,oy+29, 14,2);
  fill(ctx, '#ffff00', ox+9,oy+6, 3,2);          // triple eyes
  fill(ctx, '#ffff00', ox+14,oy+6, 4,2);
  fill(ctx, '#ffff00', ox+20,oy+6, 3,2);
  fill(ctx, '#ffaa66', ox+14,oy+11, 4,14);       // center stripe
  if (f % 2 === 1) {
    fill(ctx, '#ffffff', ox+10,oy+7, 1,1);
    fill(ctx, '#ffffff', ox+15,oy+7, 2,1);
    fill(ctx, '#ffffff', ox+21,oy+7, 1,1);
  }
}

function drawBoss(ctx, ox, oy, w, h, f) {
  // Massive purple boss pointing DOWN, 60x40
  // Hull
  fill(ctx, '#9900bb', ox+18,oy, 24,2);
  fill(ctx, '#aa00dd', ox+12,oy+2, 36,3);
  fill(ctx, '#aa00dd', ox+8,oy+5, 44,4);
  fill(ctx, '#aa00dd', ox+5,oy+9, 50,4);
  fill(ctx, '#aa00dd', ox+3,oy+13, 54,5);
  fill(ctx, '#9900bb', ox+2,oy+18, 56,5);
  fill(ctx, '#9900bb', ox+3,oy+23, 54,4);
  fill(ctx, '#8800aa', ox+5,oy+27, 50,3);
  fill(ctx, '#8800aa', ox+8,oy+30, 44,3);
  fill(ctx, '#8800aa', ox+12,oy+33, 36,3);
  fill(ctx, '#770099', ox+16,oy+36, 28,3);
  // Side armor
  fill(ctx, '#7700aa', ox+3,oy+13, 8,5);
  fill(ctx, '#7700aa', ox+49,oy+13, 8,5);
  fill(ctx, '#7700aa', ox+2,oy+18, 6,5);
  fill(ctx, '#7700aa', ox+52,oy+18, 6,5);
  fill(ctx, '#660088', ox+0,oy+20, 3,8);
  fill(ctx, '#660088', ox+57,oy+20, 3,8);
  // Central core (pulses)
  const coreCol = f % 2 === 0 ? '#ff00ff' : '#ff44ff';
  fill(ctx, coreCol, ox+22,oy+8, 16,18);
  fill(ctx, '#dd66ff', ox+25,oy+10, 10,14);
  fill(ctx, '#ffffff', ox+28,oy+14, 4,6);
  // Eyes
  fill(ctx, '#ff0044', ox+12,oy+6, 5,3);
  fill(ctx, '#ff0044', ox+43,oy+6, 5,3);
  if (f % 2 === 0) {
    fill(ctx, '#ffffff', ox+13,oy+7, 2,1);
    fill(ctx, '#ffffff', ox+44,oy+7, 2,1);
  }
  // Cannons
  fill(ctx, '#660088', ox+8,oy+30, 4,5);
  fill(ctx, '#660088', ox+26,oy+33, 4,4);
  fill(ctx, '#660088', ox+48,oy+30, 4,5);
  // Detail lines
  fill(ctx, '#dd66ff', ox+18,oy+22, 2,8);
  fill(ctx, '#dd66ff', ox+40,oy+22, 2,8);
  // Wing edge highlights
  fill(ctx, '#dd66ff', ox+2,oy+18, 1,4);
  fill(ctx, '#dd66ff', ox+57,oy+18, 1,4);
}

function drawPlayerBullet(ctx, ox, oy, w, h, f) {
  // Yellow energy bolt going UP
  fill(ctx, '#ffff00', ox+3,oy, 2,3);
  fill(ctx, '#ffff00', ox+2,oy+3, 4,4);
  fill(ctx, '#ffff00', ox+3,oy+7, 2,5);
  fill(ctx, '#ffffff', ox+3,oy+4, 2,4);
}

function drawBossBullet(ctx, ox, oy, w, h, f) {
  // Purple energy ball going DOWN
  const c = f % 2 === 0 ? '#ff00ff' : '#dd00dd';
  fill(ctx, c, ox+3,oy+2, 4,8);
  fill(ctx, c, ox+2,oy+3, 6,6);
  fill(ctx, c, ox+1,oy+4, 8,4);
  fill(ctx, '#ffffff', ox+4,oy+5, 2,3);
}

function drawExplosion(ctx, ox, oy, w, h, f) {
  const cx = ox + 12, cy = oy + 12;
  if (f === 0) {
    fill(ctx, '#ffffff', cx-3,cy-3, 6,6);
    fill(ctx, '#ffff88', cx-5,cy-5, 10,10);
  } else if (f === 1) {
    fill(ctx, '#ffff44', cx-6,cy-6, 12,12);
    fill(ctx, '#ff8800', cx-8,cy-8, 16,16);
    fill(ctx, '#ffffff', cx-3,cy-3, 6,6);
  } else if (f === 2) {
    fill(ctx, '#ff8800', cx-8,cy-8, 16,16);
    fill(ctx, '#ff4400', cx-10,cy-10, 20,20);
    fill(ctx, '#ffff44', cx-5,cy-5, 10,10);
  } else if (f === 3) {
    fill(ctx, '#ff4400', cx-9,cy-9, 18,18);
    fill(ctx, '#aa2200', cx-11,cy-11, 22,22);
    fill(ctx, '#ff8800', cx-6,cy-6, 12,12);
  } else {
    fill(ctx, '#555555', cx-8,cy-8, 16,16);
    fill(ctx, '#333333', cx-10,cy-10, 20,20);
    fill(ctx, '#444444', cx-6,cy-6, 12,12);
  }
}

main();
