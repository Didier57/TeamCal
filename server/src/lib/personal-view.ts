import type { DB } from '../db';
import { newId, nowIso } from './util';

const PERSONAL_VIEW_NAMES: Record<string, string> = {
  fr: 'Mon Planning',
  en: 'My Planning',
  de: 'Meine Planung'
};

export function defaultPersonalViewName(language: string | null | undefined): string {
  return PERSONAL_VIEW_NAMES[language ?? 'fr'] ?? PERSONAL_VIEW_NAMES.fr;
}

export function createDefaultPersonalView(db: DB, userId: string, language: string): string {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO custom_views (id, name, owner_id, is_shared, is_default_personal, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, ?)`
  ).run(id, defaultPersonalViewName(language), userId, now, now);
  db.prepare('INSERT OR IGNORE INTO custom_view_users (view_id, user_id) VALUES (?, ?)').run(id, userId);
  return id;
}

export function renameDefaultPersonalView(db: DB, userId: string, language: string): void {
  const view = db
    .prepare('SELECT id, name FROM custom_views WHERE owner_id = ? AND is_default_personal = 1')
    .get(userId) as { id: string; name: string } | undefined;
  if (!view) return;
  if (!Object.values(PERSONAL_VIEW_NAMES).includes(view.name)) return;
  const name = defaultPersonalViewName(language);
  if (name === view.name) return;
  db.prepare('UPDATE custom_views SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    nowIso(),
    view.id
  );
}
