// Appwrite falso em memória — só as rotas que o backend usa. Para testes.
import http from 'node:http';

export function startFakeAppwrite() {
  const docs = new Map();  // `${col}/${id}` -> doc
  const files = new Map(); // id -> { buf, type, name }
  const chunks = [];
  const users = { 'jwt-ana': { $id: 'user_ana', email: 'ana@teste.com', name: 'Ana' } };

  const server = http.createServer(async (req, res) => {
    const parts = []; for await (const c of req) parts.push(c);
    const raw = Buffer.concat(parts);
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/^\/v1/, '');
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

    if (p === '/account') {
      const u = users[req.headers['x-appwrite-jwt']];
      return u ? send(200, u) : send(401, { message: 'jwt invalid' });
    }
    if (req.headers['x-appwrite-key'] !== 'test-key') return send(401, { message: 'no key' });

    let m;
    if ((m = p.match(/^\/databases\/[^/]+\/collections\/([^/]+)\/documents(?:\/([^/]+))?$/))) {
      const [, col, id] = m;
      const k = `${col}/${id}`;
      if (req.method === 'GET' && id) return docs.has(k) ? send(200, docs.get(k)) : send(404, { message: 'not found' });
      if (req.method === 'GET') {
        const qs = url.searchParams.getAll('queries[]').map((q) => JSON.parse(q));
        let list = [...docs.entries()].filter(([kk]) => kk.startsWith(col + '/')).map(([, d]) => d);
        for (const q of qs) if (q.method === 'equal') list = list.filter((d) => q.values.includes(d[q.attribute]));
        for (const q of qs) if (q.method === 'orderDesc') list.sort((a, b) => (a[q.attribute] < b[q.attribute] ? 1 : -1));
        const total = list.length;
        const lim = qs.find((q) => q.method === 'limit'); if (lim) list = list.slice(0, lim.values[0]);
        return send(200, { total, documents: list });
      }
      const body = raw.length ? JSON.parse(raw) : {};
      if (req.method === 'POST') {
        const nk = `${col}/${body.documentId}`;
        if (docs.has(nk)) return send(409, { message: 'exists' });
        const d = { ...body.data, $id: body.documentId, $collectionId: col, $createdAt: new Date().toISOString(), $permissions: body.permissions };
        docs.set(nk, d); return send(201, d);
      }
      if (req.method === 'PATCH') {
        if (!docs.has(k)) return send(404, { message: 'not found' });
        const d = { ...docs.get(k), ...body.data }; docs.set(k, d); return send(200, d);
      }
      if (req.method === 'DELETE') { docs.delete(k); res.writeHead(204); return res.end(); }
    }
    if ((m = p.match(/^\/storage\/buckets\/[^/]+\/files(?:\/([^/]+))?(\/download)?$/))) {
      const [, id, dl] = m;
      if (req.method === 'POST') {
        const form = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData();
        const f = form.get('file');
        const chunk = Buffer.from(await f.arrayBuffer());
        const prev = req.headers['x-appwrite-id'] && files.get(form.get('fileId'));
        if (req.headers['content-range'] && chunk.length > 5 * 1024 * 1024) return send(400, { message: 'chunk grande demais' });
        if (!req.headers['content-range'] && chunk.length > 5 * 1024 * 1024) return send(400, { message: 'arquivo > 5MB sem chunks' });
        files.set(form.get('fileId'), { buf: prev ? Buffer.concat([prev.buf, chunk]) : chunk, type: f.type, name: f.name, perms: form.getAll('permissions[]') });
        chunks.push(req.headers['content-range'] || 'single');
        return send(201, { $id: form.get('fileId') });
      }
      if (req.method === 'GET' && dl) {
        const f = files.get(id); if (!f) return send(404, { message: 'nf' });
        res.writeHead(200, { 'Content-Type': f.type, 'Content-Disposition': `attachment; filename="${f.name}"` }); return res.end(f.buf);
      }
      if (req.method === 'DELETE') { files.delete(id); res.writeHead(204); return res.end(); }
    }
    send(404, { message: 'route not found ' + p });
  });
  return new Promise((r) => server.listen(0, () => r({ server, docs, files, chunks, url: `http://127.0.0.1:${server.address().port}/v1` })));
}
