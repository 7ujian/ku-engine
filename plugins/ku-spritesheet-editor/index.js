import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { loadImage } from '@napi-rs/canvas';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  name: 'ku-spritesheet-editor',
  version: '1.0.0',
  init(host) {
    host.registerCliCommand((program) => {
      const spritesheet = program.command('spritesheet').description('Sprite sheet tools');

      spritesheet
        .command('edit <image>')
        .description('Open sprite sheet editor')
        .option('--atlas <path>', 'Load existing atlas JSON')
        .option('--dir <dir>', 'Project directory (default: image directory)')
        .action(async (image, opts) => {
          const absImage = resolve(process.cwd(), image);
          const atlas = opts.atlas ? resolve(process.cwd(), opts.atlas) : '';

          // Use explicit dir, or the image's parent directory as project root
          const projectDir = opts.dir ? resolve(process.cwd(), opts.dir) : dirname(absImage);

          // Ensure minimal project structure
          await ensureProject(projectDir);

          // Read editor scene template
          const scenePath = resolve(__dirname, 'scenes', 'spritesheet-editor.json');
          const sceneJson = await readFile(scenePath, 'utf-8');
          const scene = JSON.parse(sceneJson);

          // Inject image path into the spritesheet ImageRect node
          setNestedProp(scene, 'viewport/spritesheet/texture', absImage);

          // Detect image dimensions and set on spritesheet node for 1:1 rendering
          try {
            const img = await loadImage(absImage);
            setNestedProp(scene, 'viewport/spritesheet/width', img.width);
            setNestedProp(scene, 'viewport/spritesheet/height', img.height);
          } catch { /* use default 256x256 */ }
          if (atlas) {
            setNestedProp(scene, 'viewport/spritesheet/atlas', atlas);

            // Pre-load atlas regions into the root node for the editor script to read
            try {
              const atlasData = JSON.parse(readFileSync(atlas, 'utf-8'));
              if (atlasData.regions && Array.isArray(atlasData.regions)) {
                setNestedProp(scene, 'atlas_data', JSON.stringify(atlasData));
              }
            } catch { /* atlas not found or invalid — skip */ }
          }

          // Write temp scene
          const scenesDir = resolve(projectDir, 'scenes');
          await mkdir(scenesDir, { recursive: true });
          const tmpScene = resolve(scenesDir, '__spritesheet_editor_tmp.json');
          scene.scene = '__spritesheet_editor_tmp';
          await writeFile(tmpScene, JSON.stringify(scene, null, 2));

          // Copy editor script to project scripts dir
          const scriptSrc = resolve(__dirname, 'scripts', 'spritesheet-editor.js');
          const scriptsDir = resolve(projectDir, 'scripts');
          await mkdir(scriptsDir, { recursive: true });
          await writeFile(resolve(scriptsDir, 'spritesheet-editor.js'), await readFile(scriptSrc, 'utf-8'));

          // Resolve server entry relative to engine root
          const engineRoot = resolve(__dirname, '..', '..');
          const serverPath = resolve(engineRoot, 'dist', 'server', 'main.js');

          const child = fork(serverPath, [
            '--mode', 'play',
            '--dir', projectDir,
            '--port', '0',
            '--load-scene', '__spritesheet_editor_tmp',
          ], { stdio: 'inherit' });

          child.on('exit', async () => {
            try {
              const { unlink } = await import('node:fs/promises');
              await unlink(tmpScene);
            } catch { /* ignore */ }
          });
        });

      spritesheet
        .command('list <atlas>')
        .description('List regions in atlas file')
        .action(async (atlasPath) => {
          const absAtlas = resolve(process.cwd(), atlasPath);
          try {
            const atlas = JSON.parse(await readFile(absAtlas, 'utf-8'));
            const regions = atlas.regions ?? [];
            console.log(JSON.stringify({ ok: true, data: { texture: atlas.texture, regions } }));
          } catch (err) {
            console.error(JSON.stringify({ ok: false, error: `cannot read atlas: ${err.message}` }));
          }
        });

      spritesheet
        .command('inspect <image>')
        .description('Show image info')
        .action(async (imagePath) => {
          console.log(JSON.stringify({
            ok: true,
            data: {
              path: resolve(process.cwd(), imagePath),
              name: basename(imagePath),
            },
          }));
        });
    });

    // Message handler for atlas save
    host.registerMessageHandler('spritesheet.save', (tree, mode, payload) => {
      const { path, atlas } = payload;
      if (!path || !atlas) {
        return { result: { ok: false, error: 'path and atlas required' } };
      }
      const absPath = resolve(host.projectDir, path);
      writeFileSync(absPath, JSON.stringify(atlas, null, 2));
      return { result: { ok: true, data: { saved: absPath } } };
    });

    // Message handler for atlas load
    host.registerMessageHandler('spritesheet.load', (tree, mode, payload) => {
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
      name: 'spritesheet-editor',
      entry: '__spritesheet_editor_tmp',
      window: { width: 800, height: 600, scale_mode: 'system', resizable: true },
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
