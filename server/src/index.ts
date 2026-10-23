import path from 'node:path';
import { openDatabase } from './db';
import { createApp } from './app';
import { cleanupExpiredSessions } from './lib/auth';
import { logger } from './lib/logger';
import { SettingsStore } from './settings';
import { startHolidayScheduler } from './lib/holidays';

const port = Number(process.env.PORT ?? 8080);
const databasePath = process.env.DATABASE_PATH ?? path.resolve(__dirname, '../../data/teamcal.sqlite');

const db = openDatabase(databasePath);
const app = createApp(db);

const settings = new SettingsStore(db).get();
logger.info('server_starting', {
  port,
  databasePath,
  setupCompleted: settings.setupCompleted,
  nodeEnv: process.env.NODE_ENV ?? 'development'
});

cleanupExpiredSessions(db);
const cleanup = setInterval(() => {
  try {
    cleanupExpiredSessions(db);
  } catch (error) {
    logger.error('session_cleanup_failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}, 60 * 60 * 1000);
cleanup.unref();
startHolidayScheduler(db);

const server = app.listen(port, () => {
  logger.info('server_listening', { port });
});

function shutdown(signal: string) {
  logger.info('server_stopping', { signal });
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
