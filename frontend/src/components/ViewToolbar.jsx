import { useStore } from '../store.js';
import { hideSelected, isolateSelected, setXray, setEraser, undoVisibility, showAll } from '../lib/viewTools.js';

/** Barra lateral de visibilidade: sempre à mão, com um toque (ou atalho de teclado). */
export default function ViewToolbar() {
  const { view, selected, set, activeId, projects, modelInfo } = useStore();
  const project = projects.find((p) => p.$id === activeId);
  if (!project || project.status !== 'pronto' || !modelInfo) return null;
  const B = ({ on, label, keyHint, onClick, children, disabled, badge }) => (
    <button className={on ? 'on' : ''} title={keyHint ? `${label} (${keyHint})` : label} aria-label={label} aria-pressed={!!on} disabled={disabled} onClick={onClick}>
      {children}
      {badge ? <span className="badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
  return (
    <div className="viewbar glass">
      <B label="Visão: explodir, cortar, materiais e cenas" onClick={() => set({ sheet: 'view' })}>👁</B>
      <B label="Isolar peça selecionada" keyHint="I" on={view.isolated} onClick={isolateSelected} disabled={!selected && !view.isolated}>◎</B>
      <B label="Ocultar peça selecionada" keyHint="H" onClick={hideSelected} disabled={!selected}>⊘</B>
      <B label="Raio-X: mostra o resto como vidro ao isolar" keyHint="X" on={view.xray} onClick={() => setXray(!view.xray)}>◍</B>
      <B label="Borracha: toque para ocultar peças" keyHint="E" on={view.eraser} onClick={() => setEraser(!view.eraser)}>⌫</B>
      <B label="Desfazer ocultação" onClick={undoVisibility} disabled={!view.canUndoVis}>↺</B>
      <B label="Mostrar tudo" keyHint="Shift+H" onClick={showAll} disabled={!view.hiddenCount && !view.isolated && !view.hiddenMats} badge={view.hiddenCount}>✦</B>
    </div>
  );
}
