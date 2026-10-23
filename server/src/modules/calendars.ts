import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, type UserRow } from '../lib/auth';
import { calendarAccess, getCalendar } from '../lib/permissions';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, nowIso } from '../lib/util';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
});

const aclSchema = z.object({
  entries: z
    .array(
      z.object({
        userId: z.string().min(1),
        canView: z.boolean(),
        canCreate: z.boolean(),
        canEdit: z.boolean(),
        canDelete: z.boolean()
      })
    )
    .max(500)
});

export function calendarRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const rows = req.db
        .prepare(
          `SELECT c.*, u.username, u.first_name, u.last_name, u.is_active
           FROM calendars c JOIN users u ON u.id = c.owner_id
           ORDER BY u.first_name, u.last_name, u.username`
        )
        .all() as {
        id: string;
        owner_id: string;
        name: string;
        color: string;
        created_at: string;
        username: string;
        first_name: string;
        last_name: string;
        is_active: number;
      }[];
      const result = [];
      for (const row of rows) {
        const access = calendarAccess(req.db, user, row.id);
        if (!access || (!access.canView && !user.is_admin)) continue;
        result.push({
          id: row.id,
          ownerId: row.owner_id,
          ownerUsername: row.username,
          ownerName: `${row.first_name} ${row.last_name}`.trim() || row.username,
          ownerActive: Boolean(row.is_active),
          name: row.name,
          color: row.color,
          isOwner: access.isOwner,
          canView: access.canView,
          canCreate: access.canCreate,
          canEdit: access.canEdit,
          canDelete: access.canDelete
        });
      }
      res.json(result);
    })
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const access = calendarAccess(req.db, req.user!, req.params.id);
      if (!access) throw new HttpError(404, 'calendar_not_found');
      if (!access.isOwner && !req.user!.is_admin) throw new HttpError(403, 'forbidden');
      const body = updateSchema.parse(req.body);
      const calendar = access.calendar;
      req.db
        .prepare('UPDATE calendars SET name = ?, color = ? WHERE id = ?')
        .run(body.name ?? calendar.name, body.color ?? calendar.color, calendar.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'calendar.updated',
        entity: 'calendar',
        entityId: calendar.id,
        details: body,
        ip: req.ip
      });
      res.json({ ...calendar, ...body });
    })
  );

  router.get(
    '/:id/acl',
    asyncHandler(async (req, res) => {
      const access = calendarAccess(req.db, req.user!, req.params.id);
      if (!access) throw new HttpError(404, 'calendar_not_found');
      if (!access.isOwner && !req.user!.is_admin) throw new HttpError(403, 'forbidden');
      const rows = req.db
        .prepare(
          `SELECT a.user_id, a.can_view, a.can_create, a.can_edit, a.can_delete,
                  u.username, u.first_name, u.last_name, u.is_active
           FROM calendar_acl a JOIN users u ON u.id = a.user_id
           WHERE a.calendar_id = ?
           ORDER BY u.first_name, u.last_name, u.username`
        )
        .all(req.params.id) as {
        user_id: string;
        can_view: number;
        can_create: number;
        can_edit: number;
        can_delete: number;
        username: string;
        first_name: string;
        last_name: string;
        is_active: number;
      }[];
      res.json(
        rows.map((r) => ({
          userId: r.user_id,
          username: r.username,
          name: `${r.first_name} ${r.last_name}`.trim() || r.username,
          isActive: Boolean(r.is_active),
          canView: Boolean(r.can_view),
          canCreate: Boolean(r.can_create),
          canEdit: Boolean(r.can_edit),
          canDelete: Boolean(r.can_delete)
        }))
      );
    })
  );

  router.put(
    '/:id/acl',
    asyncHandler(async (req, res) => {
      const access = calendarAccess(req.db, req.user!, req.params.id);
      if (!access) throw new HttpError(404, 'calendar_not_found');
      if (!access.isOwner && !req.user!.is_admin) throw new HttpError(403, 'forbidden');
      const body = aclSchema.parse(req.body);
      const calendar = access.calendar;
      const deleteStmt = req.db.prepare('DELETE FROM calendar_acl WHERE calendar_id = ?');
      const insert = req.db.prepare(
        `INSERT INTO calendar_acl (calendar_id, user_id, can_view, can_create, can_edit, can_delete)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const checkUser = req.db.prepare('SELECT 1 FROM users WHERE id = ?');
      req.db.transaction(() => {
        deleteStmt.run(calendar.id);
        for (const entry of body.entries) {
          if (entry.userId === calendar.owner_id) continue;
          if (!checkUser.get(entry.userId)) throw new HttpError(400, 'user_not_found');
          const canView = entry.canView || entry.canCreate || entry.canEdit || entry.canDelete;
          insert.run(
            calendar.id,
            entry.userId,
            canView ? 1 : 0,
            entry.canCreate ? 1 : 0,
            entry.canEdit ? 1 : 0,
            entry.canDelete ? 1 : 0
          );
        }
        req.db.prepare('UPDATE calendars SET name = ? WHERE id = ?').run(calendar.name, calendar.id);
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'calendar.acl_updated',
        entity: 'calendar',
        entityId: calendar.id,
        details: body,
        ip: req.ip
      });
      res.json({ ok: true, updatedAt: nowIso() });
    })
  );

  return router;
}
