import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeAppwrite } from './fake-appwrite.js';

let fake, app;
const auth = { authorization: 'Bearer jwt-ana' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  fake = await startFakeAppwrite();
  Object.assign(process.env, {
    APPWRITE_ENDPOINT: fake.url, APPWRITE_PROJECT_ID: 'p', APPWRITE_API_KEY: 'test-key',
    AI_PROVIDER: 'mock', PIX_PROVIDER: 'mock', PIX_WEBHOOK_SECRET: 's3cr3t', AI_POLL_MS: '200',
  });
  const { buildApp } = await import('../src/server.js');
  app = await buildApp({ logger: false });
});
after(async () => { await app.close(); fake.server.close(); });

async function waitProject(id, status) {
  for (let i = 0; i < 60; i++) {
    const d = fake.docs.get(`projects/${id}`);
    if (d?.status === status) return d;
    await sleep(200);
  }
  throw new Error('timeout esperando ' + status);
}

test('rejeita sem autenticação', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/me' });
  assert.equal(r.statusCode, 401);
});

test('cria perfil com 10 créditos de bônus', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/me', headers: auth });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().profile.saldo_creditos, 10);
  assert.equal(r.json().plano.id, 'gratis');
  // segunda chamada não duplica bônus
  const r2 = await app.inject({ method: 'GET', url: '/api/me', headers: auth });
  assert.equal(r2.json().profile.saldo_creditos, 10);
});

test('gera modelo, desconta crédito e produz arquivos para SketchUp', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/generate', headers: auth, payload: { prompt: 'uma casa pequena com telhado' } });
  assert.equal(r.statusCode, 202);
  assert.equal(r.json().saldo, 9);
  const p = await waitProject(r.json().project.$id, 'pronto');
  for (const k of ['glb', 'dae', 'obj', 'stl']) assert.ok(p[`${k}_file_id`], `faltou ${k}`);
  // plano grátis: visualizar GLB ok, exportar DAE bloqueado
  const glb = await app.inject({ method: 'GET', url: `/api/projects/${p.$id}/file/glb`, headers: auth });
  assert.equal(glb.statusCode, 200);
  assert.equal(glb.rawPayload.subarray(0, 4).toString(), 'glTF');
  const dae = await app.inject({ method: 'GET', url: `/api/projects/${p.$id}/file/dae?download=1`, headers: auth });
  assert.equal(dae.statusCode, 403);
});

test('falha da IA estorna os créditos', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/generate', headers: auth, payload: { prompt: 'isso vai falhar agora' } });
  assert.equal(r.statusCode, 202);
  await waitProject(r.json().project.$id, 'falhou');
  await sleep(100);
  assert.equal(fake.docs.get('profiles/user_ana').saldo_creditos, 9);
});

test('texturas HD bloqueadas no plano grátis', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/generate', headers: auth, payload: { prompt: 'cadeira', texturas: true } });
  assert.equal(r.statusCode, 403);
});

test('webhook exige segredo', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/webhooks/pix', payload: { txid: 'x' } });
  assert.equal(r.statusCode, 401);
});

test('Pix de assinatura: cobra, paga (idempotente) e libera exportação', async () => {
  const c = await app.inject({ method: 'POST', url: '/api/pix/charge', headers: auth, payload: { plano: 'basico' } });
  assert.equal(c.statusCode, 200);
  const { transactionId, copiaECola } = c.json();
  assert.match(copiaECola, /^000201.*6304[0-9A-F]{4}$/);
  // webhook antes de pagar não credita
  const tx = fake.docs.get(`transactions/${transactionId}`);
  const w0 = await app.inject({ method: 'POST', url: '/api/webhooks/pix', headers: { 'x-webhook-secret': 's3cr3t' }, payload: { txid: tx.pix_txid } });
  assert.equal(w0.json().status, 'pendente');
  // paga
  const pay = await app.inject({ method: 'POST', url: `/api/dev/pix/${transactionId}/pay`, headers: auth });
  assert.equal(pay.statusCode, 200);
  // webhook repetido não duplica
  await app.inject({ method: 'POST', url: '/api/webhooks/pix', headers: { 'x-webhook-secret': 's3cr3t' }, payload: { txid: tx.pix_txid } });
  const prof = fake.docs.get('profiles/user_ana');
  assert.equal(prof.plano, 'basico');
  assert.equal(prof.saldo_creditos, 9 + 50);
  const st = await app.inject({ method: 'GET', url: `/api/pix/${transactionId}/status`, headers: auth });
  assert.equal(st.json().status, 'pago');
  // agora DAE liberado
  const pid = [...fake.docs.values()].find((d) => d.$collectionId === 'projects' && d.status === 'pronto').$id;
  const dae = await app.inject({ method: 'GET', url: `/api/projects/${pid}/file/dae?download=1`, headers: auth });
  assert.equal(dae.statusCode, 200);
  assert.match(dae.headers['content-disposition'], /\.dae"/);
});

test('sem créditos retorna 402', async () => {
  fake.docs.get('profiles/user_ana').saldo_creditos = 0;
  const r = await app.inject({ method: 'POST', url: '/api/generate', headers: auth, payload: { prompt: 'mesa de jantar' } });
  assert.equal(r.statusCode, 402);
  assert.equal(r.json().error, 'sem_creditos');
});
