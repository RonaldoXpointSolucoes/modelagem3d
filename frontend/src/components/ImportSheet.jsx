import { useRef, useState } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';

const ACCEPT = '.dae,.zip,.glb,.obj,.stl,.skp';

export default function ImportSheet() {
  const { sheet, set, upsertProject, showToast, dirty } = useStore();
  const [file, setFile] = useState(null);
  const [nome, setNome] = useState('');
  const [pct, setPct] = useState(null);
  const input = useRef();
  const isSkp = file?.name.toLowerCase().endsWith('.skp');

  function choose(f) {
    if (!f) return;
    setFile(f);
    setNome(f.name.replace(/\.[^.]+$/, ''));
  }

  async function enviar() {
    if (dirty && !window.confirm('Há alterações não salvas no projeto aberto. Continuar mesmo assim?')) return;
    setPct(0);
    try {
      const { project } = await api.importFile(file, nome.trim(), setPct);
      upsertProject(project);
      set({ activeId: project.$id, sheet: null, selected: false });
      setFile(null); setNome('');
      showToast('Arquivo enviado. Convertendo…');
    } catch (e) {
      showToast(e.message, 'error');
    } finally { setPct(null); }
  }

  return (
    <BottomSheet open={sheet === 'import'} onClose={() => pct === null && set({ sheet: null })} dismissable={pct === null}>
      <h2>Importar do SketchUp</h2>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>No SketchUp</div>
        <div className="muted">1. <b>Arquivo → Exportar → Modelo 3D…</b></div>
        <div className="muted">2. Tipo: <b>COLLADA (*.dae)</b>. Em <b>Opções</b>, deixe marcado “Exportar mapas de textura”.</div>
        <div className="muted">3. Envie o <b>.dae</b> aqui. Com texturas, compacte o .dae + a pasta que o SketchUp criou em um <b>.zip</b>.</div>
      </div>

      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => choose(e.target.files?.[0])} />
      <button className="proj" onClick={() => input.current.click()} disabled={pct !== null}>
        <div className="thumb">⬆</div>
        <div style={{ minWidth: 0 }}>
          <div className="name">{file ? file.name : 'Escolher arquivo'}</div>
          <div className="muted">{file ? `${(file.size / 1e6).toFixed(1)} MB` : '.dae, .zip, .glb, .obj ou .stl — até 30 MB'}</div>
        </div>
      </button>

      {isSkp && (
        <p style={{ color: 'var(--danger)', fontSize: 14 }}>
          Arquivos .skp ainda não são lidos direto. Exporte como COLLADA (.dae) no SketchUp, como explicado acima.
        </p>
      )}
      {file && !isSkp && (
        <>
          <input className="field" style={{ margin: '4px 0 12px' }} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Nome do projeto" />
          {pct !== null && <div className="bar" style={{ marginBottom: 12 }}><i style={{ width: `${pct}%` }} /></div>}
          <button className="btn primary" disabled={pct !== null || file.size > 30e6} onClick={enviar}>
            {file.size > 30e6 ? 'Arquivo acima de 30 MB' : pct !== null ? `Enviando… ${pct}%` : 'Importar (grátis)'}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
