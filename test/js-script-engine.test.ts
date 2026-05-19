import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Node } from '../src/engine/node.js';
import { SceneTree } from '../src/engine/scene-tree.js';
import { JsScriptEngine } from '../src/engine/js-script-engine.js';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

describe('JsScriptEngine', () => {
  let tmpDir: string;
  let tree: SceneTree;

  function loadSource(scriptPath: string): Promise<string> {
    return Promise.resolve(readFileSync(resolve(tmpDir, scriptPath), 'utf-8'));
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ku-js-test-'));
    const root = new Node('root', 'Node');
    const player = new Node('player', 'RigidBody', { x: 100, y: 200, speed: 5 });
    root.addChild(player);
    tree = new SceneTree(root);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('compiles and dispatches event handlers', async () => {
    const scriptPath = join(tmpDir, 'player.js');
    writeFileSync(scriptPath, `
      handlers.on_frame = function(ctx) {
        ctx.node.set('x', ctx.node.get('x') + 1);
      };
    `);

    (tree.get('player') as any).js_script = 'player.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', { frame: 1 });
    expect(tree.get('player').getProperty('x')).toBe(101);

    engine.evaluateEvent('on_frame', { frame: 2 });
    expect(tree.get('player').getProperty('x')).toBe(102);
  });

  it('passes event data to handlers', async () => {
    const scriptPath = join(tmpDir, 'player.js');
    writeFileSync(scriptPath, `
      handlers.on_key = function(ctx) {
        ctx.node.set('last_key', ctx.data.key);
      };
    `);

    (tree.get('player') as any).js_script = 'player.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_key', { key: 'SPACE' });
    expect(tree.get('player').getProperty('last_key')).toBe('SPACE');
  });

  it('supports scene.get and scene.set', async () => {
    const other = new Node('target', 'Node2D', { x: 50 });
    tree.root.addChild(other);

    const scriptPath = join(tmpDir, 'player.js');
    writeFileSync(scriptPath, `
      handlers.on_frame = function(ctx) {
        ctx.scene.set('target', 'x', 999);
        var val = ctx.scene.get('target', 'x');
        ctx.node.set('read_val', val);
      };
    `);

    (tree.get('player') as any).js_script = 'player.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', {});
    expect(tree.get('target').getProperty('x')).toBe(999);
    expect(tree.get('player').getProperty('read_val')).toBe(999);
  });

  it('supports scene.spawn and scene.destroy', async () => {
    const scriptPath = join(tmpDir, 'player.js');
    writeFileSync(scriptPath, `
      handlers.on_frame = function(ctx) {
        ctx.scene.spawn('Node2D', 'bullet', { x: 10, y: 20 });
      };
      handlers.on_key = function(ctx) {
        ctx.scene.destroy('bullet');
      };
    `);

    (tree.get('player') as any).js_script = 'player.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', {});
    const bullet = tree.get('bullet');
    expect(bullet).toBeDefined();
    expect(bullet.getProperty('x')).toBe(10);

    engine.evaluateEvent('on_key', { key: 'X' });
    expect(() => tree.get('bullet')).toThrow();
  });

  it('persists script state across invocations', async () => {
    const scriptPath = join(tmpDir, 'counter.js');
    writeFileSync(scriptPath, `
      var count = 0;
      handlers.on_frame = function(ctx) {
        count++;
        ctx.node.set('count', count);
      };
    `);

    (tree.get('player') as any).js_script = 'counter.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', {});
    expect(tree.get('player').getProperty('count')).toBe(1);

    engine.evaluateEvent('on_frame', {});
    expect(tree.get('player').getProperty('count')).toBe(2);
  });

  it('catches and logs errors without crashing', async () => {
    const scriptPath = join(tmpDir, 'broken.js');
    writeFileSync(scriptPath, `
      handlers.on_frame = function(ctx) {
        throw new Error('oops');
      };
    `);

    (tree.get('player') as any).js_script = 'broken.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', {});
    expect(engine.getLogs().length).toBeGreaterThan(0);
    expect(engine.getLogs()[0]).toContain('oops');
  });

  it('sandbox blocks access to require', async () => {
    const scriptPath = join(tmpDir, 'sandbox.js');
    writeFileSync(scriptPath, `
      handlers.on_frame = function(ctx) {
        try {
          var fs = require('fs');
          ctx.node.set('leaked', true);
        } catch(e) {
          ctx.node.set('blocked', true);
        }
      };
    `);

    (tree.get('player') as any).js_script = 'sandbox.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', {});
    expect(tree.get('player').getProperty('blocked')).toBe(true);
    expect(tree.get('player').getProperty('leaked')).toBeUndefined();
  });

  it('unregisterNodeById stops dispatch', async () => {
    const scriptPath = join(tmpDir, 'player.js');
    writeFileSync(scriptPath, `
      handlers.on_frame = function(ctx) {
        ctx.node.set('x', ctx.node.get('x') + 1);
      };
    `);

    (tree.get('player') as any).js_script = 'player.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_frame', {});
    expect(tree.get('player').getProperty('x')).toBe(101);

    engine.unregisterNodeById('player');
    engine.evaluateEvent('on_frame', {});
    expect(tree.get('player').getProperty('x')).toBe(101); // unchanged
  });

  it('supports ctx.emit for custom events', async () => {
    const scriptPath = join(tmpDir, 'player.js');
    writeFileSync(scriptPath, `
      handlers.on_key = function(ctx) {
        ctx.emit('custom_event', { source: ctx.node.id });
      };
    `);

    (tree.get('player') as any).js_script = 'player.js';
    const engine = new JsScriptEngine({ tree, projectDir: tmpDir, loadSource });
    await engine.registerTree();

    engine.evaluateEvent('on_key', { key: 'SPACE' });
    // emit goes through the event bus — just verify no crash
    expect(engine.getLogs()).toHaveLength(0);
  });
});
