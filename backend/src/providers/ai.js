// Provedores de IA 3D. Interface comum:
//   start({ prompt, texturas }) -> { taskId }
//   status(taskId) -> { state: 'running'|'done'|'failed', progress, glb: Buffer|undefined, thumbnail: Buffer|undefined, error }
// O pipeline (lib/pipeline.js) faz o polling.
import { config } from '../config.js';
import { makeBoxGLB } from '../lib/glb.js';

// ---------------- Meshy (https://docs.meshy.ai) ----------------
const MESHY = 'https://api.meshy.ai/openapi/v2/text-to-3d';

async function meshy(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${config.ai.meshyKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meshy ${r.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// Task composta: "prev:<id>" (só malha) ou "ref:<previewId>:<refineId|pending>" (com texturas)
const meshyProvider = {
  name: 'meshy',
  async start({ prompt, texturas }) {
    const { result } = await meshy('POST', MESHY, {
      mode: 'preview', prompt, art_style: 'realistic', should_remesh: true, topology: 'triangle', target_polycount: 30000,
    });
    return { taskId: texturas ? `ref:${result}:pending` : `prev:${result}` };
  },
  async status(taskId) {
    const [kind, a, b] = taskId.split(':');
    if (kind === 'ref' && b === 'pending') {
      const prev = await meshy('GET', `${MESHY}/${a}`);
      if (prev.status === 'FAILED' || prev.status === 'CANCELED') return { state: 'failed', error: prev.task_error?.message || 'falha na IA' };
      if (prev.status !== 'SUCCEEDED') return { state: 'running', progress: Math.round((prev.progress || 0) / 2) };
      const { result } = await meshy('POST', MESHY, { mode: 'refine', preview_task_id: a, enable_pbr: true });
      return { state: 'running', progress: 50, nextTaskId: `ref:${a}:${result}` };
    }
    const id = kind === 'ref' ? b : a;
    const t = await meshy('GET', `${MESHY}/${id}`);
    const base = kind === 'ref' ? 50 : 0, span = kind === 'ref' ? 50 : 100;
    if (t.status === 'FAILED' || t.status === 'CANCELED') return { state: 'failed', error: t.task_error?.message || 'falha na IA' };
    if (t.status !== 'SUCCEEDED') return { state: 'running', progress: base + Math.round(((t.progress || 0) * span) / 100) };
    const glb = await fetchBuffer(t.model_urls.glb);
    const thumbnail = t.thumbnail_url ? await fetchBuffer(t.thumbnail_url).catch(() => undefined) : undefined;
    return { state: 'done', progress: 100, glb, thumbnail };
  },
};

// ---------------- Mock (desenvolvimento/testes, sem custo) ----------------
const mockTasks = new Map();
const mockProvider = {
  name: 'mock',
  async start({ prompt }) {
    const taskId = 'mock:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    mockTasks.set(taskId, { t0: Date.now(), prompt });
    return { taskId };
  },
  async status(taskId) {
    const t = mockTasks.get(taskId);
    if (!t) return { state: 'failed', error: 'task desconhecida' };
    if (/\bfalhar\b/i.test(t.prompt)) return { state: 'failed', error: 'falha simulada' };
    const elapsed = Date.now() - t.t0;
    if (elapsed < 3000) return { state: 'running', progress: Math.round((elapsed / 3000) * 100) };
    return { state: 'done', progress: 100, glb: makeBoxGLB() };
  },
};

export function getAIProvider() {
  if (config.ai.provider === 'meshy') {
    if (!config.ai.meshyKey) throw new Error('MESHY_API_KEY não configurada');
    return meshyProvider;
  }
  return mockProvider;
}
