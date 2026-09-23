import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store.js';
import { duplicate, remove, setColor, undo, enterGroup, exitGroup, rename } from '../lib/editor.js';
import { saveActive } from '../lib/save.js';
import { hideSelected, isolateSelected, similar, focusSelected } from '../lib/viewTools.js';

/** Barra de edição da peça selecionada + navegação de grupos + salvar. */
export default function EditBar() {
  const { selected, selectedName, canUndo, dirty, saving, editPath, set, activeId, projects } = useStore();
  const color = useRef();
  const [sim, setSim] = useState(false);
  const project = projects.find((p) => p.$id === activeId);
  if (!project || project.status !== 'pronto') return null;

  return (
    <>
      <div className="editbar-top">
        {editPath.length > 0 && (
          <button className="glass pill" onClick={exitGroup} title="Sair do grupo">← {editPath[editPath.length - 1]}</button>
        )}
        <button className="glass pill" onClick={() => set({ sheet: 'parts' })}>☰ Peças</button>
        {canUndo && <button className="glass pill" onClick={undo}>↶ Desfazer</button>}
        <AnimatePresence>
          {dirty && (
            <motion.button
              className="glass pill save" disabled={saving} onClick={saveActive}
              initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
            >
              {saving ? 'Salvando…' : '💾 Salvar'}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div className="editbar glass" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}>
            <button className="name" onClick={() => { const n = window.prompt('Nome da peça', selectedName); if (n) rename(n); }}>
              {selectedName} ✎
            </button>
            <div className="row" style={{ gap: 4 }}>
              <button onClick={() => enterGroup() || useStore.getState().showToast('Esta peça não tem subpeças')}>Abrir</button>
              <button onClick={duplicate}>Duplicar</button>
              <button onClick={() => color.current.click()}>Cor</button>
              <button className="danger" onClick={remove}>Apagar</button>
              <input ref={color} type="color" hidden onChange={(e) => setColor(e.target.value)} />
            </div>
            {sim ? (
              <div className="row" style={{ gap: 4 }}>
                <button onClick={() => { similar('isolate'); setSim(false); }}>◎ Isolar iguais</button>
                <button onClick={() => { similar('hide'); setSim(false); }}>⊘ Ocultar iguais</button>
                <button style={{ flex: 0.4 }} onClick={() => setSim(false)}>✕</button>
              </div>
            ) : (
              <div className="row" style={{ gap: 4 }}>
                <button onClick={hideSelected} title="Ocultar (H)">⊘ Ocultar</button>
                <button onClick={isolateSelected} title="Isolar (I)">◎ Isolar</button>
                <button onClick={() => setSim(true)} title="Peças com a mesma forma">⧉ Iguais</button>
                <button onClick={focusSelected} title="Enquadrar (F)">⌖ Focar</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
