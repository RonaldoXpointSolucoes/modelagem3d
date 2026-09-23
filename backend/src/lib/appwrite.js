// Cliente REST mínimo do Appwrite (server-side, API key). Evita acoplamento de versão de SDK.
import { config } from '../config.js';

const { endpoint, projectId, apiKey, databaseId, bucketId } = config.appwrite;

export class AppwriteError extends Error {
  constructor(status, body) {
    super(body?.message || `Appwrite HTTP ${status}`);
    this.status = status;
    this.type = body?.type;
  }
}

async function call(method, path, { body, headers = {}, raw = false, auth = 'key' } = {}) {
  const h = { 'X-Appwrite-Project': projectId, ...headers };
  if (auth === 'key') h['X-Appwrite-Key'] = apiKey;
  let payload = body;
  if (body && !(body instanceof FormData)) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(endpoint + path, { method, headers: h, body: payload });
  if (raw) { if (!r.ok) throw new AppwriteError(r.status, await r.json().catch(() => ({}))); return r; }
  const txt = await r.text();
  const data = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new AppwriteError(r.status, data);
  return data;
}

export const perm = {
  read: (uid) => `read("user:${uid}")`,
};

// ---------- Auth
/** Valida o JWT emitido pelo SDK web (account.createJWT) e devolve o usuário. */
export async function getUserFromJWT(jwt) {
  return call('GET', '/account', { auth: 'jwt', headers: { 'X-Appwrite-JWT': jwt } });
}

// ---------- Database
const col = (c) => `/databases/${databaseId}/collections/${c}/documents`;

export const db = {
  get: (c, id) => call('GET', `${col(c)}/${id}`),
  async getOrNull(c, id) {
    try { return await db.get(c, id); } catch (e) { if (e.status === 404) return null; throw e; }
  },
  create: (c, id, data, permissions = []) => call('POST', col(c), { body: { documentId: id, data, permissions } }),
  update: (c, id, data) => call('PATCH', `${col(c)}/${id}`, { body: { data } }),
  delete: (c, id) => call('DELETE', `${col(c)}/${id}`),
  list(c, queries = []) {
    const qs = queries.map((q) => `queries[]=${encodeURIComponent(JSON.stringify(q))}`).join('&');
    return call('GET', `${col(c)}${qs ? '?' + qs : ''}`);
  },
};

// Queries no formato JSON aceito pelo Appwrite 1.7
export const Q = {
  equal: (attribute, value) => ({ method: 'equal', attribute, values: Array.isArray(value) ? value : [value] }),
  orderDesc: (attribute) => ({ method: 'orderDesc', attribute }),
  limit: (n) => ({ method: 'limit', values: [n] }),
};

// ---------- Storage
export const storage = {
  /** Upload em partes de 5 MB (o Appwrite exige chunks acima de 5 MB). */
  async upload(fileId, buffer, filename, mime, permissions) {
    const CHUNK = 5 * 1024 * 1024;
    const total = buffer.length;
    let res;
    for (let start = 0; start < total || start === 0; start += CHUNK) {
      const end = Math.min(start + CHUNK, total);
      const fd = new FormData();
      fd.append('fileId', fileId);
      fd.append('file', new Blob([buffer.subarray(start, end)], { type: mime }), filename);
      for (const p of permissions) fd.append('permissions[]', p);
      const headers = {};
      if (total > CHUNK) {
        headers['Content-Range'] = `bytes ${start}-${end - 1}/${total}`;
        if (start > 0) headers['X-Appwrite-ID'] = fileId;
      }
      res = await call('POST', `/storage/buckets/${bucketId}/files`, { body: fd, headers });
      if (total <= CHUNK) break;
    }
    return res;
  },
  download: (fileId) => call('GET', `/storage/buckets/${bucketId}/files/${fileId}/download`, { raw: true }),
  delete: (fileId) => call('DELETE', `/storage/buckets/${bucketId}/files/${fileId}`),
};

export const uniqueId = () => {
  // Mesmo formato do ID.unique() do Appwrite (hex de timestamp + aleatório, 20 chars)
  const t = Date.now().toString(16).padStart(12, '0').slice(-12);
  return t + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
};
