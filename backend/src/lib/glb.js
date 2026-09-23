// Gera um GLB válido de uma "casinha" simples (caixa + telhado). Usado pelo provedor mock.
export function makeBoxGLB() {
  const P = [];
  const N = [];
  const I = [];
  const quad = (a, b, c, d, n) => {
    const s = P.length / 3;
    for (const v of [a, b, c, d]) { P.push(...v); N.push(...n); }
    I.push(s, s + 1, s + 2, s, s + 2, s + 3);
  };
  const tri = (a, b, c, n) => {
    const s = P.length / 3;
    for (const v of [a, b, c]) { P.push(...v); N.push(...n); }
    I.push(s, s + 1, s + 2);
  };
  const w = 1, d = 0.8, h = 1, r = 1.6;
  // paredes
  quad([-w, 0, d], [w, 0, d], [w, h, d], [-w, h, d], [0, 0, 1]);
  quad([w, 0, -d], [-w, 0, -d], [-w, h, -d], [w, h, -d], [0, 0, -1]);
  quad([w, 0, d], [w, 0, -d], [w, h, -d], [w, h, d], [1, 0, 0]);
  quad([-w, 0, -d], [-w, 0, d], [-w, h, d], [-w, h, -d], [-1, 0, 0]);
  quad([-w, 0, -d], [w, 0, -d], [w, 0, d], [-w, 0, d], [0, -1, 0]);
  // telhado
  const k = Math.SQRT1_2;
  quad([-w, h, d], [w, h, d], [w, r, 0], [-w, r, 0], [0, k, k]);
  quad([w, h, -d], [-w, h, -d], [-w, r, 0], [w, r, 0], [0, k, -k]);
  tri([w, h, d], [w, h, -d], [w, r, 0], [1, 0, 0]);
  tri([-w, h, -d], [-w, h, d], [-w, r, 0], [-1, 0, 0]);

  const pos = Buffer.from(new Float32Array(P).buffer);
  const nor = Buffer.from(new Float32Array(N).buffer);
  const idx = Buffer.from(new Uint16Array(I).buffer);
  const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);
  const bin = Buffer.concat([pad4(pos), pad4(nor), pad4(idx)]);
  const min = [0, 1, 2].map((i) => Math.min(...P.filter((_, j) => j % 3 === i)));
  const max = [0, 1, 2].map((i) => Math.max(...P.filter((_, j) => j % 3 === i)));
  const gltf = {
    asset: { version: '2.0', generator: 'modelagem3d-mock' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'Casa' }],
    materials: [{ name: 'Parede', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.82, 0.76, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 },
      { buffer: 0, byteOffset: pad4(pos).length, byteLength: nor.length, target: 34962 },
      { buffer: 0, byteOffset: pad4(pos).length + pad4(nor).length, byteLength: idx.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: I.length, type: 'SCALAR' },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, ch(json.length, 0x4e4f534a), json, ch(bin.length, 0x004e4942), bin]);
}
