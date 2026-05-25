import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: 'ku-tilemap-editor',
  version: '1.0.0',
  init(host) {
    host.registerCliCommand((program) => {
      const tilemap = program.command('tilemap').description('Tilemap tools');

      tilemap
        .command('edit [scene]')
        .description('Open tilemap editor (optionally load an existing scene)')
        .option('--dir <dir>', 'Project directory (default: cwd)')
        .option('--tilemap <path>', 'Path to TileMap node in scene (e.g. /root/ground)')
        .option('--columns <n>', 'Grid columns', '20')
        .option('--rows <n>', 'Grid rows', '15')
        .option('--cell-size <n>', 'Cell size in pixels', '16')
        .action(async (scene, opts) => {
          const projectDir = opts.dir ? resolve(process.cwd(), opts.dir) : process.cwd();
          const columns = parseInt(opts.columns, 10) || 20;
          const rows = parseInt(opts.rows, 10) || 15;
          const cellSize = parseInt(opts.cellSize, 10) || 16;
          const tilemapPath = opts.tilemap || '';

          await ensureProject(projectDir);

          // Read editor scene template
          const scenePath = resolve(__dirname, 'scenes', 'tilemap-editor.json');
          const sceneJson = await readFile(scenePath, 'utf-8');
          const sceneObj = JSON.parse(sceneJson);

          // Inject editor config into root node properties
          setNestedProp(sceneObj, 'editor_columns', columns);
          setNestedProp(sceneObj, 'editor_rows', rows);
          setNestedProp(sceneObj, 'editor_cell_size', cellSize);
          setNestedProp(sceneObj, 'editor_scene', scene || '');
          setNestedProp(sceneObj, 'editor_tilemap_path', tilemapPath);

          // If a scene is specified, try to load its tilemap data
          if (scene) {
            try {
              const sceneFile = resolve(projectDir, 'scenes', `${scene}.json`);
              const sceneData = JSON.parse(readFileSync(sceneFile, 'utf-8'));
              setNestedProp(sceneObj, 'editor_scene_data', JSON.stringify(sceneData));
            } catch { /* scene not found — start blank */ }
          }

          // Write temp scene
          const scenesDir = resolve(projectDir, 'scenes');
          await mkdir(scenesDir, { recursive: true });
          const tmpScene = resolve(scenesDir, '__tilemap_editor_tmp.json');
          sceneObj.scene = '__tilemap_editor_tmp';
          await writeFile(tmpScene, JSON.stringify(sceneObj, null, 2));

          // Copy editor script to project scripts dir
          const scriptSrc = resolve(__dirname, 'scripts', 'tilemap-editor.js');
          const scriptsDir = resolve(projectDir, 'scripts');
          await mkdir(scriptsDir, { recursive: true });
          await writeFile(resolve(scriptsDir, 'tilemap-editor.js'), await readFile(scriptSrc, 'utf-8'));

          // Resolve server entry
          const engineRoot = resolve(__dirname, '..', '..');
          const serverPath = resolve(engineRoot, 'dist', 'server', 'main.js');

          const child = fork(serverPath, [
            '--mode', 'play',
            '--dir', projectDir,
            '--port', '0',
            '--load-scene', '__tilemap_editor_tmp',
          ], { stdio: 'inherit' });

          child.on('exit', async () => {
            try {
              const { unlink } = await import('node:fs/promises');
              await unlink(tmpScene);
            } catch { /* ignore */ }
          });
        });

      tilemap
        .command('export <file>')
        .description('Export tilemap JSON from a scene file')
        .option('--tilemap <path>', 'Path to TileMap node (e.g. /root/ground)')
        .action(async (file, opts) => {
          const absFile = resolve(process.cwd(), file);
          try {
            const sceneData = JSON.parse(await readFile(absFile, 'utf-8'));
            const tilemapPath = opts.tilemap || '';
            const tilemapNode = tilemapPath ? findNode(sceneData.root, tilemapPath.split('/').filter(Boolean)) : findFirstTilemap(sceneData.root);
            if (!tilemapNode || tilemapNode.type !== 'TileMap') {
              console.error(JSON.stringify({ ok: false, error: 'TileMap node not found' }));
              return;
            }
            const exportData = {
              cell_size: tilemapNode.properties.cell_size,
              columns: tilemapNode.properties.columns,
              rows: tilemapNode.properties.rows,
              data: tilemapNode.properties.data,
              terrain_map: tilemapNode.properties.terrain_map,
            };
            console.log(JSON.stringify({ ok: true, data: exportData }));
          } catch (err) {
            console.error(JSON.stringify({ ok: false, error: err.message }));
          }
        });

      tilemap
        .command('add-terrain')
        .description('Add a terrain type to the tilemap editor')
        .requiredOption('--id <n>', 'Terrain ID (1-255)')
        .requiredOption('--atlas <path>', 'Path to atlas JSON file')
        .option('--mode <mode>', 'Autotile mode: 3x3 or fill', '3x3')
        .option('--prefix <prefix>', 'Region name prefix (auto-detect if omitted)')
        .action(async (opts) => {
          const id = parseInt(opts.id, 10);
          if (isNaN(id) || id < 1 || id > 255) {
            console.error(JSON.stringify({ ok: false, error: 'id must be 1-255' }));
            return;
          }
          console.log(JSON.stringify({
            ok: true,
            data: { id, atlas: opts.atlas, mode: opts.mode === 'fill' ? 'fill' : '3x3', prefix: opts.prefix || '' },
          }));
        });

      tilemap
        .command('load <file>')
        .description('Load a tilemap JSON file and show info')
        .action(async (file) => {
          const absFile = resolve(process.cwd(), file);
          try {
            const data = JSON.parse(await readFile(absFile, 'utf-8'));
            console.log(JSON.stringify({
              ok: true,
              data: {
                path: absFile,
                cell_size: data.cell_size,
                columns: data.columns,
                rows: data.rows,
                layers: data.layers ? data.layers.length : 1,
                version: data.version || 'legacy',
              },
            }));
          } catch (err) {
            console.error(JSON.stringify({ ok: false, error: err.message }));
          }
        });
    });

    // Message handler for tilemap save
    host.registerMessageHandler('tilemap.save', (tree, mode, payload) => {
      const { path, tilemapData } = payload;
      if (!path || !tilemapData) {
        return { result: { ok: false, error: 'path and tilemapData required' } };
      }
      const absPath = resolve(host.projectDir, path);
      writeFileSync(absPath, JSON.stringify(tilemapData, null, 2));
      return { result: { ok: true, data: { saved: absPath } } };
    });

    // Message handler for tilemap load
    host.registerMessageHandler('tilemap.load', (tree, mode, payload) => {
      const { path } = payload;
      if (!path) {
        return { result: { ok: false, error: 'path required' } };
      }
      const absPath = path.startsWith('/') ? path : resolve(host.projectDir, path);
      try {
        const data = JSON.parse(readFileSync(absPath, 'utf-8'));
        return { result: { ok: true, data } };
      } catch (err) {
        return { result: { ok: false, error: err.message } };
      }
    });

    // Message handler for tileset atlas load
    host.registerMessageHandler('tileset.load', (tree, mode, payload) => {
      const { path } = payload;
      if (!path) {
        return { result: { ok: false, error: 'path required' } };
      }
      const absPath = path.startsWith('/') ? path : resolve(host.projectDir, path);
      try {
        const data = JSON.parse(readFileSync(absPath, 'utf-8'));
        return { result: { ok: true, data } };
      } catch (err) {
        return { result: { ok: false, error: err.message } };
      }
    });
  },
};

async function ensureProject(dir) {
  await mkdir(dir, { recursive: true });
  const projectJson = resolve(dir, 'project.json');
  if (!existsSync(projectJson)) {
    await writeFile(projectJson, JSON.stringify({
      name: 'tilemap-editor',
      entry: '__tilemap_editor_tmp',
      window: { width: 1024, height: 768, scale_mode: 'system', resizable: true },
    }, null, 2));
  }
}

function setNestedProp(scene, path, value) {
  const parts = path.split('/');
  const propName = parts.pop();
  let node = findNode(scene.root, parts);
  if (node && propName) {
    node.properties[propName] = value;
  }
}

function findNode(nodeData, pathParts) {
  let current = nodeData;
  for (const part of pathParts) {
    if (!current.children) return null;
    current = current.children.find(c => c.id === part);
    if (!current) return null;
  }
  return current;
}

function findFirstTilemap(nodeData) {
  if (nodeData.type === 'TileMap') return nodeData;
  if (nodeData.children) {
    for (const child of nodeData.children) {
      const found = findFirstTilemap(child);
      if (found) return found;
    }
  }
  return null;
}
