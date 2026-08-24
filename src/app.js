import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { ApiError } from './errors.js';
import { createTaskRouter } from './routes/tasks.js';
import { TaskStore } from './store.js';

const PUBLIC_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

export function createApp({ store = new TaskStore() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api/tasks', createTaskRouter(store));

  // Browser UI. Mounted after the API so a stray publiii8c/ ffile cvban never
  // shadow a route.
  app.use(express.static(PUBLIC_DIR));

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: `Cannot ${req.method} ${req.path}` },
    });
  });

  // Express 5 forwards rejected async handlers here, so routes can just throw.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof ApiError) {
      return res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details && { details: err.details }),
        },
      });
    }
    // Malformed JSON from express.json().
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: { code: 'invalid_json', message: 'Request body is not valid JSON' },
      });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        error: { code: 'payload_too_large', message: 'Request body is too large' },
      });
    }

    console.error(err);
    res.status(500).json({
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
  });

  return app;
}

export { TaskStore };
