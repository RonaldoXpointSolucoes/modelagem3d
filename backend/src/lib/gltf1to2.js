// Converte GLB glTF 1.0 (como o Assimp exporta com -fglb) em GLB glTF 2.0.
// Motivo: o exportador glTF2 do Assimp 5.x trava em modelos grandes do SketchUp
// (milhares de malhas); o exportador glTF1 grava o mesmo modelo em segundos.
// Suporta o que o Assimp gera: nós com matrix/children/meshes, malhas com
// primitivas (triângulos e linhas), materiais com cor difusa, um buffer binário.
import { writeGLB } from './glb.js';

export function isGLB1(buf) {
  return buf.length >= 20 && buf.toString('latin1', 0, 4) === 'glTF' && buf.readUInt32LE(4) === 1;
}

const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export function glb1ToGlb2(buf) {
  if (!isGLB1(buf)) throw new Error('não é um GLB glTF 1.0');
  const jsonLen = buf.readUInt32LE(12);
  const g = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  // O Assimp alinha o corpo binário a 4 bytes, mas não conta esse enchimento no cabeçalho.
  const declared = buf.readUInt32LE(8);
  const bodyLen = declared - 20 - jsonLen;
  const start = buf.length - bodyLen >= 20 + jsonLen ? buf.length - bodyLen : 20 + jsonLen;
  const bin = buf.subarray(start, start + bodyLen);

  const index = (dict) => { const m = new Map(); Object.keys(dict || {}).forEach((k, i) => m.set(k, i)); return m; };
  const iView = index(g.bufferViews), iAcc = index(g.accessors), iMat = index(g.materials), iNode = index(g.nodes);

  const bufferViews = Object.values(g.bufferViews || {}).map((v) => ({
    buffer: 0, byteOffset: v.byteOffset || 0, byteLength: v.byteLength,
    ...(v.target ? { target: v.target } : {}),
  }));

  const accessors = Object.values(g.accessors || {}).map((a) => {
    const out = { bufferView: iView.get(a.bufferView), byteOffset: a.byteOffset || 0, componentType: a.componentType, count: a.count, type: a.type };
    if (a.max) out.max = a.max;
    if (a.min) out.min = a.min;
    // glTF2 guarda o stride na bufferView; o Assimp grava tudo compacto (stride 0)
    const elem = SIZES[a.type] * BYTES[a.componentType];
    if (a.byteStride && a.byteStride !== elem) bufferViews[out.bufferView].byteStride = a.byteStride;
    return out;
  });
  // Accessor de índice não pode ter bufferView com byteStride; POSITION precisa de min/max (Assimp já grava)

  const materials = Object.entries(g.materials || {}).map(([id, m]) => {
    const v = m.values || {};
    const d = Array.isArray(v.diffuse) ? v.diffuse : [0.8, 0.8, 0.8, 1];
    const alpha = Math.min(d[3] ?? 1, typeof v.transparency === 'number' ? v.transparency : 1);
    const mat = {
      name: m.name || id,
      pbrMetallicRoughness: { baseColorFactor: [d[0], d[1], d[2], alpha], metallicFactor: 0, roughnessFactor: 0.9 },
      doubleSided: true,
    };
    if (alpha < 1) mat.alphaMode = 'BLEND';
    if (Array.isArray(v.emission) && v.emission.some((x) => x > 0)) mat.emissiveFactor = v.emission.slice(0, 3);
    return mat;
  });

  // glTF1: o nó pode ter várias malhas; glTF2: uma malha (com várias primitivas) por nó.
  const srcMeshes = g.meshes || {};
  const meshes = [];
  const convPrim = (p) => {
    const attributes = {};
    for (const [k, acc] of Object.entries(p.attributes || {})) {
      const key = k === 'TEXCOORD' ? 'TEXCOORD_0' : k.replace(/^(TEXCOORD|COLOR|JOINT|WEIGHT)$/, '$1_0');
      attributes[key] = iAcc.get(acc);
    }
    const out = { attributes, mode: p.mode ?? 4 };
    if (p.indices !== undefined) out.indices = iAcc.get(p.indices);
    if (p.material !== undefined && iMat.has(p.material)) out.material = iMat.get(p.material);
    return out;
  };

  const nodes = Object.entries(g.nodes || {}).map(([id, n]) => {
    const out = { name: n.name || id };
    if (n.matrix && !isIdentity(n.matrix)) out.matrix = n.matrix;
    for (const k of ['translation', 'rotation', 'scale']) if (n[k]) out[k] = n[k];
    if (n.children?.length) out.children = n.children.map((c) => iNode.get(c)).filter((x) => x !== undefined);
    const ms = (n.meshes || []).filter((m) => srcMeshes[m]);
    if (ms.length) {
      const primitives = ms.flatMap((m) => srcMeshes[m].primitives.map(convPrim));
      meshes.push({ name: ms.length === 1 ? (srcMeshes[ms[0]].name || ms[0]) : out.name, primitives });
      out.mesh = meshes.length - 1;
    }
    return out;
  });

  const sceneKeys = Object.keys(g.scenes || {});
  const scenes = sceneKeys.map((k) => ({ nodes: (g.scenes[k].nodes || []).map((n) => iNode.get(n)) }));
  const scene = Math.max(0, sceneKeys.indexOf(g.scene));

  const json = {
    asset: { version: '2.0', generator: 'modelagem3d (assimp glTF1 → glTF2)' },
    scene, scenes, nodes, meshes, accessors, bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  if (materials.length) json.materials = materials;
  const pad = (4 - (bin.length % 4)) % 4;
  const chunkHead = Buffer.alloc(8);
  chunkHead.writeUInt32LE(bin.length + pad, 0); chunkHead.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return writeGLB(json, Buffer.concat([chunkHead, bin, Buffer.alloc(pad)]));
}

function isIdentity(m) {
  return m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
}
