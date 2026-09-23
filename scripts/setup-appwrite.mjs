#!/usr/bin/env node
// Cria (ou completa) a estrutura do Appwrite para o Modelagem 3D.
// Idempotente: pode rodar várias vezes. Uso:
//   APPWRITE_ENDPOINT=... APPWRITE_PROJECT_ID=... APPWRITE_API_KEY=... node scripts/setup-appwrite.mjs
import process from 'node:process';

const E = process.env.APPWRITE_ENDPOINT;
const P = process.env.APPWRITE_PROJECT_ID;
const K = process.env.APPWRITE_API_KEY;
const DB = process.env.APPWRITE_DATABASE_ID || 'modelagem3d';
const BUCKET = process.env.APPWRITE_BUCKET_ID || 'modelos3d';
if (!E || !P || !K) { console.error('Defina APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY'); process.exit(1); }

async function aw(method, path, body) {
  const r = await fetch(E + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Appwrite-Project': P, 'X-Appwrite-Key': K },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  const data = txt ? JSON.parse(txt) : {};
  if (!r.ok && r.status !== 409) throw new Error(`${method} ${path} -> ${r.status} ${data.message}`);
  return { status: r.status, data };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Coleções: permissões de documento são definidas pelo backend (documentSecurity=true).
// Nenhum cliente pode criar/editar: só o backend (API key) escreve.
const collections = {
  profiles: {
    name: 'Perfis',
    attrs: [
      ['string', 'nome', { size: 128, required: false }],
      ['enum', 'plano', { elements: ['gratis', 'basico', 'medio', 'avancado'], required: false, default: 'gratis' }],
      ['integer', 'saldo_creditos', { required: false, default: 0, min: 0 }],
      ['datetime', 'plano_expira_em', { required: false }],
    ],
    indexes: [],
  },
  projects: {
    name: 'Projetos',
    attrs: [
      ['string', 'user_id', { size: 36, required: true }],
      ['string', 'nome_projeto', { size: 256, required: true }],
      ['string', 'prompt', { size: 2000, required: false }],
      ['enum', 'status', { elements: ['gerando', 'pronto', 'falhou'], required: false, default: 'gerando' }],
      ['integer', 'progresso', { required: false, default: 0, min: 0, max: 100 }],
      ['string', 'provider_task_id', { size: 128, required: false }],
      ['string', 'thumbnail_file_id', { size: 36, required: false }],
      ['string', 'glb_file_id', { size: 36, required: false }],
      ['string', 'dae_file_id', { size: 36, required: false }],
      ['string', 'obj_file_id', { size: 36, required: false }],
      ['string', 'stl_file_id', { size: 36, required: false }],
      ['string', 'erro', { size: 1000, required: false }],
      ['integer', 'creditos_usados', { required: false, default: 0, min: 0 }],
      ['enum', 'origem', { elements: ['ia', 'importado'], required: false, default: 'ia' }],
      ['integer', 'versao', { required: false, default: 1, min: 1 }],
      ['string', 'original_file_id', { size: 36, required: false }],
      ['string', 'formato_original', { size: 16, required: false }],
    ],
    indexes: [['idx_user', 'key', ['user_id']]],
  },
  transactions: {
    name: 'Transacoes',
    attrs: [
      ['string', 'user_id', { size: 36, required: true }],
      ['enum', 'tipo', { elements: ['recarga_pix', 'assinatura_pix', 'consumo_ia', 'estorno', 'bonus'], required: true }],
      ['integer', 'creditos', { required: true, min: -100000, max: 100000 }],
      ['float', 'valor', { required: false, default: 0 }],
      ['enum', 'status', { elements: ['pendente', 'pago', 'falhou', 'expirado'], required: false, default: 'pendente' }],
      ['string', 'pacote', { size: 64, required: false }],
      ['string', 'pix_txid', { size: 128, required: false }],
      ['string', 'pix_payload', { size: 2000, required: false }],
      ['datetime', 'expira_em', { required: false }],
      ['string', 'project_id', { size: 36, required: false }],
    ],
    indexes: [['idx_user', 'key', ['user_id']], ['idx_txid', 'key', ['pix_txid']]],
  },
};

async function ensureAttr(col, [type, key, opt]) {
  const path = `/databases/${DB}/collections/${col}/attributes/${type}`;
  const body = { key, required: !!opt.required, array: false };
  if (!opt.required && opt.default !== undefined) body.default = opt.default;
  if (type === 'string') body.size = opt.size;
  if (type === 'enum') body.elements = opt.elements;
  if (type === 'integer' || type === 'float') { if (opt.min !== undefined) body.min = opt.min; if (opt.max !== undefined) body.max = opt.max; }
  const r = await aw('POST', path, body);
  console.log(`  atributo ${col}.${key}: ${r.status === 409 ? 'já existe' : 'criado'}`);
}

async function waitAttrs(col) {
  for (let i = 0; i < 60; i++) {
    const { data } = await aw('GET', `/databases/${DB}/collections/${col}/attributes`);
    if (data.attributes.every((a) => a.status === 'available')) return;
    await sleep(1000);
  }
  throw new Error('atributos não ficaram disponíveis em ' + col);
}

async function main() {
  const db = await aw('POST', '/databases', { databaseId: DB, name: 'Modelagem 3D' });
  console.log(`database ${DB}: ${db.status === 409 ? 'já existe' : 'criado'}`);

  for (const [id, def] of Object.entries(collections)) {
    const c = await aw('POST', `/databases/${DB}/collections`, {
      collectionId: id, name: def.name, permissions: [], documentSecurity: true, enabled: true,
    });
    console.log(`coleção ${id}: ${c.status === 409 ? 'já existe' : 'criada'}`);
    for (const a of def.attrs) await ensureAttr(id, a);
    await waitAttrs(id);
    for (const [key, type, attributes] of def.indexes) {
      const r = await aw('POST', `/databases/${DB}/collections/${id}/indexes`, { key, type, attributes });
      console.log(`  índice ${key}: ${r.status === 409 ? 'já existe' : 'criado'}`);
    }
  }

  // Bucket privado: permissão por arquivo (fileSecurity). Downloads passam pelo backend.
  const b = await aw('POST', '/storage/buckets', {
    bucketId: BUCKET, name: 'Modelos 3D', permissions: [], fileSecurity: true, enabled: true,
    maximumFileSize: Number(process.env.APPWRITE_MAX_FILE || 30_000_000), allowedFileExtensions: ['glb', 'gltf', 'dae', 'obj', 'mtl', 'stl', 'zip', 'png', 'jpg', 'jpeg', 'step', 'stp', 'gz'],
    compression: 'none', encryption: true, antivirus: true,
  });
  console.log(`bucket ${BUCKET}: ${b.status === 409 ? 'já existe' : 'criado'}`);
  console.log('\nPronto.');
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
