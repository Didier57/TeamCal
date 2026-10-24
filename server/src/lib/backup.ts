import SMB2 from 'v9u-smb2';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { DB } from '../db';
import { runMigrations } from '../db';
import type { AppSettings, BackupSettings } from '../settings';
import { SettingsStore } from '../settings';
import { logger } from './logger';
import { zonedParts } from './time';

const BACKUP_NAME = /^teamcal_\d{4}-\d{2}-\d{2}_\d{6}\.sqlite$/;
const TABLE_NAMES = [
  'users',
  'settings',
  'categories',
  'calendars',
  'calendar_acl',
  'events',
  'event_participants',
  'event_exceptions',
  'custom_views',
  'custom_view_users',
  'audit_log',
  'email_log',
  'holiday_adjustments'
];

export interface BackupFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface BackupResult {
  file: string;
  size: number;
  deleted: string[];
}

interface SmbStats {
  name: string;
  size?: number;
  mtime: Date;
  isDirectory(): boolean;
}

let operationQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(task, task);
  operationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^\\+/, '').replace(/\\+$/, '');
}

function normalizeShare(value: string): string {
  return value.trim().replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
}

function normalizeFolder(value: string): string {
  const parts = value.trim().split(/[\\/]+/).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('invalid_backup_folder');
  }
  return parts.join('\\');
}

function timestamp(settings: AppSettings): string {
  const parts = zonedParts(new Date(), settings.defaultTimezone || 'UTC');
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}_${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
}

function assertConfigured(backup: BackupSettings) {
  if (!normalizeHost(backup.host) || !normalizeShare(backup.share)) {
    throw new Error('backup_not_configured');
  }
}

function createClient(backup: BackupSettings): SMB2 {
  assertConfigured(backup);
  return new SMB2({
    share: `\\\\${normalizeHost(backup.host)}\\${normalizeShare(backup.share)}`,
    username: backup.username,
    domain: backup.domain,
    password: backup.password,
    autoCloseTimeout: 0
  });
}

async function withClient<T>(
  backup: BackupSettings,
  work: (client: SMB2) => Promise<T>,
  timeoutMs = 30000
): Promise<T> {
  const client = createClient(backup);
  const socket = (client as unknown as { socket?: import('node:net').Socket }).socket;
  const timer = setTimeout(() => {
    socket?.destroy(new Error('smb_timeout'));
  }, timeoutMs);
  timer.unref();
  try {
    return await work(client);
  } finally {
    clearTimeout(timer);
    try {
      client.disconnect();
    } catch {
      // The socket may already be closed after a failed request.
    }
  }
}

async function ensureFolder(client: SMB2, folder: string) {
  if (!folder) return;
  let current = '';
  for (const part of folder.split('\\')) {
    current = current ? `${current}\\${part}` : part;
    if (!(await client.exists(current))) {
      await client.mkdir(current);
    }
  }
}

function remotePath(folder: string, name: string): string {
  return folder ? `${folder}\\${name}` : name;
}

async function readRemoteFiles(client: SMB2, folder: string): Promise<BackupFile[]> {
  if (folder && !(await client.exists(folder))) return [];
  const entries = (await client.readdir(folder, { stats: true })) as unknown as SmbStats[];
  return entries
    .filter((entry) => !entry.isDirectory() && BACKUP_NAME.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      size: Number(entry.size ?? 0),
      modifiedAt: entry.mtime.toISOString()
    }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function tempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'teamcal-backup-'));
}

async function cleanup(dir: string) {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function createDatabaseSnapshot(db: DB): Promise<{ file: string; dir: string }> {
  const dir = await tempDir();
  const file = path.join(dir, 'teamcal.sqlite');
  try {
    await db.backup(file);
    return { file, dir };
  } catch (error) {
    await cleanup(dir);
    throw error;
  }
}

function tableColumns(db: DB, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]
  ).map((column) => column.name);
}

function validateImportedDatabase(db: DB, file: string) {
  let imported: DB | null = null;
  try {
    imported = new Database(file, { fileMustExist: true });
    const tables = new Set(
      (
        imported
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name)
    );
    if (!tables.has('users') || !tables.has('schema_migrations')) {
      throw new Error('backup_invalid');
    }
    const integrity = imported.prepare('PRAGMA integrity_check').all() as {
      integrity_check: string;
    }[];
    if (!integrity.length || integrity.some((row) => row.integrity_check !== 'ok')) {
      throw new Error('backup_invalid');
    }
    const userCount = (
      imported.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
    ).count;
    if (userCount < 1) throw new Error('backup_invalid');

    runMigrations(imported);

    const migratedTables = new Set(
      (
        imported
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name)
    );
    for (const table of TABLE_NAMES) {
      if (!migratedTables.has(table)) throw new Error('backup_incompatible');
      const importedColumns = new Set(tableColumns(imported, table));
      const missing = tableColumns(db, table).filter((column) => !importedColumns.has(column));
      if (missing.length) throw new Error('backup_incompatible');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'backup_invalid' || error.message === 'backup_incompatible')
    ) {
      throw error;
    }
    throw new Error('backup_invalid');
  } finally {
    imported?.close();
  }
}

export function restoreLocalDatabase(db: DB, file: string): Promise<void> {
  return enqueue(() => restoreDatabase(db, file));
}

export async function restoreDatabase(db: DB, file: string): Promise<void> {
  validateImportedDatabase(db, file);

  db.prepare('ATTACH DATABASE ? AS restore').run(file);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const table of TABLE_NAMES) {
        const columns = tableColumns(db, table);
        const columnList = columns.map(quote).join(', ');
        db.prepare(`DELETE FROM main.${quote(table)}`).run();
        db.prepare(
          `INSERT INTO main.${quote(table)} (${columnList}) SELECT ${columnList} FROM restore.${quote(table)}`
        ).run();
      }
      const violations = db.prepare('PRAGMA foreign_key_check').all();
      if (violations.length) throw new Error('backup_foreign_key_error');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
    db.exec('DETACH DATABASE restore');
  }
}

export async function exportDatabase(db: DB): Promise<{ file: string; dir: string; name: string }> {
  const settings = new SettingsStore(db).get();
  const snapshot = await createDatabaseSnapshot(db);
  return {
    ...snapshot,
    name: `teamcal_${timestamp(settings)}.sqlite`
  };
}

export async function testSmbConnection(
  backup: BackupSettings
): Promise<{ ok: true; folderExists: boolean }> {
  assertConfigured(backup);
  const folder = normalizeFolder(backup.folder);
  return withClient(
    backup,
    async (client) => {
      await client.readdir('');
      const folderExists = folder ? await client.exists(folder) : true;
      return { ok: true, folderExists };
    },
    12000
  );
}

export async function listSmbBackups(backup: BackupSettings): Promise<BackupFile[]> {
  assertConfigured(backup);
  const folder = normalizeFolder(backup.folder);
  return withClient(backup, (client) => readRemoteFiles(client, folder), 20000);
}

async function performBackup(db: DB, settings: AppSettings): Promise<BackupResult> {
  const backup = settings.backup;
  assertConfigured(backup);
  const folder = normalizeFolder(backup.folder);
  const snapshot = await createDatabaseSnapshot(db);
  try {
    return await withClient(backup, async (client) => {
      await ensureFolder(client, folder);
      const name = `teamcal_${timestamp(settings)}.sqlite`;
      const target = remotePath(folder, name);
      const size = (await fsp.stat(snapshot.file)).size;
      const writable = await client.createWriteStream(target);
      await pipeline(fs.createReadStream(snapshot.file), writable);
      const files = await readRemoteFiles(client, folder);
      const extra = files.slice(Math.max(1, backup.keep));
      for (const file of extra) {
        await client.unlink(remotePath(folder, file.name));
      }
      return { file: name, size, deleted: extra.map((file) => file.name) };
    }, 120000);
  } finally {
    await cleanup(snapshot.dir);
  }
}

export function runBackupNow(db: DB, settings: AppSettings): Promise<BackupResult> {
  return enqueue(() => performBackup(db, settings));
}

export function restoreSmbBackup(
  db: DB,
  settings: AppSettings,
  name: string
): Promise<void> {
  if (!BACKUP_NAME.test(name)) throw new Error('invalid_backup_name');
  return enqueue(async () => {
    const backup = settings.backup;
    assertConfigured(backup);
    const folder = normalizeFolder(backup.folder);
    const dir = await tempDir();
    try {
      const local = path.join(dir, 'restore.sqlite');
      await withClient(
        backup,
        async (client) => {
          const readable = await client.createReadStream(remotePath(folder, name));
          await pipeline(readable, fs.createWriteStream(local));
        },
        120000
      );
      await restoreDatabase(db, local);
    } finally {
      await cleanup(dir);
    }
  });
}

export function deleteSmbBackup(
  db: DB,
  settings: AppSettings,
  name: string
): Promise<void> {
  if (!BACKUP_NAME.test(name)) throw new Error('invalid_backup_name');
  return enqueue(async () => {
    const backup = settings.backup;
    assertConfigured(backup);
    const folder = normalizeFolder(backup.folder);
    await withClient(backup, (client) => client.unlink(remotePath(folder, name)));
  });
}

function scheduleParts(settings: AppSettings) {
  const parts = zonedParts(new Date(), settings.defaultTimezone || 'UTC');
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const time = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { date, time, day };
}

export function startBackupScheduler(db: DB) {
  let lastAttempt: string | null = null;

  const tick = async () => {
    try {
      const settings = new SettingsStore(db).get();
      const backup = settings.backup;
      if (!backup.enabled || !backup.host || !backup.share) return;
      const current = scheduleParts(settings);
      const key = `${current.date} ${current.time}`;
      if (lastAttempt === key) return;
      if (backup.time !== current.time) return;
      if (backup.day !== 'all' && backup.day !== current.day) return;
      lastAttempt = key;
      const result = await runBackupNow(db, settings);
      logger.info('backup_completed', {
        file: result.file,
        size: result.size,
        deleted: result.deleted.length
      });
    } catch (error) {
      logger.error('backup_failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const initial = setTimeout(() => void tick(), 5000);
  initial.unref();
  const timer = setInterval(() => void tick(), 30000);
  timer.unref();
}
