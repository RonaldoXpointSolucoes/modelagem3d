import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import api from './routes/api.js';
import { resumePending } from './lib/pipeline.js';
import { AppwriteError } from './lib/appwrite.js';

export async function buildApp(opts = {}) {
  const app = Fastify({ logger: opts.logger ?? { level: process.env.LOG_LEVEL || 'info' }, trustProxy: true, bodyLimit: 1_000_000 });
  await app.register(cors, { origin: config.corsOrigins, credentials: false });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ error: 'dados_invalidos', mensagem: err.message });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'muitas_requisicoes' });
    req.log.error(err);
    const status = err instanceof AppwriteError && err.status === 404 ? 404 : 500;
    return reply.code(status).send({ error: status === 404 ? 'nao_encontrado' : 'erro_interno' });
  });

  app.get('/health', async () => ({ ok: true, ai: config.ai.provider, pix: config.pix.provider }));
  await app.register(api);
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  resumePending(app.log);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
