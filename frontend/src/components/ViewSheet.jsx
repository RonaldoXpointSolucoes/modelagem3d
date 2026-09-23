import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import {
  showAll, invert, undoVisibility, setXray, setEraser, setExplode, setSection,
  materialList, toggleMaterial, listViews, saveView, applySavedView, deleteView, useViewTick,
} from '../lib/viewTools.js';
import { display } from '../lib/display.js';

const AXES = [['x', 'X'], ['y', 'Altura'], ['z', 'Z']];

/** Gaveta "Visão" (não bloqueia a cena: dá para ver o efeito enquanto ajusta). */
export default function ViewSheet() {
  const { sheet, set, view, bumpShadow, activeId } = useStore();
  useViewTick((s) => s.tick); // atualiza a lista de materiais ocultos
  const [tab, setTab] = useState('ferramentas');
  const [mats, setMats] = useState([]);
  const [views, setViews] = useState([]);
  const [nome, setNome] = useState('');
  const open = sheet === 'view';

  useEffect(() => { if (open) { setMats(materialList()); setViews(listViews()); } }, [open, activeId]);

  return (
    <BottomSheet open={open} onClose={() => set({ sheet: null })} modal={false}>
      <h2>Visão</h2>
      <div className="tabs">
        {[['ferramentas', 'Ferramentas'], ['materiais', 'Materiais'], ['cenas', 'Cenas']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'ferramentas' && (
        <>
          <div className="chips" style={{ marginTop: 0 }}>
            <button className="chip" onClick={showAll}>✦ Mostrar tudo</button>
            <button className="chip" onClick={invert}>⇄ Inverter visibilidade</button>
            <button className="chip" disabled={!view.canUndoVis} onClick={undoVisibility}>↺ Desfazer</button>
            <button className={`chip ${view.xray ? 'on' : ''}`} onClick={() => setXray(!view.xray)}>◍ Raio-X</button>
            <button className={`chip ${view.eraser ? 'on' : ''}`} onClick={() => { setEraser(!view.eraser); set({ sheet: null }); }}>⌫ Borracha</button>
          </div>

          <div className="sec-title">Vista explodida <span className="muted">{Math.round(view.explode * 100)}%</span></div>
          <p className="muted" style={{ margin: '0 0 6px' }}>Afasta os conjuntos do nível atual para enxergar o que está dentro. Não altera o modelo.</p>
          <input
            className="range" type="range" min="0" max="1" step="0.01" value={view.explode}
            onChange={(e) => setExplode(Number(e.target.value))} onPointerUp={bumpShadow}
          />

          <div className="sec-title" style={{ marginTop: 16 }}>
            Corte
            <button className={`chip ${view.section.on ? 'on' : ''}`} onClick={() => setSection({ on: !view.section.on })}>{view.section.on ? 'Ligado' : 'Desligado'}</button>
          </div>
          <div className="tabs" style={{ opacity: view.section.on ? 1 : 0.5 }}>
            {AXES.map(([a, l]) => (
              <button key={a} className={view.section.axis === a ? 'on' : ''} onClick={() => setSection({ axis: a, on: true })}>{l}</button>
            ))}
          </div>
          <div className="row">
            <input
              className="range" type="range" min="0" max="1" step="0.005" value={view.section.t}
              onChange={(e) => setSection({ t: Number(e.target.value), on: true })}
            />
            <button className="chip" onClick={() => setSection({ flip: !view.section.flip, on: true })} title="Inverter o lado do corte">⇅</button>
          </div>
        </>
      )}

      {tab === 'materiais' && (
        <>
          <p className="sub">Como as etiquetas do SketchUp: oculte tudo que usa um material (ex.: MDF, alumínio, parafusos).</p>
          {mats.map((m) => {
            const off = display.hiddenMats.has(m.name);
            return (
              <button key={m.name} className="proj" style={{ opacity: off ? 0.5 : 1 }} onClick={() => toggleMaterial(m.name)}>
                <div className="swatch" style={{ background: m.color }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{m.name}</div>
                  <div className="muted">{m.count} peça{m.count > 1 ? 's' : ''}</div>
                </div>
                <span className="eye">{off ? '◌' : '👁'}</span>
              </button>
            );
          })}
        </>
      )}

      {tab === 'cenas' && (
        <>
          <p className="sub">Guarde o que está visível + o ângulo da câmera, e volte com um toque (ex.: “Pórtico”, “Só a base”).</p>
          <div className="row" style={{ marginBottom: 12 }}>
            <input className="field" placeholder="Nome da cena" value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} />
            <button className="btn primary" style={{ width: 120, height: 50 }} onClick={() => { setViews(saveView(nome.trim())); setNome(''); }}>Salvar</button>
          </div>
          {!views.length && <p className="muted">Nenhuma cena salva ainda.</p>}
          {views.map((v, i) => (
            <div key={v.at} className="row">
              <button className="proj" onClick={() => applySavedView(i)}>
                <div className="thumb">🎬</div>
                <div style={{ minWidth: 0 }}>
                  <div className="name">{v.name}</div>
                  <div className="muted">{v.hidden.length} ocultas{v.focus ? ' · isolada' : ''}{v.section?.on ? ' · corte' : ''}{v.explode ? ' · explodida' : ''}</div>
                </div>
              </button>
              <button className="icon-btn" aria-label="Apagar cena" onClick={() => setViews(deleteView(i))}>🗑</button>
            </div>
          ))}
        </>
      )}
    </BottomSheet>
  );
}
