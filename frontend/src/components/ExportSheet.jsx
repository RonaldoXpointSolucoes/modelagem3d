import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { viewerRef } from '../lib/viewerRef.js';

const FORMATOS = [
  { id: 'dae', titulo: 'SketchUp (.DAE)', desc: 'Recomendado. No SketchUp: Arquivo → Importar → Collada.' },
  { id: 'obj', titulo: 'OBJ + materiais (.ZIP)', desc: 'SketchUp Pro 2021+, Blender, 3ds Max.' },
  { id: 'stl', titulo: 'STL', desc: 'Impressão 3D e SketchUp (extensão STL).' },
  { id: 'glb', titulo: 'GLB', desc: 'Web, AR, Blender, Unity.' },
];

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export default function ExportSheet() {
  const { sheet, set, activeId, projects, plano, showToast } = useStore();
  const p = projects.find((x) => x.$id === activeId);
  const pode = (f) => plano?.exportar?.includes(f);

  async function baixar(fmt) {
    if (!pode(fmt)) { showToast(`${fmt.toUpperCase()} disponível a partir do plano Básico`); set({ sheet: 'pix' }); return; }
    try {
      const b = await api.file(activeId, fmt, true);
      const base = (p?.nome_projeto || 'modelo').replace(/[^\w-]+/g, '-').slice(0, 40);
      save(b, fmt === 'obj' ? `${base}-obj.zip` : `${base}.${fmt}`);
    } catch (e) { showToast(e.message, 'error'); }
  }

  function png() {
    const { gl, scene, camera } = viewerRef;
    if (!gl) return;
    gl.render(scene, camera);
    gl.domElement.toBlob((b) => b && save(b, `${(p?.nome_projeto || 'modelo').slice(0, 40)}.png`), 'image/png');
  }

  return (
    <BottomSheet open={sheet === 'export'} onClose={() => set({ sheet: null })}>
      <h2>Exportar</h2>
      <p className="sub">{p ? p.nome_projeto : 'Abra um projeto para exportar.'}</p>
      <button className="proj" onClick={png}>
        <div className="thumb">🖼</div>
        <div><div className="name">Imagem (PNG)</div><div className="muted">Captura da vista atual.</div></div>
      </button>
      {p?.status === 'pronto' && FORMATOS.map((f) => (
        <button key={f.id} className={`proj ${pode(f.id) ? '' : 'lock'}`} onClick={() => baixar(f.id)} disabled={f.id !== 'glb' && !p[`${f.id}_file_id`]}>
          <div className="thumb">{pode(f.id) ? '⬇' : '🔒'}</div>
          <div><div className="name">{f.titulo}</div><div className="muted">{f.desc}</div></div>
        </button>
      ))}
    </BottomSheet>
  );
}
