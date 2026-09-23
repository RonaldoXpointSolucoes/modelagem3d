// Editor de cena: seleção por peça (grupo/componente do SketchUp), transformações,
// duplicar, apagar, cor, desfazer e exportar GLB para salvar no servidor.
// O estado "pesado" (objetos Three.js) fica aqui; o React só recebe um resumo via store.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useStore } from '../store.js';
import * as view from './display.js';

export const editor = {
  root: null,       // gltf.scene carregada
  level: null,      // nível atual: as "peças" selecionáveis são os filhos deste nó
  selected: null,
  history: [],
};

const MAX_HISTORY = 50;

function publish(extra = {}) {
  const lvl = editor.level;
  // a vista explodida vale para o nível em que foi aberta
  if (view.display.explode > 0 && view.display.explodeLevel !== lvl) view.setExplode(0);
  view.setSelected(editor.selected);
  view.update();
  const path = [];
  const top = editor.root ? topLevel(editor.root) : null;
  for (let o = lvl; o && o !== top; o = o.parent) path.unshift(o.name || 'Grupo');
  useStore.setState({
    selectedName: editor.selected ? (editor.selected.name || 'Peça sem nome') : null,
    selected: !!editor.selected,
    canUndo: editor.history.length > 0,
    editPath: path,
    parts: lvl ? lvl.children.filter(isPart).map((c) => ({ uuid: c.uuid, name: c.name || (c.isMesh ? 'Face/malha' : 'Grupo'), visible: c.visible, group: !c.isMesh })) : [],
    ...extra,
  });
}

const isPart = (o) => o.isMesh || o.children.some((c) => c.isMesh || c.children.length);

/**
 * Desce os "invólucros" (nós com um único filho e sem malha) criados na importação
 * (ex.: nó de unidade/eixo do SketchUp e o nó "Modelo"), para que o usuário comece
 * já no nível dos grupos/componentes do modelo. Esses nós nunca são editados, o que
 * preserva a conversão de unidades/eixo na volta para o SketchUp.
 */
function topLevel(root) {
  let n = root;
  while (n.children.length === 1 && !n.children[0].isMesh && n.children[0].children.length) n = n.children[0];
  return n;
}

export async function loadGLB(arrayBuffer) {
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  const root = gltf.scene;
  editor.root = root;
  editor.level = topLevel(root);
  editor.selected = null;
  editor.history = [];
  view.build(root);
  let meshes = 0; root.traverse((o) => { if (o.isMesh) meshes++; });
  publish({ dirty: false, modelInfo: { meshes } });
  return root;
}

export function unload() {
  editor.root = editor.level = editor.selected = null;
  view.build(null);
  editor.history = [];
  publish({ dirty: false });
}

/** Encontra a peça (filho direto do nível atual) que contém o objeto clicado. */
export function pick(object) {
  let o = object;
  while (o && o.parent !== editor.level) o = o.parent;
  select(o || null);
}

export function select(obj) {
  editor.selected = obj;
  publish();
}

export function selectByUuid(uuid) {
  select(editor.level?.children.find((c) => c.uuid === uuid) || null);
}

export const findByUuid = (uuid) => editor.root?.getObjectByProperty('uuid', uuid) || null;

/** Seleciona qualquer nó do modelo (ex.: resultado da busca): entra no grupo pai dele. */
export function selectDeep(obj) {
  if (!obj || !editor.root) return;
  const top = topLevel(editor.root);
  let inTop = false;
  for (let p = obj.parent; p; p = p.parent) if (p === top) inTop = true;
  editor.level = obj.parent && (inTop || obj.parent === top) ? obj.parent : top;
  editor.selected = obj;
  publish();
}

/** Chamado a cada movimento do gizmo: atualiza a exibição sem gravar histórico. */
export function transformChanged() { view.update(editor.selected); }

export function enterGroup(obj = editor.selected) {
  if (!obj || !obj.children.some(isPart)) return false;
  editor.level = obj;
  editor.selected = null;
  publish();
  return true;
}

export function exitGroup() {
  const top = topLevel(editor.root);
  if (!editor.level || editor.level === top) return;
  const prev = editor.level;
  editor.level = prev.parent;
  editor.selected = prev;
  publish();
}

function push(entry) {
  editor.history.push(entry);
  if (editor.history.length > MAX_HISTORY) editor.history.shift();
  publish({ dirty: true });
}

// ---- Transformações (chamado pelo TransformControls)
let dragStart = null;
export function beginTransform() {
  if (editor.selected) dragStart = { obj: editor.selected, matrix: editor.selected.matrix.clone() };
}
export function endTransform() {
  if (!dragStart) return;
  const { obj, matrix } = dragStart;
  dragStart = null;
  obj.updateMatrix();
  if (!obj.matrix.equals(matrix)) push({ undo: () => { matrix.decompose(obj.position, obj.quaternion, obj.scale); } });
}

export function duplicate() {
  const src = editor.selected;
  if (!src) return;
  const copy = src.clone(true);
  copy.name = (src.name || 'Peça') + ' (cópia)';
  // desloca 10% do tamanho da peça no eixo X do mundo
  const size = new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3());
  const worldOffset = new THREE.Vector3(Math.max(size.x, 0.05) * 1.1, 0, 0);
  const p = src.parent;
  const inv = new THREE.Matrix4().copy(p.matrixWorld).invert();
  const a = new THREE.Vector3().applyMatrix4(inv);
  const b = worldOffset.clone().applyMatrix4(inv);
  copy.position.add(b.sub(a));
  p.add(copy);
  editor.selected = copy;
  push({ undo: () => { p.remove(copy); if (editor.selected === copy) editor.selected = null; } });
}

export function remove() {
  const obj = editor.selected;
  if (!obj) return;
  const p = obj.parent;
  const idx = p.children.indexOf(obj);
  p.remove(obj);
  editor.selected = null;
  push({ undo: () => { p.add(obj); p.children.splice(p.children.indexOf(obj), 1); p.children.splice(idx, 0, obj); } });
}

export function setColor(hex) {
  const obj = editor.selected;
  if (!obj) return;
  const changed = [];
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const old = m.material;
    const mats = Array.isArray(old) ? old : [old];
    const next = mats.map((mat) => {
      const c = mat.clone();
      c.color?.set(hex);
      c.map = null; // cor sólida substitui a textura
      c.needsUpdate = true;
      return c;
    });
    m.material = Array.isArray(old) ? next : next[0];
    changed.push([m, old]);
  });
  push({ undo: () => changed.forEach(([m, old]) => { m.material = old; }) });
}

export function rename(name) {
  const obj = editor.selected;
  if (!obj || !name.trim()) return;
  const old = obj.name;
  obj.name = name.trim();
  push({ undo: () => { obj.name = old; } });
}

export function undo() {
  const e = editor.history.pop();
  if (!e) return;
  e.undo();
  publish({ dirty: true });
}

/** Exporta a cena editada como GLB (mesma hierarquia/nó raiz de unidades da importação). */
export async function exportGLB() {
  if (!editor.root) throw new Error('Nenhum modelo aberto');
  const objects = editor.root.children.slice();
  const res = await new GLTFExporter().parseAsync(objects, { binary: true, onlyVisible: false, maxTextureSize: 4096 });
  return new Blob([res], { type: 'model/gltf-binary' });
}

export function markSaved() {
  editor.history = [];
  publish({ dirty: false });
}
