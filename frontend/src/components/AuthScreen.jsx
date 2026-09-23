import { useState } from 'react';
import { ID } from 'appwrite';
import { account, OAuthProvider } from '../lib/appwrite.js';

export default function AuthScreen({ onLogged }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const oauth = (p) => {
    const here = window.location.origin + '/';
    account.createOAuth2Session(p, here, here + '?login=falhou');
  };

  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'signup') await account.create(ID.unique(), email, senha, nome || undefined);
      await account.createEmailPasswordSession(email, senha);
      onLogged();
    } catch (e2) {
      setErr(
        e2.code === 401 ? 'E-mail ou senha incorretos.'
        : e2.code === 409 ? 'Este e-mail já tem conta. Entre com sua senha.'
        : e2.type === 'password_personal_data' || e2.code === 400 ? 'Senha fraca: use 8+ caracteres, sem seu nome/e-mail.'
        : e2.message,
      );
    } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="box glass">
        <h1>Modelagem 3D</h1>
        <p className="muted" style={{ marginTop: 0 }}>Descreva. A IA modela. Você abre no SketchUp.</p>
        <div className="stack" style={{ marginTop: 18 }}>
          <button className="btn" onClick={() => oauth(OAuthProvider.Google)}>Continuar com Google</button>
          <button className="btn" onClick={() => oauth(OAuthProvider.Apple)}>Continuar com Apple</button>
        </div>
        <div className="divider">ou com e-mail</div>
        <form className="stack" onSubmit={submit}>
          {mode === 'signup' && <input className="field" placeholder="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />}
          <input className="field" type="email" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <input className="field" type="password" required minLength={8} placeholder="Senha (mín. 8)" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {err && <div style={{ color: 'var(--danger)', fontSize: 14 }}>{err}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Aguarde…' : mode === 'signup' ? 'Criar conta e ganhar 10 créditos' : 'Entrar'}</button>
        </form>
        <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
          {mode === 'login' ? 'Novo por aqui? ' : 'Já tem conta? '}
          <button className="link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>
            {mode === 'login' ? 'Criar conta' : 'Entrar'}
          </button>
        </p>
      </div>
    </div>
  );
}
