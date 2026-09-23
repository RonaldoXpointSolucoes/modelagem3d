import { useStore } from '../store.js';
import { api } from './api.js';
import { exportGLB, markSaved } from './editor.js';

/** Exporta a cena editada e envia ao servidor, que regenera DAE/OBJ/STL para o SketchUp. */
export async function saveActive() {
  const st = useStore.getState();
  if (!st.activeId || st.saving) return false;
  st.set({ saving: true });
  try {
    const glb = await exportGLB();
    const maxMB = st.catalog?.maxUploadMB || 30;
    if (glb.size > maxMB * 1e6) throw new Error(`Modelo editado passou de ${maxMB} MB — não foi possível salvar.`);
    const { project } = await api.saveProject(st.activeId, glb);
    st.upsertProject(project);
    markSaved();
    st.showToast(`Salvo (versão ${project.versao}). Pronto para exportar ao SketchUp.`);
    return true;
  } catch (e) {
    st.showToast('Erro ao salvar: ' + e.message, 'error');
    return false;
  } finally {
    useStore.getState().set({ saving: false });
  }
}
