import type { DB } from '../db';
import { newId, nowIso } from './util';

export function audit(
  db: DB,
  entry: {
    userId?: string | null;
    action: string;
    entity?: string;
    entityId?: string;
    details?: unknown;
    ip?: string | null;
  }
) {
  db.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity, entity_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    entry.userId ?? null,
    entry.action,
    entry.entity ?? null,
    entry.entityId ?? null,
    entry.details === undefined ? null : JSON.stringify(entry.details),
    entry.ip ?? null,
    nowIso()
  );
}
