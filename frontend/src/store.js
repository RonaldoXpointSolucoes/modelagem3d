import { create } from 'zustand';

export const useStore = create((set) => ({
  user: null,          // { id, email, name }
  profile: null,       // documento profiles
  plano: null,         // plano efetivo (vem do backend)
  catalog: null,
  projects: [],
  activeId: null,      // projeto aberto no visualizador
  selected: false,     // peça selecionada (mostra gizmo)
  selectedName: null,
  canUndo: false,
  dirty: false,        // há alterações não salvas
  saving: false,
  editPath: [],        // grupos em que o usuário entrou
  parts: [],           // peças do nível atual
  tool: 'translate',   // translate | rotate | scale
  sheet: null,         // 'prompt' | 'pix' | 'projects' | 'export' | 'import' | 'parts' | null
  toast: null,

  set: (p) => set(p),
  setProfile: (profile) => set({ profile }),
  upsertProject: (doc) => set((s) => {
    const i = s.projects.findIndex((p) => p.$id === doc.$id);
    const projects = i >= 0 ? s.projects.map((p) => (p.$id === doc.$id ? { ...p, ...doc } : p)) : [doc, ...s.projects];
    return { projects };
  }),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.$id !== id), activeId: s.activeId === id ? null : s.activeId })),
  showToast: (msg, kind = 'info') => {
    set({ toast: { msg, kind, t: Date.now() } });
    setTimeout(() => set((s) => (s.toast && Date.now() - s.toast.t >= 3500 ? { toast: null } : {})), 3600);
  },
}));
