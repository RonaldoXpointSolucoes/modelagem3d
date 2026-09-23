import { config, PLANS, CREDIT_PACKS, COSTS } from '../config.js';
import { db, storage, perm, uniqueId, Q } from '../lib/appwrite.js';
import { requireUser, effectivePlan } from '../lib/auth.js';
import { ensureProfile, debit, refund, NoCreditsError, applyPaidTransaction } from '../lib/credits.js';
import { runGeneration, storeModelFiles } from '../lib/pipeline.js';
import { importToGLB, ImportError } from '../lib/convert.js';
import { isGLB } from '../lib/glb.js';
import { gzipSync } from 'node:zlib';
import { getAIProvider } from '../providers/ai.js';
import { getPixProvider } from '../providers/pix.js';

const serializePlans = () => Object.fromEntries(Object.entries(PLANS).map(([k, v]) =>
  [k, { ...v, maxProjetos: Number.isFinite(v.maxProjetos) ? v.maxProjetos : null }]));

export default async function api(app) {
  // ------------------------------------------------------------ público
  app.get('/api/catalog', async () => ({ planos: serializePlans(), pacotes: CREDIT_PACKS, custos: COSTS, maxUploadMB: Math.round(config.maxUploadBytes / 1e6) }));

  // ------------------------------------------------------------ autenticado
  app.register(async (priv) => {
    priv.addHook('preHandler', requireUser);

    priv.get('/api/me', async (req) => {
      const profile = await ensureProfile(req.user);
      return { user: { id: req.user.$id, email: req.user.email, name: req.user.name }, profile, plano: effectivePlan(profile) };
    });

    // ---- Geração 3D (o frontend NUNCA fala com a IA diretamente)
    priv.post('/api/generate', {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object', required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 3, maxLength: 600 },
            nome: { type: 'string', maxLength: 120 },
            texturas: { type: 'boolean' },
          },
        },
      },
    }, async (req, reply) => {
      const uid = req.user.$id;
      const profile = await ensureProfile(req.user);
      const plano = effectivePlan(profile);
      const texturas = !!req.body.texturas;
      if (texturas && !plano.texturasHD) return reply.code(403).send({ error: 'plano_sem_texturas', mensagem: 'Texturas em alta resolução a partir do plano Médio.' });

      if (Number.isFinite(plano.maxProjetos)) {
        const { total } = await db.list('projects', [Q.equal('user_id', uid), Q.limit(1)]);
        if (total >= plano.maxProjetos) return reply.code(403).send({ error: 'limite_projetos', mensagem: `Seu plano permite ${plano.maxProjetos} projetos.` });
      }

      const custo = COSTS.preview + (texturas ? COSTS.refine : 0);
      const projectId = uniqueId();
      let saldo;
      try {
        ({ saldo_creditos: saldo } = await debit(uid, custo, { projectId }));
      } catch (e) {
        if (e instanceof NoCreditsError) return reply.code(402).send({ error: 'sem_creditos', saldo: e.saldo, necessario: e.necessario });
        throw e;
      }

      let project;
      try {
        const { taskId } = await getAIProvider().start({ prompt: req.body.prompt, texturas });
        project = await db.create('projects', projectId, {
          user_id: uid, nome_projeto: req.body.nome?.trim() || req.body.prompt.slice(0, 60), prompt: req.body.prompt,
          status: 'gerando', progresso: 0, provider_task_id: taskId, creditos_usados: custo,
        }, [perm.read(uid)]);
      } catch (e) {
        await refund(uid, custo, { projectId });
        req.log.error(e);
        return reply.code(502).send({ error: 'ia_indisponivel', mensagem: 'A IA não respondeu. Seus créditos foram devolvidos.' });
      }
      runGeneration(project, req.log);
      return reply.code(202).send({ project, saldo });
    });

    priv.get('/api/projects', async (req) => {
      const { documents } = await db.list('projects', [Q.equal('user_id', req.user.$id), Q.orderDesc('$createdAt'), Q.limit(100)]);
      return { projects: documents };
    });

    priv.delete('/api/projects/:id', async (req, reply) => {
      const p = await db.getOrNull('projects', req.params.id);
      if (!p || p.user_id !== req.user.$id) return reply.code(404).send({ error: 'nao_encontrado' });
      for (const k of ['glb', 'dae', 'obj', 'stl', 'thumbnail', 'original']) if (p[`${k}_file_id`]) await storage.delete(p[`${k}_file_id`]).catch(() => {});
      await db.delete('projects', p.$id);
      return { ok: true };
    });

    // ---- Arquivos (proxy com checagem de dono + plano)
    // fmt: glb (visualizador, sempre liberado) | dae | obj | stl | thumbnail
    priv.get('/api/projects/:id/file/:fmt', async (req, reply) => {
      const { id, fmt } = req.params;
      if (!['glb', 'dae', 'obj', 'stl', 'thumbnail', 'original'].includes(fmt)) return reply.code(400).send({ error: 'formato_invalido' });
      const p = await db.getOrNull('projects', id);
      if (!p || p.user_id !== req.user.$id) return reply.code(404).send({ error: 'nao_encontrado' });
      const download = req.query.download === '1';
      if (!['thumbnail', 'original'].includes(fmt) && (download || fmt !== 'glb')) {
        const plano = effectivePlan(await db.get('profiles', req.user.$id));
        if (!plano.exportar.includes(fmt)) return reply.code(403).send({ error: 'plano_sem_exportacao', mensagem: `Exportar ${fmt.toUpperCase()} requer um plano pago.` });
      }
      const fileId = p[`${fmt}_file_id`];
      if (!fileId) return reply.code(404).send({ error: 'arquivo_indisponivel' });
      const r = await storage.download(fileId);
      const name = decodeURIComponent((r.headers.get('content-disposition') || '').match(/filename="?([^";]+)/)?.[1] || `${id}.${fmt}`);
      reply.header('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
      reply.header('Cache-Control', 'private, max-age=3600');
      if (download) reply.header('Content-Disposition', `attachment; filename="${name}"`);
      return reply.send(Buffer.from(await r.arrayBuffer()));
    });

    // ---- Importar modelo do SketchUp (.dae / .zip com .dae + texturas) ou .glb/.obj/.stl
    priv.post('/api/import', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      const uid = req.user.$id;
      const plano = effectivePlan(await ensureProfile(req.user));
      if (Number.isFinite(plano.maxProjetos)) {
        const { total } = await db.list('projects', [Q.equal('user_id', uid), Q.limit(1)]);
        if (total >= plano.maxProjetos) return reply.code(403).send({ error: 'limite_projetos', mensagem: `Seu plano permite ${plano.maxProjetos} projetos.` });
      }
      const part = await req.file();
      if (!part) return reply.code(400).send({ error: 'arquivo_ausente' });
      const buffer = await part.toBuffer(); // lança FST_REQ_FILE_TOO_LARGE se passar do limite
      const filename = part.filename || 'modelo.dae';
      const nome = (part.fields?.nome?.value || filename.replace(/\.[^.]+$/, '')).trim().slice(0, 120) || 'Modelo importado';
      const ext = filename.split('.').pop().toLowerCase();

      const project = await db.create('projects', uniqueId(), {
        user_id: uid, nome_projeto: nome, status: 'gerando', progresso: 10, creditos_usados: 0,
        origem: 'importado', formato_original: ext, versao: 1,
      }, [perm.read(uid)]);

      // Processa em segundo plano; o app acompanha pelo Realtime.
      (async () => {
        try {
          const origId = uniqueId();
          // Guarda o original compactado (DAE é XML e compacta ~10x)
          const orig = ext === 'zip' ? { buf: buffer, name: filename, mime: 'application/zip' } : { buf: gzipSync(buffer, { level: 6 }), name: filename + '.gz', mime: 'application/gzip' };
          await storage.upload(origId, orig.buf, orig.name, orig.mime, [perm.read(uid)]);
          await db.update('projects', project.$id, { original_file_id: origId, progresso: 30 });
          const { glb } = await importToGLB(buffer, filename);
          const patch = await storeModelFiles({ ...project, original_file_id: origId }, glb);
          await db.update('projects', project.$id, { ...patch, status: 'pronto', progresso: 100 });
        } catch (e) {
          req.log.warn({ err: e.message }, 'importação falhou');
          const msg = e instanceof ImportError ? e.message : 'Falha ao processar o arquivo.';
          await db.update('projects', project.$id, { status: 'falhou', erro: msg.slice(0, 999) }).catch(() => {});
        }
      })();
      return reply.code(202).send({ project });
    });

    // ---- Salvar a versão editada no app (GLB binário) e regenerar DAE/OBJ/STL
    priv.post('/api/projects/:id/save', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const p = await db.getOrNull('projects', req.params.id);
      if (!p || p.user_id !== req.user.$id) return reply.code(404).send({ error: 'nao_encontrado' });
      if (p.status !== 'pronto') return reply.code(409).send({ error: 'projeto_ocupado', mensagem: 'Aguarde o processamento terminar.' });
      if (!Buffer.isBuffer(req.body) || !isGLB(req.body)) return reply.code(400).send({ error: 'glb_invalido' });
      const patch = await storeModelFiles(p, req.body);
      const updated = await db.update('projects', p.$id, { ...patch, versao: (p.versao || 1) + 1 });
      return { project: updated };
    });

    // ---- Pix: cria cobrança de pacote de créditos ou assinatura
    priv.post('/api/pix/charge', {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: { type: 'object', properties: { pacote: { type: 'string' }, plano: { type: 'string' } } } },
    }, async (req, reply) => {
      const uid = req.user.$id;
      await ensureProfile(req.user);
      let tipo, creditos, valor, pacote, descricao;
      if (req.body.pacote && CREDIT_PACKS[req.body.pacote]) {
        ({ creditos, valor } = CREDIT_PACKS[req.body.pacote]);
        tipo = 'recarga_pix'; pacote = req.body.pacote; descricao = `Modelagem 3D - ${creditos} creditos`;
      } else if (req.body.plano && PLANS[req.body.plano] && req.body.plano !== 'gratis') {
        const pl = PLANS[req.body.plano];
        tipo = 'assinatura_pix'; creditos = pl.creditosMes; valor = pl.precoMensal; pacote = req.body.plano; descricao = `Modelagem 3D - Plano ${pl.nome} (30 dias)`;
      } else {
        return reply.code(400).send({ error: 'pacote_invalido' });
      }
      const txDocId = uniqueId();
      const txid = ('M3D' + txDocId).replace(/[^A-Za-z0-9]/g, '').slice(0, 35).padEnd(26, '0'); // txid Pix: 26-35 alfanum.
      const expira = new Date(Date.now() + config.pix.expiresMinutes * 60_000);
      const charge = await getPixProvider().createCharge({ txid, valor, descricao, expiresMinutes: config.pix.expiresMinutes });
      const tx = await db.create('transactions', txDocId, {
        user_id: uid, tipo, creditos, valor, status: 'pendente', pacote,
        pix_txid: charge.txid, pix_payload: charge.copiaECola, expira_em: expira.toISOString(),
      }, [perm.read(uid)]);
      return { transactionId: tx.$id, copiaECola: charge.copiaECola, valor, creditos, expiraEm: tx.expira_em };
    });

    // Fallback do webhook: o front consulta; se o provedor disser "pago", aplicamos.
    priv.get('/api/pix/:txId/status', async (req, reply) => {
      const tx = await db.getOrNull('transactions', req.params.txId);
      if (!tx || tx.user_id !== req.user.$id) return reply.code(404).send({ error: 'nao_encontrado' });
      if (tx.status === 'pendente') {
        const s = await getPixProvider().getStatus(tx.pix_txid).catch(() => 'pendente');
        if (s === 'pago') await applyPaidTransaction(tx);
        else if (s === 'expirado' || (s === 'pendente' && new Date(tx.expira_em) < new Date(Date.now() - 5 * 60_000))) await db.update('transactions', tx.$id, { status: 'expirado' });
        return { status: s === 'pago' ? 'pago' : (await db.get('transactions', tx.$id)).status };
      }
      return { status: tx.status };
    });

    // Somente em modo mock: simula o pagamento para testar o fluxo inteiro
    if (config.pix.provider === 'mock') {
      priv.post('/api/dev/pix/:txId/pay', async (req, reply) => {
        const tx = await db.getOrNull('transactions', req.params.txId);
        if (!tx || tx.user_id !== req.user.$id) return reply.code(404).send({ error: 'nao_encontrado' });
        getPixProvider().simulatePaid(tx.pix_txid);
        // dispara o mesmo caminho do webhook
        const r = await app.inject({ method: 'POST', url: '/api/webhooks/pix', headers: { 'x-webhook-secret': config.pix.webhookSecret }, payload: { txid: tx.pix_txid } });
        return reply.code(r.statusCode).send(r.json());
      });
    }
  });

  // ------------------------------------------------------------ webhook Pix
  app.post('/api/webhooks/pix', async (req, reply) => {
    const secret = config.pix.webhookSecret;
    const got = req.headers['x-webhook-secret'] || req.query.secret;
    if (!secret || got !== secret) return reply.code(401).send({ error: 'nao_autorizado' });
    const { txid } = getPixProvider().parseWebhook(req.body);
    if (!txid) return reply.code(400).send({ error: 'txid_ausente' });
    const { documents } = await db.list('transactions', [Q.equal('pix_txid', txid), Q.limit(1)]);
    const tx = documents[0];
    if (!tx) return reply.code(404).send({ error: 'transacao_desconhecida' });
    // Nunca confia só no corpo do webhook: reconfirma no provedor.
    const status = await getPixProvider().getStatus(txid);
    if (status !== 'pago') return { ok: true, status };
    const r = await applyPaidTransaction(tx);
    req.log.info({ tx: tx.$id, already: r.already }, 'pix confirmado');
    return { ok: true, status: 'pago' };
  });
}
