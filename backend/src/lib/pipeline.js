// Pipeline de geração: polling da IA -> salva GLB/thumbnail -> converte p/ SketchUp -> atualiza projeto.
// O frontend acompanha o documento do projeto via Appwrite Realtime (status/progresso).
import { config } from '../config.js';
import { db, storage, perm, uniqueId, Q } from './appwrite.js';
import { getAIProvider } from '../providers/ai.js';
import { convertForSketchUp } from './convert.js';
import { refund } from './credits.js';

const running = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => (s || 'modelo').normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40) || 'modelo';

export function runGeneration(project, log = console) {
  if (running.has(project.$id)) return;
  running.add(project.$id);
  _run(project, log).catch((e) => log.error?.(e)).finally(() => running.delete(project.$id));
}

async function _run(project, log) {
  const ai = getAIProvider();
  const uid = project.user_id;
  let taskId = project.provider_task_id;
  const deadline = new Date(project.$createdAt).getTime() + config.ai.timeoutMs;
  let lastProgress = -1;
  try {
    for (;;) {
      if (Date.now() > deadline) throw new Error('Tempo limite de geração excedido');
      const s = await ai.status(taskId);
      if (s.nextTaskId) { taskId = s.nextTaskId; await db.update('projects', project.$id, { provider_task_id: taskId }); }
      if (s.state === 'failed') throw new Error(s.error || 'Falha na geração');
      if (s.state === 'done') {
        await finish(project, s);
        return;
      }
      if (s.progress !== lastProgress) {
        lastProgress = s.progress;
        await db.update('projects', project.$id, { progresso: Math.min(95, s.progress ?? 0) });
      }
      await sleep(config.ai.pollMs);
    }
  } catch (e) {
    log.warn?.({ err: e.message, project: project.$id }, 'geração falhou — estornando créditos');
    await db.update('projects', project.$id, { status: 'falhou', erro: String(e.message).slice(0, 999) });
    if (project.creditos_usados > 0) await refund(uid, project.creditos_usados, { projectId: project.$id });
  }
}

async function finish(project, s) {
  const uid = project.user_id;
  const perms = [perm.read(uid)];
  const name = slug(project.nome_projeto);
  const glbId = uniqueId();
  await storage.upload(glbId, s.glb, `${name}.glb`, 'model/gltf-binary', perms);
  const patch = { glb_file_id: glbId, progresso: 97 };
  if (s.thumbnail) {
    const thId = uniqueId();
    await storage.upload(thId, s.thumbnail, `${name}.png`, 'image/png', perms);
    patch.thumbnail_file_id = thId;
  }
  await db.update('projects', project.$id, patch);

  // Conversões para SketchUp (não bloqueiam o "pronto" se falharem)
  try {
    const conv = await convertForSketchUp(s.glb, name);
    for (const [fmt, f] of Object.entries(conv)) {
      const id = uniqueId();
      await storage.upload(id, f.buffer, f.filename, f.mime, perms);
      patch[`${fmt}_file_id`] = id;
    }
  } catch (e) {
    patch.erro = 'Conversão para SketchUp falhou: ' + e.message.slice(0, 200);
  }
  await db.update('projects', project.$id, { ...patch, status: 'pronto', progresso: 100 });
}

/** Retoma gerações interrompidas por reinício do servidor. */
export async function resumePending(log) {
  try {
    const { documents } = await db.list('projects', [Q.equal('status', 'gerando'), Q.limit(100)]);
    for (const p of documents) if (p.provider_task_id) runGeneration(p, log);
    if (documents.length) log.info(`retomando ${documents.length} geração(ões) pendente(s)`);
  } catch (e) {
    log.warn({ err: e.message }, 'não foi possível retomar gerações');
  }
}
