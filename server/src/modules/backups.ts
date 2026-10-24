import express, { Router } from 'express';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireAdmin, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import {
  deleteSmbBackup,
  exportDatabase,
  listSmbBackups,
  restoreLocalDatabase,
  restoreSmbBackup,
  runBackupNow,
  testSmbConnection
} from '../lib/backup';
import { asyncHandler, HttpError } from '../lib/util';
import { SettingsStore } from '../settings';

const UPLOAD_LIMIT = '500mb';
const CLIENT_ERRORS = new Set([
  'backup_not_configured',
  'backup_invalid',
  'backup_incompatible',
  'backup_foreign_key_error',
  'invalid_backup_name',
  'invalid_backup_folder'
]);

function backupHttpError(error: unknown): HttpError {
  const message = error instanceof Error ? error.message : 'smb_error';
  if (message === 'backup_empty') return new HttpError(400, 'backup_empty');
  if (message === 'smb_timeout') return new HttpError(504, 'smb_timeout');
  if (CLIENT_ERRORS.has(message)) {
    return new HttpError(400, message);
  }
  return new HttpError(502, 'smb_error', undefined, {
    message: message.slice(0, 300)
  });
}

export function backupRoutes(): Router {
  const router = Router();
  const raw = express.raw({
    type: ['application/octet-stream', 'application/x-sqlite3', 'application/vnd.sqlite3'],
    limit: UPLOAD_LIMIT
  });

  router.get(
    '/export',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const snapshot = await exportDatabase(req.db);
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="${snapshot.name}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(snapshot.file, (error: NodeJS.ErrnoException | null) => {
        void fsp.rm(snapshot.dir, { recursive: true, force: true }).catch(() => undefined);
        if (error && !res.headersSent) {
          res.status(500).json({ error: 'backup_export_failed' });
        }
      });
    })
  );

  router.post(
    '/import',
    raw,
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, 'backup_empty');
      }
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamcal-import-'));
      const file = path.join(dir, 'import.sqlite');
      try {
        await fsp.writeFile(file, req.body);
        await restoreLocalDatabase(req.db, file);
      } catch (error) {
        throw backupHttpError(error);
      } finally {
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
      audit(req.db, {
        userId: req.user!.id,
        action: 'backup.restored',
        entity: 'settings',
        details: { source: 'upload', size: req.body.length },
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  router.get(
    '/smb',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      try {
        const files = await listSmbBackups(settings.backup);
        res.json({ files });
      } catch (error) {
        throw backupHttpError(error);
      }
    })
  );

  router.post(
    '/smb/test',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      try {
        res.json(await testSmbConnection(settings.backup));
      } catch (error) {
        throw backupHttpError(error);
      }
    })
  );

  router.post(
    '/smb/run',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      try {
        const result = await runBackupNow(req.db, settings);
        audit(req.db, {
          userId: req.user!.id,
          action: 'backup.created',
          entity: 'settings',
          details: { file: result.file, size: result.size, deleted: result.deleted.length },
          ip: req.ip
        });
        res.status(201).json(result);
      } catch (error) {
        throw backupHttpError(error);
      }
    })
  );

  router.post(
    '/smb/:name/restore',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      try {
        await restoreSmbBackup(req.db, settings, req.params.name);
      } catch (error) {
        throw backupHttpError(error);
      }
      audit(req.db, {
        userId: req.user!.id,
        action: 'backup.restored',
        entity: 'settings',
        details: { source: 'smb', file: req.params.name },
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  router.delete(
    '/smb/password',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const store = new SettingsStore(req.db);
      store.set({ backup: { password: '' } });
      audit(req.db, {
        userId: req.user!.id,
        action: 'backup.password_cleared',
        entity: 'settings',
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  router.delete(
    '/smb/:name',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      try {
        await deleteSmbBackup(req.db, settings, req.params.name);
      } catch (error) {
        throw backupHttpError(error);
      }
      audit(req.db, {
        userId: req.user!.id,
        action: 'backup.deleted',
        entity: 'settings',
        details: { file: req.params.name },
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
