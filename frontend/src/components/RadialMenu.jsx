import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { fitCamera } from '../lib/camera.js';
import { duplicate, remove, undo, editor } from '../lib/editor.js';

const ITEMS = [
  { id: 'translate', label: 'Mover' },
  { id: 'rotate', label: 'Girar' },
  { id: 'scale', label: 'Escala' },
  { id: 'duplicate', label: 'Duplicar' },
  { id: 'delete', label: 'Apagar' },
  { id: 'undo', label: 'Desfazer' },
  { id: 'reset', label: 'Centrar' },
  { id: 'export', label: 'Exportar' },
];
const R = 100;

/** Segurar o dedo 450 ms sobre a cena abre um disco de ferramentas ao redor do polegar. */
export function useLongPress(targetRef) {
  const [at, setAt] = useState(null);
  const t = useRef(); const start = useRef(); const touches = useRef(0);
  useEffect(() => {
    const el = targetRef.current; if (!el) return;
    const down = (e) => {
      touches.current++;
      if (touches.current > 1) { clearTimeout(t.current); return; }
      start.current = { x: e.clientX, y: e.clientY };
      t.current = setTimeout(() => { navigator.vibrate?.(12); setAt({ ...start.current }); }, 450);
    };
    const move = (e) => { if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clearTimeout(t.current); };
    const up = () => { touches.current = Math.max(0, touches.current - 1); clearTimeout(t.current); };
    const ctx = (e) => e.preventDefault();
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); el.removeEventListener('contextmenu', ctx);
    };
  }, [targetRef]);
  return [at, () => setAt(null)];
}

export default function RadialMenu({ at, onClose }) {
  const { tool, set } = useStore();
  const pick = (id) => {
    if (['translate', 'rotate', 'scale'].includes(id)) set({ tool: id });
    if (['translate', 'rotate', 'scale'].includes(id) && !editor.selected) useStore.getState().showToast('Toque numa peça para selecioná-la');
    if (id === 'duplicate') duplicate();
    if (id === 'delete') remove();
    if (id === 'undo') undo();
    if (id === 'export') set({ sheet: 'export' });
    if (id === 'reset') fitCamera(editor.selected || editor.root);
    onClose();
  };
  // mantém o disco dentro da tela
  const x = at ? Math.min(Math.max(at.x, R + 30), window.innerWidth - R - 30) : 0;
  const y = at ? Math.min(Math.max(at.y, R + 30), window.innerHeight - R - 30) : 0;
  return (
    <AnimatePresence>
      {at && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onPointerDown={onClose} />
          <div className="radial" style={{ left: x, top: y }}>
            <div className="center" />
            {ITEMS.map((it, i) => {
              const a = (i / ITEMS.length) * Math.PI * 2 - Math.PI / 2;
              return (
                <motion.button
                  key={it.id}
                  className={`item glass ${tool === it.id ? 'on' : ''}`}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                  animate={{ x: Math.cos(a) * R, y: Math.sin(a) * R, opacity: 1, scale: 1 }}
                  exit={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 26, delay: i * 0.015 }}
                  onClick={() => pick(it.id)}
                >
                  {it.label}
                </motion.button>
              );
            })}
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
