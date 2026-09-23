import { motion } from 'framer-motion';
import { useStore } from '../store.js';

export default function TopBar({ onLogout }) {
  const profile = useStore((s) => s.profile);
  const plano = useStore((s) => s.plano);
  const set = useStore((s) => s.set);
  const saldo = profile?.saldo_creditos ?? 0;
  const low = saldo < 5;
  return (
    <div className="topbar">
      <button className="glass icon-btn" aria-label="Meus projetos" onClick={() => set({ sheet: 'projects' })}>▦</button>
      <div className="glass pill plan-chip">{plano?.nome || '—'}</div>
      <div className="spacer" />
      <motion.button
        className={`glass pill credits ${low ? 'low' : ''}`}
        aria-label={`${saldo} créditos. Comprar mais`}
        onClick={() => set({ sheet: 'pix' })}
        animate={low ? { scale: [1, 1.06, 1], boxShadow: ['0 0 0 0 rgba(255,90,106,0.0)', '0 0 0 8px rgba(255,90,106,0.25)', '0 0 0 0 rgba(255,90,106,0.0)'] } : { scale: 1 }}
        transition={low ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}}
      >
        <span>◆ {saldo}</span>
        <span className="plus">+</span>
      </motion.button>
      <button className="glass icon-btn" aria-label="Sair" onClick={onLogout}>⎋</button>
    </div>
  );
}
