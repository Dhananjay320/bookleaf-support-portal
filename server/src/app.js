import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authenticate, requireRole } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import bookRoutes from './routes/books.routes.js';
import ticketRoutes from './routes/tickets.routes.js';
import adminRoutes from './routes/admin.routes.js';
import eventRoutes from './routes/events.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway's proxy: needed for rate limiting by IP
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Optional CORS for a separately hosted frontend. The default deployment serves
  // the SPA from this same origin, so CORS isn't needed.
  if (config.corsOrigin) {
    app.use((req, res, next) => {
      res.set({
        'Access-Control-Allow-Origin': config.corsOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      });
      if (req.method === 'OPTIONS') return res.status(204).end();
      next();
    });
  }

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  api.use('/auth', authRoutes);
  // Everything below requires a valid session.
  api.use(authenticate);
  api.use('/books', bookRoutes);
  api.use('/tickets', ticketRoutes);
  api.use('/events', eventRoutes);
  api.use('/admin', requireRole('admin'), adminRoutes);
  api.use(notFoundHandler);

  app.use('/api/v1', api);

  // Serve the built React app (production / single-service deploy).
  if (fs.existsSync(config.clientDistPath)) {
    app.use(express.static(config.clientDistPath, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.clientDistPath, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
