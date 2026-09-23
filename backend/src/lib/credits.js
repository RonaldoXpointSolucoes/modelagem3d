// Livro-caixa de créditos. O Appwrite 1.7 não tem incremento atômico, então todas as
// alterações de saldo de um usuário passam por uma fila (mutex) em memória.
// IMPORTANTE: rode o backend com UMA réplica no Coolify.
import { db, perm, uniqueId } from './appwrite.js';
import { SIGNUP_BONUS } from '../config.js';

const locks = new Map();
export function withUserLock(uid, fn) {
  const prev = locks.get(uid) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  locks.set(uid, tail);
  tail.then(() => { if (locks.get(uid) === tail) locks.delete(uid); });
  return next;
}

export class NoCreditsError extends Error {
  constructor(saldo, necessario) { super('Saldo de créditos insuficiente'); this.saldo = saldo; this.necessario = necessario; }
}

/** Cria o perfil no primeiro acesso, com bônus de cadastro. */
export function ensureProfile(user) {
  return withUserLock(user.$id, async () => {
    const found = await db.getOrNull('profiles', user.$id);
    if (found) return found;
    const profile = await db.create('profiles', user.$id,
      { nome: user.name || user.email?.split('@')[0] || 'Usuário', plano: 'gratis', saldo_creditos: SIGNUP_BONUS },
      [perm.read(user.$id)]);
    await db.create('transactions', uniqueId(),
      { user_id: user.$id, tipo: 'bonus', creditos: SIGNUP_BONUS, valor: 0, status: 'pago', pacote: 'cadastro' },
      [perm.read(user.$id)]);
    return profile;
  });
}

/** Debita créditos e registra a transação. Lança NoCreditsError se faltar saldo. */
export function debit(uid, amount, { projectId } = {}) {
  return withUserLock(uid, async () => {
    const p = await db.get('profiles', uid);
    if (p.saldo_creditos < amount) throw new NoCreditsError(p.saldo_creditos, amount);
    const updated = await db.update('profiles', uid, { saldo_creditos: p.saldo_creditos - amount });
    await db.create('transactions', uniqueId(),
      { user_id: uid, tipo: 'consumo_ia', creditos: -amount, valor: 0, status: 'pago', project_id: projectId },
      [perm.read(uid)]);
    return updated;
  });
}

/** Devolve créditos (ex.: geração falhou). */
export function refund(uid, amount, { projectId } = {}) {
  return withUserLock(uid, async () => {
    const p = await db.get('profiles', uid);
    const updated = await db.update('profiles', uid, { saldo_creditos: p.saldo_creditos + amount });
    await db.create('transactions', uniqueId(),
      { user_id: uid, tipo: 'estorno', creditos: amount, valor: 0, status: 'pago', project_id: projectId },
      [perm.read(uid)]);
    return updated;
  });
}

/**
 * Confirma um Pix pago (idempotente): muda a transação para "pago" e aplica créditos/plano.
 * Chamado pelo webhook. Se a transação já estiver paga, não faz nada.
 */
export function applyPaidTransaction(tx, { planDays = 30 } = {}) {
  return withUserLock(tx.user_id, async () => {
    const fresh = await db.get('transactions', tx.$id);
    if (fresh.status === 'pago') return { already: true };
    const p = await db.get('profiles', fresh.user_id);
    const patch = { saldo_creditos: p.saldo_creditos + fresh.creditos };
    if (fresh.tipo === 'assinatura_pix') {
      const base = p.plano === fresh.pacote && p.plano_expira_em && new Date(p.plano_expira_em) > new Date()
        ? new Date(p.plano_expira_em) : new Date();
      base.setDate(base.getDate() + planDays);
      patch.plano = fresh.pacote;
      patch.plano_expira_em = base.toISOString();
    }
    const profile = await db.update('profiles', fresh.user_id, patch);
    await db.update('transactions', fresh.$id, { status: 'pago' });
    return { already: false, profile };
  });
}
