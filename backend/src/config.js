import process from 'node:process';

const env = (k, d) => process.env[k] ?? d;
const required = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${k}`);
  return v;
};

export const config = {
  port: Number(env('PORT', 3000)),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5173').split(',').map((s) => s.trim()),
  appwrite: {
    endpoint: required('APPWRITE_ENDPOINT'),
    projectId: required('APPWRITE_PROJECT_ID'),
    apiKey: required('APPWRITE_API_KEY'),
    databaseId: env('APPWRITE_DATABASE_ID', 'modelagem3d'),
    bucketId: env('APPWRITE_BUCKET_ID', 'modelos3d'),
  },
  ai: {
    provider: env('AI_PROVIDER', 'mock'), // meshy | mock
    meshyKey: env('MESHY_API_KEY', ''),
    pollMs: Number(env('AI_POLL_MS', 5000)),
    timeoutMs: Number(env('AI_TIMEOUT_MS', 15 * 60 * 1000)),
  },
  pix: {
    provider: env('PIX_PROVIDER', 'mock'), // http | mock
    apiUrl: env('PIX_API_URL', ''),
    apiKey: env('PIX_API_KEY', ''),
    webhookSecret: env('PIX_WEBHOOK_SECRET', ''),
    expiresMinutes: Number(env('PIX_EXPIRES_MIN', 10)),
  },
  assimpBin: env('ASSIMP_BIN', 'assimp'),
};

// ---- Regras de negócio (fonte única da verdade; o frontend busca via GET /api/catalog)
export const PLANS = {
  gratis:   { nome: 'Grátis',   precoMensal: 0,     creditosMes: 0,   maxProjetos: 3,        exportar: ['png'],                               texturasHD: false },
  basico:   { nome: 'Básico',   precoMensal: 29.9,  creditosMes: 50,  maxProjetos: 20,       exportar: ['png', 'glb', 'obj', 'dae', 'stl'],   texturasHD: false },
  medio:    { nome: 'Médio',    precoMensal: 79.9,  creditosMes: 200, maxProjetos: Infinity, exportar: ['png', 'glb', 'obj', 'dae', 'stl'],   texturasHD: true },
  avancado: { nome: 'Avançado', precoMensal: 199.9, creditosMes: 600, maxProjetos: Infinity, exportar: ['png', 'glb', 'obj', 'dae', 'stl', 'step'], texturasHD: true },
};

export const CREDIT_PACKS = {
  p100:  { creditos: 100,  valor: 19.9 },
  p500:  { creditos: 500,  valor: 79.9 },
  p1500: { creditos: 1500, valor: 199.9 },
};

export const COSTS = {
  preview: 1,  // malha sem textura
  refine: 3,   // texturas (planos médio/avançado)
};

export const SIGNUP_BONUS = 10;
