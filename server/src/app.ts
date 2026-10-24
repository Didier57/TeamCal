import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import type { DB } from './db';
import { csrfMiddleware, sessionMiddleware } from './lib/auth';
import { errorHandler, notFound } from './lib/errors';
import { logger } from './lib/logger';
import { setupRoutes } from './modules/setup';
import { authRoutes } from './modules/auth';
import { userRoutes } from './modules/users';
import { settingsRoutes } from './modules/settings';
import { categoryRoutes } from './modules/categories';
import { calendarRoutes } from './modules/calendars';
import { eventRoutes } from './modules/events';
import { viewRoutes } from './modules/views';
import { feedRoutes } from './modules/feed';
import { holidayRoutes } from './modules/holidays';
import { importRoutes } from './modules/import';
import { exportRoutes } from './modules/export';
import { reportRoutes } from './modules/reports';
import { pushRoutes } from './modules/push';
import { backupRoutes } from './modules/backups';

export interface AppOptions {
  clientDist?: string;
  serveClient?: boolean;
}

export function createApp(db: DB, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    req.db = db;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '12mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware);
  app.use(csrfMiddleware);
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      logger.debug('api_request', { method: req.method, path: req.path, userId: req.user?.id });
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api/setup', setupRoutes());
  app.use('/api/auth', authRoutes());
  app.use('/api/users', userRoutes());
  app.use('/api/settings', settingsRoutes());
  app.use('/api/categories', categoryRoutes());
  app.use('/api/calendars', calendarRoutes());
  app.use('/api/events', eventRoutes());
  app.use('/api/views', viewRoutes());
  app.use('/api/feed', feedRoutes());
  app.use('/api/holidays', holidayRoutes());
  app.use('/api/import', importRoutes());
  app.use('/api/export', exportRoutes());
  app.use('/api/reports', reportRoutes());
  app.use('/api/push', pushRoutes());
  app.use('/api/backups', backupRoutes());
  app.use('/api', notFound);

  const clientDist = options.clientDist ?? path.resolve(__dirname, '../../client/dist');
  if (options.serveClient !== false && fs.existsSync(clientDist)) {
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        }
      })
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api')) return next();
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'"
      );
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
