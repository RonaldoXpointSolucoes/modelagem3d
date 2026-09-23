import { getUserFromJWT } from './appwrite.js';
import { PLANS } from '../config.js';

const cache = new Map(); // jwt -> { user, exp }

/** preHandler do Fastify: exige "Authorization: Bearer <JWT do Appwrite>" */
export async function requireUser(req, reply) {
  const h = req.headers.authorization || '';
  const jwt = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!jwt) return reply.code(401).send({ error: 'nao_autenticado' });
  const hit = cache.get(jwt);
  if (hit && hit.exp > Date.now()) { req.user = hit.user; return; }
  try {
    const user = await getUserFromJWT(jwt);
    cache.set(jwt, { user, exp: Date.now() + 60_000 });
    if (cache.size > 5000) for (const [k, v] of cache) if (v.exp < Date.now()) cache.delete(k);
    req.user = user;
  } catch {
    return reply.code(401).send({ error: 'sessao_invalida' });
  }
}

/** Plano efetivo: assinatura vencida volta para "gratis". */
export function effectivePlan(profile) {
  const id = profile.plano && profile.plano !== 'gratis' && profile.plano_expira_em && new Date(profile.plano_expira_em) < new Date()
    ? 'gratis' : (profile.plano || 'gratis');
  return { id, ...PLANS[id] };
}
