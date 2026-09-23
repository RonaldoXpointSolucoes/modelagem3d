import { useState } from 'react';
import BottomSheet from './BottomSheet.jsx';
import { useStore } from '../store.js';
import { api } from '../lib/api.js';

const IDEIAS = ['Casa térrea moderna com varanda', 'Cadeira de madeira escandinava', 'Luminária de mesa industrial', 'Vaso de cerâmica orgânico', 'Estante modular'];

export default function PromptSheet() {
  const { sheet, set, catalog, plano, upsertProject, setProfile, profile, showToast } = useStore();
  const [prompt, setPrompt] = useState('');
  const [texturas, setTexturas] = useState(false);
  const [busy, setBusy] = useState(false);
  const custos = catalog?.custos || { preview: 1, refine: 3 };
  const custo = custos.preview + (texturas ? custos.refine : 0);

  async function gerar() {
    setBusy(true);
    try {
      const { project, saldo } = await api.generate(prompt.trim(), { texturas });
      upsertProject(project);
      setProfile({ ...profile, saldo_creditos: saldo });
      set({ activeId: project.$id, sheet: null, selected: false });
      setPrompt('');
    } catch (e) {
      if (e.body?.error === 'sem_creditos') { showToast('Sem créditos — recarregue para continuar', 'error'); set({ sheet: 'pix' }); }
      else showToast(e.message, 'error');
    } finally { setBusy(false); }
  }

  return (
    <BottomSheet open={sheet === 'prompt'} onClose={() => set({ sheet: null })}>
      <h2>O que vamos criar?</h2>
      <p className="sub">Descreva o objeto. A IA gera a malha 3D e você abre no SketchUp.</p>
      <textarea
        className="field" rows={4} maxLength={600} autoFocus value={prompt}
        placeholder="Ex.: sofá de 3 lugares em couro caramelo, pés de metal preto"
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="chips">
        {IDEIAS.map((i) => <button key={i} className="chip" onClick={() => setPrompt(i)}>{i}</button>)}
      </div>
      <div className="chips">
        <button className={`chip ${!texturas ? 'on' : ''}`} onClick={() => setTexturas(false)}>Só malha · {custos.preview} ◆</button>
        <button
          className={`chip ${texturas ? 'on' : ''} ${plano?.texturasHD ? '' : 'lock'}`}
          onClick={() => (plano?.texturasHD ? setTexturas(true) : showToast('Texturas HD a partir do plano Médio'))}
        >
          Com texturas HD · {custos.preview + custos.refine} ◆ {plano?.texturasHD ? '' : '🔒'}
        </button>
      </div>
      <button className="btn primary" disabled={busy || prompt.trim().length < 3} onClick={gerar}>
        {busy ? 'Enviando…' : `Gerar modelo · ${custo} ◆`}
      </button>
    </BottomSheet>
  );
}
