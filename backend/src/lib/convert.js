// Conversões com o Assimp.
//  - SketchUp -> app: DAE (ou ZIP com DAE + texturas), OBJ, STL, GLB  => GLB
//  - app -> SketchUp: GLB => DAE (Collada), OBJ+MTL (zip), STL
// O Assimp preserva hierarquia (grupos/componentes), materiais, unidades e eixo:
// um DAE do SketchUp (polegadas, Z para cima) vira um GLB com um nó raiz que carrega
// essa conversão; ao exportar de volta, o Assimp detecta o nó raiz e grava polegadas/Z_UP.
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { renameGLBNodes } from './glb.js';

const run = promisify(execFile);

const FORMATS = {
  dae: { ext: 'dae', id: 'collada', mime: 'model/vnd.collada+xml' },
  obj: { ext: 'obj', id: 'obj', mime: 'application/zip', zip: true },
  stl: { ext: 'stl', id: 'stlb', mime: 'model/stl' },
};
export const SKETCHUP_FORMATS = Object.keys(FORMATS);
export const IMPORT_EXTS = ['dae', 'zip', 'glb', 'obj', 'stl'];

/** Converte o GLB e retorna { dae: {buffer, mime, filename}, obj: {...}, stl: {...} } */
export async function convertForSketchUp(glb, baseName = 'modelo') {
  const dir = await mkdtemp(join(tmpdir(), 'm3d-'));
  try {
    const src = join(dir, 'in.glb');
    await writeFile(src, glb);
    const out = {};
    for (const [key, f] of Object.entries(FORMATS)) {
      const sub = join(dir, key);
      await mkdir(sub, { recursive: true });
      const dst = join(sub, `${baseName}.${f.ext}`);
      await run(config.assimpBin, ['export', src, dst, `-f${f.id}`, '-jiv'], { timeout: 180_000, maxBuffer: 16 << 20 });
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

/** Mapa id->nome dos nós de um Collada (o Assimp usa o id; o SketchUp guarda o nome legível em name). */
export function colladaNodeNames(xml) {
  const names = {};
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const name = tag.match(/\bname="([^"]+)"/)?.[1];
    if (id && name && id !== name) names[id] = name.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return names;
}

async function findModel(dir) {
  const stack = [dir];
  const found = [];
  while (stack.length) {
    const d = stack.pop();
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('__MACOSX')) stack.push(p); continue; }
      const x = extname(e.name).slice(1).toLowerCase();
      if (['dae', 'glb', 'gltf', 'obj', 'stl'].includes(x)) found.push({ p, x, size: (await stat(p)).size });
    }
  }
  const pref = ['dae', 'glb', 'gltf', 'obj', 'stl'];
  found.sort((a, b) => pref.indexOf(a.x) - pref.indexOf(b.x) || b.size - a.size);
  return found[0];
}

/**
 * Converte um arquivo enviado pelo usuário em GLB.
 * @returns {Promise<{ glb: Buffer, formato: string }>}
 */
export async function importToGLB(buffer, filename) {
  const ext = extname(filename).slice(1).toLowerCase();
  if (ext === 'skp') throw new ImportError('Arquivo .skp ainda não é aceito direto. No SketchUp use Arquivo → Exportar → Modelo 3D → COLLADA (.dae) e envie o .dae (ou um .zip com o .dae e a pasta de texturas).');
  if (!IMPORT_EXTS.includes(ext)) throw new ImportError(`Formato .${ext} não suportado. Envie .dae (exportado do SketchUp), .zip, .glb, .obj ou .stl.`);
  const dir = await mkdtemp(join(tmpdir(), 'm3d-imp-'));
  try {
    const src = join(dir, basename(filename).replace(/[^\w.\-]+/g, '_'));
    await writeFile(src, buffer);
    let model = { p: src, x: ext };
    if (ext === 'zip') {
      await run('unzip', ['-q', '-o', src, '-d', join(dir, 'x')], { timeout: 120_000 });
      model = await findModel(join(dir, 'x'));
      if (!model) throw new ImportError('O .zip não contém um .dae, .glb, .obj ou .stl.');
    }
    const out = join(dir, 'out.glb');
    try {
      await run(config.assimpBin, ['export', model.p, out, '-fglb2', '-jiv'], { timeout: 300_000, maxBuffer: 16 << 20 });
    } catch (e) {
      throw new ImportError('Não foi possível ler o modelo. Confira se o arquivo abre no SketchUp e exporte de novo como .dae.');
    }
    let glb = await readFile(out);
    if (model.x === 'dae') glb = renameGLBNodes(glb, colladaNodeNames(await readFile(model.p, 'utf8')));
    return { glb, formato: model.x };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class ImportError extends Error {}
