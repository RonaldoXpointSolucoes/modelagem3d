import { useMemo, useState } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { selectByUuid, enterGroup, exitGroup, editor, selectDeep } from '../lib/editor.js';
import { setVisible, isolate } from '../lib/display.js';
import { useViewTick } from '../lib/viewTools.js';
import { fitCamera } from '../lib/camera.js';

const AUTO = /^(group|component|instance|node|mesh|ID)_?\d+$/i;
const label = (o) => o.name || (o.isMesh ? 'Face/malha' : 'Grupo');

/** Peças do nível atual + busca em todo o modelo, com olho para mostrar/ocultar cada conjunto. */
export default function PartsSheet() {
  const { sheet, set, editPath, selectedName } = useStore();
  const tick = useViewTick((s) => s.tick);
  const [q, setQ] = useState('');
  const open = sheet === 'parts';

  const rows = useMemo(() => {
    if (!open || !editor.level) return [];
    if (q.trim().length >= 2) {
      const needle = q.trim().toLowerCase();
      const out = [];
      editor.root.traverse((o) => {
        if (out.length >= 120 || o === editor.root) return;
        if ((o.isMesh || o.children.length) && o.name && o.name.toLowerCase().includes(needle)) out.push(o);
      });
      return out;
    }
    return editor.level.children.filter((c) => c.isMesh || c.children.length);
  }, [open, q, tick, editPath.join('/')]);

  const counts = useMemo(() => {
    const m = new Map();
    for (const r of rows) { let n = 0; r.traverse((o) => { if (o.isMesh) n++; }); m.set(r, n); }
    return m;
  }, [rows]);

  const searching = q.trim().length >= 2;
  const allHidden = rows.length && rows.every((r) => !r.visible);

  return (
    <BottomSheet open={open} onClose={() => set({ sheet: null })}>
      <h2>Peças</h2>
      <input className="field" style={{ marginBottom: 10 }} placeholder="🔎 Buscar em todo o modelo (ex.: patins, servo, parafuso)" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="sub" style={{ marginTop: 0 }}>
        {searching ? `${rows.length}${rows.length >= 120 ? '+' : ''} resultado(s)` : `${editPath.length ? `Dentro de: ${editPath.join(' › ')}` : 'Nível principal do modelo'} · ${rows.length} itens`}
      </p>
      {!searching && rows.length > 1 && (
        <div className="chips" style={{ marginTop: 0 }}>
          <button className="chip" onClick={() => rows.forEach((r) => setVisible(r, !!allHidden))}>{allHidden ? '👁 Mostrar todos' : '◌ Ocultar todos'}</button>
        </div>
      )}
      {!searching && editPath.length > 0 && (
        <button className="proj" onClick={exitGroup}><div className="thumb">←</div><div className="name">Voltar um nível</div></button>
      )}
      {rows.map((o) => (
        <div key={o.uuid} className="row" style={{ opacity: o.visible ? 1 : 0.45 }}>
          <button
            className="proj" style={selectedName === o.name && editor.selected === o ? { outline: '1px solid var(--accent)' } : undefined}
            onClick={() => {
              if (!o.visible) setVisible(o, true);
              if (searching) selectDeep(o); else selectByUuid(o.uuid);
              fitCamera(editor.selected); set({ sheet: null });
            }}
          >
            <div className="thumb">{o.isMesh ? '▱' : '▣'}</div>
            <div style={{ minWidth: 0 }}>
              <div className="name" style={{ color: AUTO.test(o.name) ? 'var(--muted)' : undefined }}>{label(o)}</div>
              <div className="muted">
                {counts.get(o) || 0} malha{counts.get(o) === 1 ? '' : 's'}
                {searching && o.parent && o.parent !== editor.root ? ` · em ${label(o.parent)}` : ''}
              </div>
            </div>
          </button>
          <button className="icon-btn" aria-label={o.visible ? 'Ocultar' : 'Mostrar'} title={o.visible ? 'Ocultar' : 'Mostrar'} onClick={() => setVisible(o, !o.visible)}>{o.visible ? '👁' : '◌'}</button>
          <button className="icon-btn" aria-label="Isolar" title="Isolar" onClick={() => { isolate([o]); if (searching) selectDeep(o); else selectByUuid(o.uuid); fitCamera(o); set({ sheet: null }); }}>◎</button>
          {!searching && !o.isMesh && (
            <button className="icon-btn" aria-label="Abrir grupo" title="Abrir grupo" onClick={() => { selectByUuid(o.uuid); enterGroup(); }}>›</button>
          )}
        </div>
      ))}
    </BottomSheet>
  );
}
