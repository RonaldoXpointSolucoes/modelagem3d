// Motor de exibição rápida.
//
// A hierarquia original (grupos/componentes do SketchUp) continua intacta para edição e
// exportação, mas não é desenhada: os objetos ficam na camada HIDDEN_LAYER. O que aparece
// na tela é uma cópia agrupada:
//   • malhas → poucos BatchedMesh (um por tipo de material), 1 chamada de desenho cada,
//     com cor/visibilidade/posição por peça;
//   • linhas e malhas com materiais especiais → "proxies" leves que seguem o original.
// Visibilidade, isolamento, raio-X, vista explodida e corte são só de visualização:
// não alteram o modelo salvo.
import * as THREE from 'three';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const HIDDEN_LAYER = 1;
const ACCENT = new THREE.Color('#6c8cff');
const BATCH_MIN_MESHES = 40; // modelos pequenos (ex.: IA) usam proxies com o material original

export const display = {
  group: new THREE.Group(),
  root: null,
  batches: [],           // { key, mesh, ghost, geoIds: Map<geometry, id>, material, count }
  entries: new Map(),    // Mesh original -> { batch, id } | { proxy }
  lines: new Map(),      // Line original -> proxy
  selected: null,
  focus: null,           // Set<Object3D> isolados (null = sem isolamento)
  hiddenMats: new Set(), // nomes de materiais ocultos
  xray: false,
  explode: 0,
  explodeLevel: null,
  explodeOffsets: new Map(),
  section: { on: false, axis: 'y', t: 0.5, flip: false },
  plane: new THREE.Plane(),
  bounds: new THREE.Box3(),
  candidates: [],        // malhas clicáveis da última sincronização: { obj, offset }
  selOffset: new THREE.Vector3(),
  visHistory: [],
  invalidate: () => {},
  onChange: () => {},    // resumo para a interface
};
display.group.name = '__display__';

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _v4 = new THREE.Vector4();
const _c = new THREE.Color();
const ZERO = new THREE.Vector3();
let raf = 0;

// ------------------------------------------------------------------ construção
function batchKey(mesh) {
  const g = mesh.geometry, m = mesh.material;
  if (Array.isArray(m) || g.groups.length > 1) return null;
  if (m.normalMap || m.roughnessMap || m.metalnessMap || m.aoMap || m.emissiveMap || m.alphaMap || m.bumpMap) return null;
  const attrs = Object.keys(g.attributes).sort().map((k) => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].array.constructor.name}:${g.attributes[k].normalized}`).join(',');
  return [attrs, g.index ? g.index.array.constructor.name : 'noindex', m.map?.uuid || '', m.transparent || m.opacity < 1 ? 't' : 'o', m.side, m.vertexColors ? 'vc' : ''].join('|');
}

function makeBatchMaterial(src) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff, map: src.map || null, roughness: 0.85, metalness: 0.05,
    side: src.side, transparent: !!(src.transparent || src.opacity < 1), vertexColors: !!src.vertexColors,
    depthWrite: !(src.transparent || src.opacity < 1),
  });
}

function disposeDisplay() {
  for (const b of display.batches) {
    b.mesh.dispose(); b.material.dispose();
    if (b.ghost) { b.ghost.dispose(); }
  }
  display.group.clear();
  display.batches = [];
  display.entries = new Map();
  display.lines = new Map();
}

/** Monta a exibição a partir da cena carregada. */
export function build(root) {
  disposeDisplay();
  display.root = root;
  display.selected = null;
  display.focus = null;
  display.hiddenMats.clear();
  display.explode = 0;
  display.explodeLevel = null;
  display.explodeOffsets.clear();
  display.visHistory = [];
  display.section = { ...display.section, on: false };
  if (!root) { display.onChange(); return; }

  const meshes = [];
  const lines = [];
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
    else if (o.isLine || o.isPoints) lines.push(o);
    o.layers.set(HIDDEN_LAYER);
  });
  root.updateMatrixWorld(true);
  display.bounds.setFromObject(root);

  const useBatches = meshes.length >= BATCH_MIN_MESHES;
  const groups = new Map();
  for (const m of meshes) {
    const key = useBatches ? batchKey(m) : null;
    if (!key) { addProxy(m); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const [key, list] of groups) createBatch(key, list);
  for (const l of lines) addProxy(l);
  applyClipping();
  update();
}

function createBatch(key, list) {
  const unique = new Map();
  let verts = 0, idx = 0;
  for (const m of list) {
    const g = m.geometry;
    if (unique.has(g)) continue;
    if (!g.attributes.normal && g.attributes.position) g.computeVertexNormals();
    unique.set(g, true);
    verts += g.attributes.position.count;
    idx += g.index ? g.index.count : 0;
  }
  const material = makeBatchMaterial(list[0].material);
  const cap = Math.ceil(list.length * 1.25) + 16;
  const mesh = new THREE.BatchedMesh(cap, Math.max(verts, 1), Math.max(idx, 1), material);
  mesh.sortObjects = material.transparent;
  mesh.perObjectFrustumCulled = true;
  const b = { key, mesh, ghost: null, material, geoIds: new Map(), list: [] };
  for (const g of unique.keys()) b.geoIds.set(g, mesh.addGeometry(g));
  for (const m of list) addInstance(b, m);
  display.group.add(mesh);
  display.batches.push(b);
  return b;
}

function addInstance(b, m) {
  const geoId = b.geoIds.get(m.geometry);
  if (geoId === undefined) return false;
  if (b.mesh.instanceCount >= b.mesh.maxInstanceCount) b.mesh.setInstanceCount(Math.ceil(b.mesh.maxInstanceCount * 1.5) + 8);
  const id = b.mesh.addInstance(geoId);
  if (b.ghost) {
    if (b.ghost.instanceCount >= b.ghost.maxInstanceCount) b.ghost.setInstanceCount(b.mesh.maxInstanceCount);
    b.ghost.addInstance(b.ghostGeoIds.get(m.geometry));
  }
  display.entries.set(m, { batch: b, id });
  b.list.push(m);
  return true;
}

function addProxy(o) {
  const P = o.isMesh ? THREE.Mesh : o.isLineSegments ? THREE.LineSegments : o.isLineLoop ? THREE.LineLoop : o.isLine ? THREE.Line : THREE.Points;
  const proxy = new P(o.geometry, o.material);
  proxy.matrixAutoUpdate = false;
  proxy.userData.src = o;
  display.group.add(proxy);
  if (o.isMesh) display.entries.set(o, { proxy });
  else display.lines.set(o, proxy);
}

/** Malha "fantasma" do raio-X (criada só quando usada, para poupar memória). */
function ensureGhosts() {
  for (const b of display.batches) {
    if (b.ghost) continue;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const src = b.mesh;
    const ghost = new THREE.BatchedMesh(src.maxInstanceCount, Math.max(1, [...b.geoIds.keys()].reduce((s, g) => s + g.attributes.position.count, 0)),
      Math.max(1, [...b.geoIds.keys()].reduce((s, g) => s + (g.index ? g.index.count : 0), 0)), mat);
    ghost.sortObjects = false;
    b.ghostGeoIds = new Map();
    for (const g of b.geoIds.keys()) b.ghostGeoIds.set(g, ghost.addGeometry(g));
    for (const m of b.list) ghost.addInstance(b.ghostGeoIds.get(m.geometry));
    ghost.renderOrder = 10;
    b.ghost = ghost;
    display.group.add(ghost);
  }
  applyClipping();
}
const ghostProxyMat = new THREE.MeshBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
const tintCache = new WeakMap();
function tinted(mat) {
  if (Array.isArray(mat)) return mat.map(tinted);
  let t = tintCache.get(mat);
  if (!t) {
    t = mat.clone();
    if (t.color) t.color.lerp(ACCENT, 0.45);
    if (t.emissive) t.emissive.copy(ACCENT).multiplyScalar(0.25);
    tintCache.set(mat, t);
  }
  t.clippingPlanes = display.section.on ? [display.plane] : null;
  return t;
}

// ------------------------------------------------------------------ sincronização
/**
 * Reflete a cena original na exibição: posição (inclusive vista explodida), visibilidade,
 * isolamento, raio-X, materiais ocultos e destaque da seleção. Barato (≈1–3 ms para
 * milhares de peças), então é chamado a cada mudança.
 */
export function update(subtree = null) {
  const root = display.root;
  if (!root) { display.invalidate(); return; }
  const offsets = display.explode > 0 ? display.explodeOffsets : null;
  const partial = subtree && subtree !== root && isAncestor(root, subtree);
  let start = [root, true, !display.focus, false, null];
  if (partial) {
    // só a peça sendo movida: herda o estado dos ancestrais
    subtree.updateWorldMatrix(true, true);
    let vis = true, focus = !display.focus, sel = false, off = null;
    const chain = []; for (let p = subtree.parent; p; p = p.parent) chain.unshift(p);
    for (const a of chain) { vis = vis && a.visible; focus = focus || (display.focus?.has(a) ?? false); sel = sel || a === display.selected; off = offsets?.get(a) || off; }
    start = [subtree, vis, focus, sel, off];
  } else {
    root.updateMatrixWorld(true);
  }
  if (display.xray && display.focus) ensureGhosts();

  const seen = new Set();
  const candidates = partial ? null : [];
  const stack = [start];
  if (!partial) display.selOffset.set(0, 0, 0);
  let hiddenCount = 0;

  while (stack.length) {
    const [o, vis0, focus0, sel0, off0] = stack.pop();
    const vis = vis0 && o.visible;
    if (!o.visible && vis0) hiddenCount++;
    const focus = focus0 || (display.focus?.has(o) ?? false);
    const sel = sel0 || o === display.selected;
    const off = offsets?.get(o) || off0;
    if (o === display.selected && off) display.selOffset.copy(off);

    if (o.isMesh || o.isLine || o.isPoints) {
      seen.add(o);
      const matName = (Array.isArray(o.material) ? o.material[0] : o.material)?.name || '';
      const matHidden = display.hiddenMats.has(matName);
      const shown = vis && !matHidden && focus;
      const ghost = vis && !matHidden && !focus && display.xray;
      _m.copy(o.matrixWorld);
      if (off) { _t.makeTranslation(off.x, off.y, off.z); _m.premultiply(_t); }

      const e = display.entries.get(o) || (o.isMesh ? adopt(o) : null);
      if (e?.batch) {
        const { mesh, ghost: gm } = e.batch;
        mesh.setVisibleAt(e.id, shown);
        if (shown) {
          mesh.setMatrixAt(e.id, _m);
          const mat = o.material;
          _c.copy(mat.color || _c.set(0xffffff));
          if (sel) _c.lerp(ACCENT, 0.45);
          _v4.set(_c.r, _c.g, _c.b, mat.transparent || mat.opacity < 1 ? mat.opacity : 1);
          mesh.setColorAt(e.id, _v4);
        }
        if (gm) { gm.setVisibleAt(e.id, ghost); if (ghost) gm.setMatrixAt(e.id, _m); }
      } else {
        const proxy = e?.proxy || display.lines.get(o) || adoptProxy(o);
        proxy.visible = shown || (ghost && o.isMesh);
        proxy.matrix.copy(_m);
        proxy.material = ghost && !shown ? ghostProxyMat : sel && o.isMesh ? tinted(o.material) : o.material;
      }
      if (shown && o.isMesh && candidates) candidates.push({ obj: o, offset: off || null });
    }
    for (let i = o.children.length - 1; i >= 0; i--) stack.push([o.children[i], vis, focus, sel, off]);
  }

  if (partial) { display.invalidate(); if (!raf) raf = requestAnimationFrame(() => { raf = 0; display.onChange(); }); return; }

  // peças apagadas (fora da árvore): esconde
  for (const [o, e] of display.entries) {
    if (seen.has(o)) continue;
    if (e.batch) { e.batch.mesh.setVisibleAt(e.id, false); e.batch.ghost?.setVisibleAt(e.id, false); } else e.proxy.visible = false;
  }
  for (const [o, p] of display.lines) if (!seen.has(o)) p.visible = false;

  display.candidates = candidates;
  display.hiddenCount = hiddenCount;
  display.invalidate();
  display.onChange();
}

/** Peça nova (ex.: duplicada) que ainda não está na exibição. */
function adopt(o) {
  o.layers.set(HIDDEN_LAYER);
  const key = display.batches.length ? batchKey(o) : null;
  const b = key && display.batches.find((x) => x.key === key);
  if (b && addInstance(b, o)) return display.entries.get(o);
  addProxy(o);
  return display.entries.get(o);
}
function adoptProxy(o) {
  o.layers.set(HIDDEN_LAYER);
  addProxy(o);
  return display.lines.get(o);
}

// ------------------------------------------------------------------ seleção por clique
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;
const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();
const _p = new THREE.Vector3();

/** Raio contra as malhas visíveis (com BVH criado sob demanda). Devolve a malha atingida. */
export function pickAt(ndc, camera) {
  raycaster.setFromCamera(ndc, camera);
  const base = raycaster.ray.clone();
  let best = null;
  const hits = [];
  for (const { obj, offset } of display.candidates) {
    _ray.copy(base);
    if (offset) _ray.origin.sub(offset);
    const g = obj.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    _sphere.copy(g.boundingSphere).applyMatrix4(obj.matrixWorld);
    if (!_ray.intersectsSphere(_sphere)) continue;
    if (best && _ray.origin.distanceTo(_sphere.center) - _sphere.radius > best.distance) continue;
    if (!g.boundsTree && (g.index ? g.index.count : g.attributes.position.count) > 900) g.computeBoundsTree();
    raycaster.ray.copy(_ray);
    hits.length = 0;
    obj.raycast(raycaster, hits);
    for (const h of hits) {
      if (display.section.on) {
        _p.copy(h.point); if (offset) _p.add(offset);
        if (display.plane.distanceToPoint(_p) < 0) continue;
      }
      if (!best || h.distance < best.distance) best = { distance: h.distance, object: obj };
    }
  }
  raycaster.ray.copy(base);
  return best?.object || null;
}

// ------------------------------------------------------------------ ferramentas de visibilidade
function pushVis(list) { display.visHistory.push(list); if (display.visHistory.length > 100) display.visHistory.shift(); }

export function setSelected(obj) { display.selected = obj; }

export function hide(objs) {
  const list = (Array.isArray(objs) ? objs : [objs]).filter((o) => o && o.visible);
  if (!list.length) return;
  pushVis(list.map((o) => [o, true]));
  list.forEach((o) => { o.visible = false; });
  update();
}

export function setVisible(obj, v) {
  if (!obj || obj.visible === v) return;
  pushVis([[obj, obj.visible]]);
  obj.visible = v;
  update();
}

export function undoVisibility() {
  const last = display.visHistory.pop();
  if (!last) return false;
  if (last.focus !== undefined) display.focus = last.focus;
  else last.forEach(([o, v]) => { o.visible = v; });
  update();
  return true;
}

export function showAll() {
  const changed = [];
  display.root?.traverse((o) => { if (!o.visible && o !== display.root) { changed.push([o, false]); o.visible = true; } });
  if (changed.length) pushVis(changed);
  display.focus = null;
  display.hiddenMats.clear();
  update();
}

/** Inverte a visibilidade das peças do nível atual. */
export function invert(level) {
  if (!level) return;
  const list = level.children.filter((c) => c.isMesh || c.children.length);
  pushVis(list.map((o) => [o, o.visible]));
  list.forEach((o) => { o.visible = !o.visible; });
  update();
}

export function isolate(objs) {
  const list = (Array.isArray(objs) ? objs : [objs]).filter(Boolean);
  const v = [];
  v.focus = display.focus;
  pushVis(v);
  display.focus = list.length ? new Set(list) : null;
  // garante que o que foi isolado esteja visível
  for (const o of list) for (let p = o; p && p !== display.root; p = p.parent) p.visible = true;
  update();
}
export function clearIsolation() {
  if (!display.focus) return;
  const v = []; v.focus = display.focus; pushVis(v);
  display.focus = null;
  update();
}

export function setXray(on) { display.xray = on; update(); }

export function toggleMaterial(name) {
  if (display.hiddenMats.has(name)) display.hiddenMats.delete(name); else display.hiddenMats.add(name);
  update();
}

/** Materiais do modelo (como as "etiquetas" do SketchUp): nome, cor e quantidade de peças. */
export function materialList() {
  const map = new Map();
  display.root?.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const name = m?.name || 'Sem material';
    const e = map.get(name) || { name, color: '#' + (m?.color?.getHexString() || 'cccccc'), count: 0 };
    e.count++; map.set(name, e);
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Assinatura geométrica de um grupo: peças "iguais" (ex.: parafusos repetidos) têm a mesma. */
const sigCache = new WeakMap();
function signature(obj) {
  if (sigCache.has(obj)) return sigCache.get(obj);
  const parts = [];
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const box = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.copy(g.boundingBox).applyMatrix4(_t.multiplyMatrices(inv, o.matrixWorld));
    const s = box.getSize(new THREE.Vector3());
    parts.push(`${g.attributes.position.count}/${g.index?.count || 0}/${[s.x, s.y, s.z].map((x) => x.toFixed(4)).sort().join(',')}`);
  });
  const sig = parts.sort().join('|');
  sigCache.set(obj, sig);
  return sig;
}

/** Todas as peças do modelo com a mesma forma da peça dada. */
export function findSimilar(obj) {
  if (!obj || !display.root) return [];
  display.root.updateMatrixWorld(true);
  const sig = signature(obj);
  const depth = (o) => { let d = 0; for (let p = o; p && p !== display.root; p = p.parent) d++; return d; };
  const out = [];
  display.root.traverse((o) => {
    if (o === display.root || (!o.isMesh && !o.children.length)) return;
    if (o.children.length !== obj.children.length || o.isMesh !== obj.isMesh) return;
    if (signature(o) === sig) out.push(o);
  });
  // não conta um grupo e o filho dele como iguais
  return out.filter((o) => !out.some((p) => p !== o && isAncestor(p, o))).sort((a, b) => depth(a) - depth(b));
}
const isAncestor = (a, o) => { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; };

// ---- vista explodida
export function setExplode(v, level) {
  if (level && level !== display.explodeLevel) {
    display.explodeLevel = level;
    display.explodeOffsets.clear();
  }
  const lvl = display.explodeLevel;
  if (lvl && !display.explodeOffsets.size) {
    display.root.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(lvl).getCenter(new THREE.Vector3());
    const size = new THREE.Box3().setFromObject(lvl).getSize(new THREE.Vector3()).length();
    for (const c of lvl.children) {
      const b = new THREE.Box3().setFromObject(c);
      if (b.isEmpty()) continue;
      const dir = b.getCenter(new THREE.Vector3()).sub(center);
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0).multiplyScalar(size * 0.05);
      c.userData.__explodeDir = dir;
      display.explodeOffsets.set(c, new THREE.Vector3());
    }
  }
  display.explode = v;
  for (const [c, off] of display.explodeOffsets) off.copy(c.userData.__explodeDir).multiplyScalar(v * 1.2);
  update();
}

// ---- plano de corte
export function setSection(patch) {
  const wasOn = display.section.on;
  Object.assign(display.section, patch);
  const s = display.section;
  const b = display.bounds;
  const n = new THREE.Vector3(s.axis === 'x' ? 1 : 0, s.axis === 'y' ? 1 : 0, s.axis === 'z' ? 1 : 0);
  const min = b.min[s.axis], max = b.max[s.axis];
  const at = min + (max - min) * s.t;
  // mantém o lado "abaixo" do plano (ou acima, se invertido)
  if (s.flip) display.plane.set(n, -at); else display.plane.set(n.negate(), at);
  if (wasOn !== s.on) applyClipping();
  update();
}

function applyClipping() {
  const planes = display.section.on ? [display.plane] : null;
  const mats = new Set();
  for (const b of display.batches) { mats.add(b.material); if (b.ghost) mats.add(b.ghost.material); }
  for (const e of display.entries.values()) if (e.proxy) [].concat(e.proxy.userData.src.material).forEach((m) => mats.add(m));
  for (const [o] of display.lines) [].concat(o.material).forEach((m) => mats.add(m));
  mats.add(ghostProxyMat);
  for (const m of mats) { m.clippingPlanes = planes; m.needsUpdate = true; }
}

/** Caixa (em coordenadas da tela) da peça selecionada, incluindo o deslocamento da vista explodida. */
export function selectionBox(target) {
  if (!display.selected) return null;
  target.setFromObject(display.selected);
  if (!target.isEmpty()) target.translate(display.selOffset);
  return target;
}

// ---- cenas salvas (visibilidade + câmera), por projeto, no navegador
const pathOf = (o) => { const p = []; for (let n = o; n && n !== display.root; n = n.parent) p.unshift(n.parent.children.indexOf(n)); return p.join('/'); };
const byPath = (s) => { let n = display.root; for (const i of s.split('/').filter(Boolean)) { n = n?.children[Number(i)]; } return n; };

export function captureView(camera, controls) {
  const hidden = [];
  display.root?.traverse((o) => { if (!o.visible && o !== display.root) hidden.push(pathOf(o)); });
  return {
    hidden,
    focus: display.focus ? [...display.focus].map(pathOf) : null,
    hiddenMats: [...display.hiddenMats],
    xray: display.xray, explode: display.explode,
    section: { ...display.section },
    cam: camera ? { p: camera.position.toArray(), t: controls?.target.toArray() } : null,
  };
}

export function applyView(v, camera, controls) {
  if (!display.root || !v) return;
  display.root.traverse((o) => { if (o !== display.root) o.visible = true; });
  for (const p of v.hidden || []) { const o = byPath(p); if (o) o.visible = false; }
  display.focus = v.focus ? new Set(v.focus.map(byPath).filter(Boolean)) : null;
  display.hiddenMats = new Set(v.hiddenMats || []);
  display.xray = !!v.xray;
  if (v.section) setSection(v.section);
  setExplode(v.explode || 0);
  if (v.cam && camera) {
    camera.position.fromArray(v.cam.p);
    if (controls && v.cam.t) { controls.target.fromArray(v.cam.t); controls.update(); }
  }
  update();
}

export const _internals = { ZERO };
