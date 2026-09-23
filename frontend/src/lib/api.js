// Cliente do backend (Node/Fastify). Autentica com JWT do Appwrite (válido 15 min; renovamos a cada 10).
import { account, env } from './appwrite.js';

let jwt = null, jwtAt = 0;
async function token() {
  if (!jwt || Date.now() - jwtAt > 10 * 60_000) {
    ({ jwt } = await account.createJWT());
    jwtAt = Date.now();
  }
  return jwt;
}
export function resetToken() { jwt = null; }

export class ApiError extends Error {
  constructor(status, body) { super(body?.mensagem || body?.error || `Erro ${status}`); this.status = status; this.body = body; }
}

async function req(method, path, body) {
  const r = await fetch(env.apiUrl + path, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) resetToken();
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

async function blob(path) {
  const r = await fetch(env.apiUrl + path, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.blob();
}

export const api = {
  catalog: () => fetch(env.apiUrl + '/api/catalog').then((r) => r.json()),
  me: () => req('GET', '/api/me'),
  generate: (prompt, opts = {}) => req('POST', '/api/generate', { prompt, ...opts }),
  projects: () => req('GET', '/api/projects'),
  deleteProject: (id) => req('DELETE', `/api/projects/${id}`),
  file: (id, fmt, download = false) => blob(`/api/projects/${id}/file/${fmt}${download ? '?download=1' : ''}`),
  pixCharge: (body) => req('POST', '/api/pix/charge', body),
  pixStatus: (txId) => req('GET', `/api/pix/${txId}/status`),
  devPay: (txId) => req('POST', `/api/dev/pix/${txId}/pay`),
};
