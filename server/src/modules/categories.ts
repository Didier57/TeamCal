import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { requireAdmin, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso } from '../lib/util';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  isHoliday: z.boolean().optional()
});

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  is_holiday: number;
}

function toApi(row: CategoryRow) {
  return { id: row.id, name: row.name, color: row.color, isHoliday: Boolean(row.is_holiday) };
}

function singleHolidayCategory(db: DB, id: string) {
  db.prepare('UPDATE categories SET is_holiday = 0 WHERE id <> ?').run(id);
}

export function categoryRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = req.db
        .prepare(
          'SELECT id, name, color, is_holiday FROM categories ORDER BY name COLLATE NOCASE'
        )
        .all() as CategoryRow[];
      res.json(rows.map(toApi));
    })
  );

  router.post(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = schema.parse(req.body);
      const id = newId();
      const now = nowIso();
      const isHoliday = body.isHoliday ? 1 : 0;
      req.db.transaction(() => {
        req.db
          .prepare(
            'INSERT INTO categories (id, name, color, is_holiday, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(id, body.name, body.color, isHoliday, now, now);
        if (isHoliday) singleHolidayCategory(req.db, id);
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'category.created',
        entity: 'category',
        entityId: id,
        details: { ...body, isHoliday: Boolean(isHoliday) },
        ip: req.ip
      });
      res.status(201).json({ id, name: body.name, color: body.color, isHoliday: Boolean(isHoliday) });
    })
  );

  router.patch(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = schema.parse(req.body);
      const existing = req.db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(req.params.id) as CategoryRow | undefined;
      if (!existing) throw new HttpError(404, 'category_not_found');
      const isHoliday = body.isHoliday === undefined ? existing.is_holiday : body.isHoliday ? 1 : 0;
      req.db.transaction(() => {
        req.db
          .prepare(
            'UPDATE categories SET name = ?, color = ?, is_holiday = ?, updated_at = ? WHERE id = ?'
          )
          .run(body.name, body.color, isHoliday, nowIso(), req.params.id);
        if (isHoliday) singleHolidayCategory(req.db, req.params.id);
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'category.updated',
        entity: 'category',
        entityId: req.params.id,
        details: { ...body, isHoliday: Boolean(isHoliday) },
        ip: req.ip
      });
      res.json({
        id: req.params.id,
        name: body.name,
        color: body.color,
        isHoliday: Boolean(isHoliday)
      });
    })
  );

  router.delete(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const existing = req.db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
      if (!existing) throw new HttpError(404, 'category_not_found');
      req.db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'category.deleted',
        entity: 'category',
        entityId: req.params.id,
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
