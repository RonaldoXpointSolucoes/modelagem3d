// Ações de visualização usadas pela interface (botões, gaveta e atalhos de teclado).
import { create } from 'zustand';
import { useStore } from '../store.js';
import * as d from './display.js';
import { editor, select, undo } from './editor.js';
import { viewerRef } from './viewerRef.js';
import { fitCamera } from './camera.js';

/** Contador separado do store principal: muda a cada atualização da cena sem re-renderizar o app todo. */
export const useViewTick = create(() => ({ tick: 0 }));

let raf = 0;
d.display.onChange = () => {
  const dd = d.display;
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; useViewTick.setState((s) => ({ tick: s.tick + 1 })); });
  const cur = useStore.getState().view;
  const next = {
    xray: dd.xray, explode: dd.explode, isolated: !!dd.focus, hiddenCount: dd.hiddenCount || 0,
    canUndoVis: dd.visHistory.length > 0, hiddenMats: dd.hiddenMats.size,
    section: dd.section,
  };
  const changed = Object.keys(next).some((k) => (k === 'section'
    ? ['on', 'axis', 't', 'flip'].some((x) => cur.section[x] !== dd.section[x])
    : cur[k] !== next[k]));
  if (changed) useStore.setState({ view: { ...cur, ...next, section: { ...dd.section } } });
};

const toast = (m, k) => useStore.getState().showToast(m, k);
const need = () => { if (!editor.selected) { toast('Toque numa peça primeiro'); return false; } return true; };

export function hideSelected() {
  if (!need()) return;
  const o = editor.selected;
  select(null);
  d.hide(o);
}

export function isolateSelected() {
  if (!need()) return;
  const f = d.display.focus;
  if (f && f.size === 1 && f.has(editor.selected)) d.clearIsolation();
  else d.isolate([editor.selected]);
}

export function similar(action) {
  if (!need()) return;
  const list = d.findSimilar(editor.selected);
  if (list.length <= 1) { toast('Não há outras peças iguais a esta'); return; }
  if (action === 'hide') { select(null); d.hide(list); toast(`${list.length} peças iguais ocultadas`); }
  else { d.isolate(list); toast(`${list.length} peças iguais isoladas`); }
}

export const showAll = () => { d.showAll(); useStore.getState().bumpShadow(); };
export const invert = () => d.invert(editor.level);
export const undoVisibility = () => d.undoVisibility() || toast('Nada para desfazer na visibilidade');
export const setXray = (on) => d.setXray(on);
export const setExplode = (v) => d.setExplode(v, editor.level);
export const setSection = (p) => d.setSection(p);
export const toggleMaterial = (n) => d.toggleMaterial(n);
export const materialList = () => d.materialList();

export function setEraser(on) {
  useStore.getState().setView({ eraser: on });
  if (on) { select(null); toast('Borracha: toque nas peças para ocultá-las. Toque de novo em ⌫ para sair.'); }
}

export function focusSelected() { fitCamera(editor.selected || editor.root); viewerRef.invalidate?.(); }

// ---- cenas salvas (no navegador, por projeto)
const key = () => `m3d:cenas:${useStore.getState().activeId}`;
export function listViews() {
  try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; }
}
function storeViews(v) { try { localStorage.setItem(key(), JSON.stringify(v)); } catch { toast('Não foi possível salvar a cena neste navegador', 'error'); } }
export function saveView(name) {
  const v = listViews();
  v.push({ name: name || `Cena ${v.length + 1}`, at: Date.now(), ...d.captureView(viewerRef.camera, viewerRef.controls) });
  storeViews(v);
  return v;
}
export function applySavedView(i) {
  const v = listViews()[i];
  if (!v) return;
  select(null);
  d.applyView(v, viewerRef.camera, viewerRef.controls);
  viewerRef.invalidate?.();
}
export function deleteView(i) { const v = listViews(); v.splice(i, 1); storeViews(v); return v; }

// ---- atalhos de teclado (computador)
export function installShortcuts() {
  const h = (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (!editor.root) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey) return;
    if (k === 'h' && (e.shiftKey || e.altKey)) showAll();
    else if (k === 'h') hideSelected();
    else if (k === 'i') isolateSelected();
    else if (k === 'x') setXray(!d.display.xray);
    else if (k === 'f') focusSelected();
    else if (k === 'e') setEraser(!useStore.getState().view.eraser);
    else if (k === 'escape') { if (useStore.getState().view.eraser) setEraser(false); else if (editor.selected) select(null); else d.clearIsolation(); }
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', h);
  return () => window.removeEventListener('keydown', h);
}
