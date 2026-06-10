import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import open from 'open';
import { getConfig } from './config.js';
import { initDb } from './db.js';
import { installErrorHandler } from './errors.js';
import { createExtractor, bindProgressDb } from './ingest/extractor.js';
import { registerBookRoutes } from './routes/books.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { createSettingsStore } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  const config = getConfig();
  const db = initDb(config);
  bindProgressDb(db);
  const settingsStore = createSettingsStore(config);

  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'AI_API_KEY', 'apiKey']
    }
  });

  installErrorHandler(app);
  await app.register(multipart, {
    limits: {
      fileSize: 80 * 1024 * 1024,
      files: 1
    }
  });

  const extractor = createExtractor({ db, config, getAiSettings: settingsStore.getAiSettings });

  app.get('/api/health', async () => ({ ok: true }));
  await registerSettingsRoutes(app, { settingsStore });
  await registerBookRoutes(app, { db, config, extractor, settingsStore });
  await registerGraphRoutes(app, { db });
  await registerSearchRoutes(app, { db });

  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/'
    });
  }

  return { app, config };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { app, config } = await buildApp();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const url = `http://localhost:${config.port}`;
  app.log.info(`mystery-reader listening at ${url}`);
  if (process.env.OPEN_BROWSER !== '0') {
    await open(url);
  }
}
