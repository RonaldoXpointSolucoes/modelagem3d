import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store.js';
import { account, client, channels } from './lib/appwrite.js';
import { api, resetToken } from './lib/api.js';
import AuthScreen from './components/AuthScreen.jsx';
import TopBar from './components/TopBar.jsx';
import PromptSheet from './components/PromptSheet.jsx';
import PixSheet from './components/PixSheet.jsx';
import ProjectsSheet from './components/ProjectsSheet.jsx';
import ExportSheet from './components/ExportSheet.jsx';
import RadialMenu, { useLongPress } from './components/RadialMenu.jsx';

const Viewer = lazy(() => import('./components/Viewer.jsx'));

export default function App() {
  const s = useStore();
  const [phase, setPhase] = useState('loading'); // loading | auth | app
  const stageRef = useRef();
  const [radialAt, closeRadial] = useLongPress(stageRef);

  const boot = useCallback(async () => {
    try {
      await account.get();
    } catch { setPhase('auth'); return; }
    try {
      const [me, catalog, { projects }] = await Promise.all([api.me(), api.catalog(), api.projects()]);
      s.set({ user: me.user, profile: me.profile, plano: me.plano, catalog, projects, activeId: projects.find((p) => p.status === 'pronto')?.$id || null });
      setPhase('app');
    } catch (e) {
      s.showToast('Não foi possível conectar ao servidor: ' + e.message, 'error');
      setPhase('auth');
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  // Realtime: saldo/plano e progresso dos projetos, sem recarregar a página
  useEffect(() => {
    if (phase !== 'app' || !s.user) return;
    const uid = s.user.id;
    const unsub = client.subscribe([channels.profile(uid), channels.projects()], async (ev) => {
      const doc = ev.payload;
      if (doc.$collectionId === 'profiles') {
        const antes = useStore.getState().profile;
        useStore.setState({ profile: doc });
        if (antes && doc.plano !== antes.plano) api.me().then((m) => useStore.setState({ plano: m.plano })).catch(() => {});
      } else if (doc.$collectionId === 'projects' && doc.user_id === uid) {
        if (ev.events.some((e) => e.endsWith('.delete'))) return useStore.getState().removeProject(doc.$id);
        const prev = useStore.getState().projects.find((p) => p.$id === doc.$id);
        useStore.getState().upsertProject(doc);
        if (prev?.status === 'gerando' && doc.status === 'pronto') { navigator.vibrate?.(40); useStore.getState().showToast('Modelo pronto! ✨'); }
        if (prev?.status === 'gerando' && doc.status === 'falhou') useStore.getState().showToast('A geração falhou — créditos devolvidos.', 'error');
      }
    });
    return () => unsub();
  }, [phase, s.user?.id]);

  async function logout() {
    try { await account.deleteSession('current'); } catch {}
    resetToken();
    useStore.setState({ user: null, profile: null, projects: [], activeId: null, sheet: null });
    setPhase('auth');
  }

  if (phase === 'loading') return <div className="auth"><div className="muted">Carregando…</div></div>;
  if (phase === 'auth') return <><AuthScreen onLogged={() => { setPhase('loading'); boot(); }} /><Toast /></>;

  const active = s.projects.find((p) => p.$id === s.activeId);
  return (
    <>
      <div ref={stageRef}>
        <Suspense fallback={<div className="hint">Iniciando motor 3D…</div>}><Viewer /></Suspense>
      </div>

      {!s.activeId && (
        <div className="hint"><b>Seu estúdio 3D</b>Toque em “Criar com IA” e descreva o que quer modelar. Segure o dedo na tela para ferramentas.</div>
      )}
      {active?.status === 'gerando' && (
        <div className="gen-badge glass">
          <div style={{ fontWeight: 600, fontSize: 14 }}>Gerando “{active.nome_projeto.slice(0, 28)}”… {active.progresso || 0}%</div>
          <div className="bar"><i style={{ width: `${active.progresso || 3}%` }} /></div>
        </div>
      )}

      <TopBar onLogout={logout} />

      <div className="dock glass">
        {['translate', 'rotate', 'scale'].map((t) => (
          <button key={t} className={s.selected && s.tool === t ? 'active' : ''} aria-label={t}
            onClick={() => s.set({ tool: t, selected: !!s.activeId })}>
            {t === 'translate' ? '✥' : t === 'rotate' ? '⟳' : '⤢'}
          </button>
        ))}
        <button className="primary" onClick={() => s.set({ sheet: 'prompt' })}>✦ Criar com IA</button>
        <button aria-label="Exportar" onClick={() => s.set({ sheet: 'export' })}>⇪</button>
      </div>

      <RadialMenu at={radialAt} onClose={closeRadial} />
      <PromptSheet />
      <PixSheet />
      <ProjectsSheet />
      <ExportSheet />
      <Toast />
    </>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast.t} className={`toast glass ${toast.kind}`} initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}>
          {toast.msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
