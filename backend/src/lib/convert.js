// Conversão GLB -> formatos que o SketchUp importa (DAE/Collada, OBJ, STL), usando o Assimp.
// OBJ gera .obj + .mtl + texturas: empacotamos num .zip para o usuário importar tudo junto.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';

const run = promisify(execFile);

// Escala: Meshy/glTF usam metros e eixo Y para cima; o SketchUp usa Z para cima e aceita
// Collada com <up_axis>. O Assimp já grava Y_UP no DAE e o SketchUp converte na importação.
const FORMATS = {
  dae: { ext: 'dae', id: 'collada', mime: 'model/vnd.collada+xml' },
  obj: { ext: 'obj', id: 'obj', mime: 'application/zip', zip: true },
  stl: { ext: 'stl', id: 'stlb', mime: 'model/stl' },
};

export const SKETCHUP_FORMATS = Object.keys(FORMATS);

/** Converte o GLB e retorna { dae: {buffer, mime, filename}, obj: {...}, stl: {...} } */
export async function convertForSketchUp(glb, baseName = 'modelo') {
  const dir = await mkdtemp(join(tmpdir(), 'm3d-'));
  try {
    const src = join(dir, 'in.glb');
    await writeFile(src, glb);
    const out = {};
    for (const [key, f] of Object.entries(FORMATS)) {
      const sub = join(dir, key);
      await run('mkdir', ['-p', sub]);
      const dst = join(sub, `${baseName}.${f.ext}`);
      await run(config.assimpBin, ['export', src, dst, `-f${f.id}`, '-jiv', '-gn'], { timeout: 120_000 });
      if (f.zip) {
        await run('zip', ['-j', '-q', join(dir, `${key}.zip`), ...(await readdir(sub)).map((n) => join(sub, n))]);
        out[key] = { buffer: await readFile(join(dir, `${key}.zip`)), mime: f.mime, filename: `${baseName}-obj.zip` };
      } else {
        out[key] = { buffer: await readFile(dst), mime: f.mime, filename: `${baseName}.${f.ext}` };
      }
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
