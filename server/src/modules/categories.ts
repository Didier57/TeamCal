import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso } from '../lib/util';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/)
});

export function categoryRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = req.db
        .prepare('SELECT id, name, color FROM categories ORDER BY name COLLATE NOCASE')
        .all();
      res.json(rows);
    })
  );

  router.post(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = schema.parse(req.body);
      const id = newId();
      const now = nowIso();
      req.db
        .prepare('INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, body.name, body.color, now, now);
      audit(req.db, {
        userId: req.user!.id,
        action: 'category.created',
        entity: 'category',
        entityId: id,
        details: body,
        ip: req.ip
      });
      res.status(201).json({ id, name: body.name, color: body.color });
    })
  );

  router.patch(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = schema.parse(req.body);
      const existing = req.db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
      if (!existing) throw new HttpError(404, 'category_not_found');
      req.db
        .prepare('UPDATE categories SET name = ?, color = ?, updated_at = ? WHERE id = ?')
        .run(body.name, body.color, nowIso(), req.params.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'category.updated',
        entity: 'category',
        entityId: req.params.id,
        details: body,
        ip: req.ip
      });
      res.json({ id: req.params.id, name: body.name, color: body.color });
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
