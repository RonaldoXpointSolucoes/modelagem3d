import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { selectByUuid, enterGroup, exitGroup, editor } from '../lib/editor.js';
import { fitCamera } from '../lib/camera.js';

/** Lista de grupos/componentes do nível atual — essencial para modelos grandes no celular. */
export default function PartsSheet() {
  const { sheet, set, parts, editPath, selectedName } = useStore();
  return (
    <BottomSheet open={sheet === 'parts'} onClose={() => set({ sheet: null })}>
      <h2>Peças</h2>
      <p className="sub">
        {editPath.length ? `Dentro de: ${editPath.join(' › ')}` : 'Nível principal do modelo'} · {parts.length} itens
      </p>
      {editPath.length > 0 && (
        <button className="proj" onClick={exitGroup}><div className="thumb">←</div><div className="name">Voltar um nível</div></button>
      )}
      {parts.map((p) => (
        <div key={p.uuid} className="row">
          <button
            className="proj" style={selectedName === p.name ? { outline: '1px solid var(--accent)' } : undefined}
            onClick={() => { selectByUuid(p.uuid); fitCamera(editor.selected); set({ sheet: null }); }}
          >
            <div className="thumb">▣</div>
            <div className="name" style={{ minWidth: 0 }}>{p.name}</div>
          </button>
          <button className="icon-btn" aria-label="Abrir grupo" onClick={() => { selectByUuid(p.uuid); enterGroup(); }}>›</button>
        </div>
      ))}
    </BottomSheet>
  );
}
