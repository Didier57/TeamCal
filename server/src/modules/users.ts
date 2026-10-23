import { Router } from 'express';
import { z } from 'zod';
import { publicUser, requireAdmin, requireAuth, type UserRow } from '../lib/auth';
import { hashPassword, passwordIssues } from '../lib/password';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso } from '../lib/util';
import { isValidTimeZone } from '../lib/time';

const createSchema = z.object({
  username: z.string().trim().min(3).max(50),
  email: z.string().trim().email().max(200),
  firstName: z.string().trim().max(80).default(''),
  lastName: z.string().trim().max(80).default(''),
  password: z.string().min(8).max(200),
  isAdmin: z.boolean().optional().default(false),
  language: z.enum(['fr', 'en', 'de']).optional().default('fr'),
  timezone: z.string().max(80).optional()
});

const updateSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  language: z.enum(['fr', 'en', 'de']).optional(),
  timezone: z.string().max(80).nullable().optional(),
  defaultView: z.enum(['day', 'week', 'month']).optional()
});

const passwordSchema = z.object({ newPassword: z.string().min(8).max(200) });

export function userRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = req.db
        .prepare(
          `SELECT id, username, email, first_name, last_name, is_admin, is_active, language, timezone, default_view, created_at
           FROM users ORDER BY first_name, last_name, username`
        )
        .all() as UserRow[];
      const isAdmin = Boolean(req.user!.is_admin);
      res.json(
        rows.map((u) => ({
          id: u.id,
          username: u.username,
          firstName: u.first_name,
          lastName: u.last_name,
          isAdmin: Boolean(u.is_admin),
          isActive: Boolean(u.is_active),
          language: u.language,
          timezone: u.timezone,
          defaultView: u.default_view,
          ...(isAdmin ? { email: u.email, createdAt: u.created_at } : {})
        }))
      );
    })
  );

  router.post(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = createSchema.parse(req.body);
      const issue = passwordIssues(body.password);
      if (issue) throw new HttpError(400, issue);
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      const exists = req.db
        .prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
        .get(body.username);
      if (exists) throw new HttpError(409, 'username_taken');
      const id = newId();
      const now = nowIso();
      const hash = await hashPassword(body.password);
      const color = ['#2f6feb', '#1f9d55', '#b45309', '#9333ea', '#dc2626', '#0891b2'][
        Math.floor(Math.random() * 6)
      ];
      req.db.transaction(() => {
        req.db
          .prepare(
            `INSERT INTO users (id, username, email, first_name, last_name, password_hash, is_admin, is_active, language, timezone, default_view, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'week', ?, ?)`
          )
          .run(
            id,
            body.username,
            body.email,
            body.firstName,
            body.lastName,
            hash,
            body.isAdmin ? 1 : 0,
            body.language,
            body.timezone ?? null,
            now,
            now
          );
        req.db
          .prepare('INSERT INTO calendars (id, owner_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId(), id, body.username, color, now);
      })();
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.created',
        entity: 'user',
        entityId: id,
        details: { username: body.username },
        ip: req.ip
      });
      res.status(201).json(publicUser(user));
    })
  );

  router.patch(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = updateSchema.parse(req.body);
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      const target = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
        | UserRow
        | undefined;
      if (!target) throw new HttpError(404, 'user_not_found');
      if (target.id === req.user!.id && body.isActive === false) {
        throw new HttpError(400, 'cannot_disable_self');
      }
      if (target.id === req.user!.id && body.isAdmin === false) {
        const admins = req.db
          .prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND is_active = 1')
          .get() as { count: number };
        if (admins.count <= 1) throw new HttpError(400, 'last_admin');
      }
      req.db
        .prepare(
          `UPDATE users SET email = ?, first_name = ?, last_name = ?, is_admin = ?, is_active = ?,
             language = ?, timezone = ?, default_view = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          body.email ?? target.email,
          body.firstName ?? target.first_name,
          body.lastName ?? target.last_name,
          body.isAdmin === undefined ? target.is_admin : body.isAdmin ? 1 : 0,
          body.isActive === undefined ? target.is_active : body.isActive ? 1 : 0,
          body.language ?? target.language,
          body.timezone !== undefined ? body.timezone : target.timezone,
          body.defaultView ?? target.default_view,
          nowIso(),
          target.id
        );
      if (body.isActive === false) {
        req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.updated',
        entity: 'user',
        entityId: target.id,
        details: body,
        ip: req.ip
      });
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(target.id) as UserRow;
      res.json(publicUser(user));
    })
  );

  router.post(
    '/:id/password',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = passwordSchema.parse(req.body);
      const issue = passwordIssues(body.newPassword);
      if (issue) throw new HttpError(400, issue);
      const target = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
        | UserRow
        | undefined;
      if (!target) throw new HttpError(404, 'user_not_found');
      const hash = await hashPassword(body.newPassword);
      req.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hash, nowIso(), target.id);
      req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.password_reset',
        entity: 'user',
        entityId: target.id,
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  router.delete(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
        | UserRow
        | undefined;
      if (!target) throw new HttpError(404, 'user_not_found');
      if (target.id === req.user!.id) throw new HttpError(400, 'cannot_disable_self');
      req.db
        .prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?')
        .run(nowIso(), target.id);
      req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.disabled',
        entity: 'user',
        entityId: target.id,
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
