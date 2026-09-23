import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Confetti from 'react-confetti';
import { motion } from 'framer-motion';
import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';
import { client, channels } from '../lib/appwrite.js';

const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MOCK = import.meta.env.VITE_PIX_MOCK === 'true';

export default function PixSheet() {
  const { sheet, set, catalog, plano, user, showToast } = useStore();
  const open = sheet === 'pix';
  const [tab, setTab] = useState('creditos');
  const [sel, setSel] = useState(null);
  const [charge, setCharge] = useState(null); // { transactionId, copiaECola, valor, creditos, expiraEm }
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const closeTimer = useRef();

  const reset = () => { setCharge(null); setPaid(false); setSel(null); setBusy(false); };
  const close = () => { set({ sheet: null }); setTimeout(reset, 300); };

  // Tempo real: escuta a transação e o perfil. Polling a cada 5 s como rede de segurança.
  useEffect(() => {
    if (!charge || paid) return;
    const done = () => setPaid(true);
    const unsub = client.subscribe([channels.transaction(charge.transactionId), channels.profile(user.id)], (ev) => {
      if (ev.channels.includes(channels.transaction(charge.transactionId)) && ev.payload.status === 'pago') done();
    });
    const poll = setInterval(() => api.pixStatus(charge.transactionId).then((r) => r.status === 'pago' && done()).catch(() => {}), 5000);
    const tick = setInterval(() => setLeft(Math.max(0, new Date(charge.expiraEm) - Date.now())), 250);
    return () => { unsub(); clearInterval(poll); clearInterval(tick); };
  }, [charge, paid, user?.id]);

  useEffect(() => {
    if (!paid) return;
    navigator.vibrate?.([30, 40, 60]);
    closeTimer.current = setTimeout(close, 3000);
    return () => clearTimeout(closeTimer.current);
  }, [paid]);

  async function gerarPix() {
    setBusy(true);
    try { setCharge(await api.pixCharge(sel)); }
    catch (e) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(charge.copiaECola); showToast('Pix copiado! Cole no app do seu banco.'); }
    catch { showToast('Não foi possível copiar', 'error'); }
  }

  const mm = String(Math.floor(left / 60000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  const expired = charge && left === 0 && new Date(charge.expiraEm) < new Date();

  return (
    <BottomSheet open={open} onClose={close} dismissable={!paid}>
      {paid ? (
        <div className="success">
          <Confetti width={window.innerWidth} height={window.innerHeight} numberOfPieces={380} recycle={false} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <motion.div className="check" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}>✓</motion.div>
          <h2>Pagamento confirmado!</h2>
          <p className="muted">Saldo atualizado. Bora modelar.</p>
        </div>
      ) : charge ? (
        <>
          <h2>Pague com Pix</h2>
          <p className="sub">{brl(charge.valor)} · +{charge.creditos} créditos</p>
          <div className="qr"><QRCodeSVG value={charge.copiaECola} size={200} level="M" /></div>
          <div className="timer">{expired ? 'Pix expirado' : <>Expira em <b>{mm}:{ss}</b></>}</div>
          {expired
            ? <button className="btn primary" onClick={() => setCharge(null)}>Gerar novo Pix</button>
            : <button className="btn primary" onClick={copiar}>Copiar Pix (Copia e Cola)</button>}
          <p className="muted" style={{ textAlign: 'center', marginTop: 12 }}>A confirmação aparece aqui sozinha assim que o banco aprovar.</p>
          {MOCK && <button className="btn" style={{ marginTop: 8 }} onClick={() => api.devPay(charge.transactionId)}>Simular pagamento (teste)</button>}
        </>
      ) : (
        <>
          <h2>Créditos e planos</h2>
          <div className="tabs">
            <button className={tab === 'creditos' ? 'on' : ''} onClick={() => { setTab('creditos'); setSel(null); }}>Créditos</button>
            <button className={tab === 'planos' ? 'on' : ''} onClick={() => { setTab('planos'); setSel(null); }}>Planos</button>
          </div>
          {tab === 'creditos' ? (
            <div className="cards">
              {Object.entries(catalog?.pacotes || {}).map(([id, p]) => (
                <button key={id} className={`card ${sel?.pacote === id ? 'sel' : ''}`} onClick={() => setSel({ pacote: id })}>
                  <div className="big">+{p.creditos}</div><div className="muted">créditos</div>
                  <div style={{ marginTop: 8, fontWeight: 700 }}>{brl(p.valor)}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="cards">
              {Object.entries(catalog?.planos || {}).filter(([id]) => id !== 'gratis').map(([id, p]) => (
                <button key={id} className={`card ${sel?.plano === id ? 'sel' : ''}`} onClick={() => setSel({ plano: id })}>
                  <div style={{ fontWeight: 800 }}>{p.nome}{plano?.id === id ? ' · atual' : ''}</div>
                  <div className="big" style={{ fontSize: 18 }}>{brl(p.precoMensal)}<span className="muted">/mês</span></div>
                  <div className="muted">{p.creditosMes} créditos/mês</div>
                  <div className="muted">{p.maxProjetos ? `${p.maxProjetos} projetos` : 'Projetos ilimitados'}</div>
                  <div className="muted">Exporta: {p.exportar.filter((f) => f !== 'png').join(', ').toUpperCase()}</div>
                  {p.texturasHD && <div className="muted">Texturas HD</div>}
                </button>
              ))}
            </div>
          )}
          <button className="btn primary" style={{ marginTop: 16 }} disabled={!sel || busy} onClick={gerarPix}>
            {busy ? 'Gerando Pix…' : 'Pagar com Pix'}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
