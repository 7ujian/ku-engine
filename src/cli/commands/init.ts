import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export async function initCommand(projectName: string, targetDir?: string): Promise<void> {
  const dir = resolve(targetDir ?? projectName);

  if (existsSync(dir)) {
    printJson({ ok: false, error: `directory already exists: ${dir}` });
    return;
  }

  await mkdir(resolve(dir, 'scenes'), { recursive: true });

  const project = {
    name: projectName,
    entry: 'scenes/main.json',
    window: {
      width: 800,
      height: 600,
      resizable: true,
      hidpi: true,
      stretch_mode: 'disabled',
      stretch_aspect: 'keep',
      scale_mode: 'fractional',
      scale: 1,
    },
  };
  await writeFile(resolve(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n', 'utf-8');

  printJson({ ok: true, data: { created: dir } });
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}
