import { useEffect, useState } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';

function Thumb({ p }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!p.thumbnail_file_id) return;
    let u;
    api.file(p.$id, 'thumbnail').then((b) => { u = URL.createObjectURL(b); setSrc(u); }).catch(() => {});
    return () => u && URL.revokeObjectURL(u);
  }, [p.thumbnail_file_id, p.$id]);
  const icon = p.status === 'gerando' ? '⏳' : p.status === 'falhou' ? '⚠︎' : '▲';
  return <div className="thumb" style={src ? { backgroundImage: `url(${src})` } : undefined}>{!src && icon}</div>;
}

export default function ProjectsSheet() {
  const { sheet, set, projects, activeId, removeProject, showToast } = useStore();
  async function apagar(p) {
    if (!window.confirm(`Apagar "${p.nome_projeto}"?`)) return;
    try { await api.deleteProject(p.$id); removeProject(p.$id); } catch (e) { showToast(e.message, 'error'); }
  }
  return (
    <BottomSheet open={sheet === 'projects'} onClose={() => set({ sheet: null })}>
      <h2>Meus projetos</h2>
      {!projects.length && <p className="muted">Nenhum projeto ainda. Toque em “Criar com IA”.</p>}
      {projects.map((p) => (
        <div key={p.$id} className="row">
          <button className="proj" style={p.$id === activeId ? { outline: '1px solid var(--accent)' } : undefined}
            onClick={() => {
              if (p.status === 'falhou') return;
              if (p.$id !== activeId && useStore.getState().dirty && !window.confirm('Há alterações não salvas. Descartar e abrir outro projeto?')) return;
              set({ activeId: p.$id, sheet: null });
            }}>
            <Thumb p={p} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="name">{p.nome_projeto}</div>
              <div className="muted">
                {p.status === 'gerando' ? `${p.origem === 'importado' ? 'Importando' : 'Gerando'}… ${p.progresso || 0}%` : p.status === 'falhou' ? (p.origem === 'importado' ? (p.erro || 'Falhou') : 'Falhou — créditos devolvidos') : `${p.origem === 'importado' ? 'SketchUp · ' : 'IA · '}v${p.versao || 1} · ${new Date(p.$updatedAt || p.$createdAt).toLocaleDateString('pt-BR')}`}
              </div>
              {p.status === 'gerando' && <div className="bar"><i style={{ width: `${p.progresso || 3}%` }} /></div>}
            </div>
          </button>
          <button className="icon-btn" aria-label="Apagar" onClick={() => apagar(p)}>🗑</button>
        </div>
      ))}
    </BottomSheet>
  );
}
