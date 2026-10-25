import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type UserRow } from '../lib/auth';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso } from '../lib/util';

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  userIds: z.array(z.string()).max(200).default([]),
  isShared: z.boolean().optional().default(false)
});

export function viewRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  function viewApi(rows: any[], db: any) {
    return rows.map((v) => {
      const userIds = (
        db.prepare('SELECT user_id FROM custom_view_users WHERE view_id = ?').all(v.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      return {
        id: v.id,
        name: v.name,
        ownerId: v.owner_id,
        ownerName: v.owner_name,
        isShared: Boolean(v.is_shared),
        isDefaultPersonal: Boolean(v.is_default_personal),
        userIds,
        createdAt: v.created_at
      };
    });
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const rows = req.db
        .prepare(
          `SELECT v.*, (u.first_name || ' ' || u.last_name) AS owner_name
           FROM custom_views v JOIN users u ON u.id = v.owner_id
           WHERE v.owner_id = ?
              OR v.is_shared = 1
              OR (? = 1 AND v.is_default_personal = 0)
           ORDER BY v.name COLLATE NOCASE`
        )
        .all(user.id, user.is_admin ? 1 : 0);
      res.json(viewApi(rows, req.db));
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = schema.parse(req.body);
      const id = newId();
      const now = nowIso();
      const check = req.db.prepare('SELECT 1 FROM users WHERE id = ?');
      req.db.transaction(() => {
        req.db
          .prepare(
            'INSERT INTO custom_views (id, name, owner_id, is_shared, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(id, body.name, req.user!.id, body.isShared ? 1 : 0, now, now);
        const insert = req.db.prepare(
          'INSERT OR IGNORE INTO custom_view_users (view_id, user_id) VALUES (?, ?)'
        );
        for (const userId of body.userIds) {
          if (check.get(userId)) insert.run(id, userId);
        }
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'view.created',
        entity: 'custom_view',
        entityId: id,
        details: { name: body.name },
        ip: req.ip
      });
      res.status(201).json({ id, name: body.name, ownerId: req.user!.id, isShared: body.isShared, userIds: body.userIds });
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const body = schema.parse(req.body);
      const view = req.db.prepare('SELECT * FROM custom_views WHERE id = ?').get(req.params.id) as
        | { id: string; owner_id: string; name: string; is_shared: number }
        | undefined;
      if (!view) throw new HttpError(404, 'view_not_found');
      if (view.owner_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, 'forbidden');
      const check = req.db.prepare('SELECT 1 FROM users WHERE id = ?');
      req.db.transaction(() => {
        req.db
          .prepare('UPDATE custom_views SET name = ?, is_shared = ?, updated_at = ? WHERE id = ?')
          .run(body.name, body.isShared ? 1 : 0, nowIso(), view.id);
        req.db.prepare('DELETE FROM custom_view_users WHERE view_id = ?').run(view.id);
        const insert = req.db.prepare(
          'INSERT OR IGNORE INTO custom_view_users (view_id, user_id) VALUES (?, ?)'
        );
        for (const userId of body.userIds) {
          if (check.get(userId)) insert.run(view.id, userId);
        }
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'view.updated',
        entity: 'custom_view',
        entityId: view.id,
        details: { name: body.name },
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const view = req.db.prepare('SELECT * FROM custom_views WHERE id = ?').get(req.params.id) as
        | { id: string; owner_id: string }
        | undefined;
      if (!view) throw new HttpError(404, 'view_not_found');
      if (view.owner_id !== req.user!.id && !req.user!.is_admin) throw new HttpError(403, 'forbidden');
      req.db.prepare('DELETE FROM custom_views WHERE id = ?').run(view.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'view.deleted',
        entity: 'custom_view',
        entityId: view.id,
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
