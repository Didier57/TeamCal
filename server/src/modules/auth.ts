import { Router } from 'express';
import { z } from 'zod';
import {
  checkLoginRate,
  createSession,
  csrfMiddleware,
  destroySession,
  publicUser,
  recordLoginFailure,
  recordLoginSuccess,
  requireAuth,
  type UserRow
} from '../lib/auth';
import { hashPassword, passwordIssues, verifyPassword } from '../lib/password';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, nowIso } from '../lib/util';
import { SettingsStore } from '../settings';
import { isValidTimeZone } from '../lib/time';

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(false)
});

const preferencesSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  language: z.enum(['fr', 'en', 'de']).optional(),
  timezone: z.string().max(80).nullable().optional(),
  dateFormat: z.string().max(30).nullable().optional(),
  timeFormat: z.enum(['12', '24']).nullable().optional(),
  defaultView: z.enum(['day', 'week', 'month']).optional(),
  theme: z.enum(['light', 'dark']).nullable().optional()
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200)
});

export function authRoutes(): Router {
  const router = Router();

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const store = new SettingsStore(req.db);
      res.json({
        user: req.user ? publicUser(req.user) : null,
        csrfToken: req.sessionRow?.csrf_token ?? null,
        settings: store.publicView(),
        needsSetup: !store.get().setupCompleted
      });
    })
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const store = new SettingsStore(req.db);
      const settings = store.get();
      if (!settings.setupCompleted) throw new HttpError(409, 'setup_required');
      const ip = req.ip ?? 'unknown';
      checkLoginRate(ip);
      const body = loginSchema.parse(req.body);
      const user = req.db
        .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
        .get(body.username) as UserRow | undefined;
      const ok = user ? await verifyPassword(body.password, user.password_hash) : false;
      if (!user || !ok) {
        recordLoginFailure(ip);
        audit(req.db, {
          action: 'auth.login_failed',
          entity: 'user',
          entityId: user?.id,
          details: { username: body.username },
          ip
        });
        throw new HttpError(401, 'invalid_credentials');
      }
      if (!user.is_active) throw new HttpError(403, 'account_disabled');
      recordLoginSuccess(ip);
      const duration = body.remember ? Math.max(30, settings.sessionDurationDays) : 1;
      const session = createSession(req, res, user.id, duration);
      req.db
        .prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
        .run(nowIso(), nowIso(), user.id);
      audit(req.db, { userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip });
      res.json({
        user: publicUser(user),
        csrfToken: session.csrf_token,
        settings: store.publicView()
      });
    })
  );

  router.post(
    '/logout',
    requireAuth,
    csrfMiddleware,
    asyncHandler(async (req, res) => {
      audit(req.db, {
        userId: req.user!.id,
        action: 'auth.logout',
        entity: 'user',
        entityId: req.user!.id,
        ip: req.ip
      });
      destroySession(req, res);
      res.json({ ok: true });
    })
  );

  router.put(
    '/me/preferences',
    requireAuth,
    csrfMiddleware,
    asyncHandler(async (req, res) => {
      const body = preferencesSchema.parse(req.body);
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      const current = req.user!;
      req.db
        .prepare(
          `UPDATE users SET first_name = ?, last_name = ?, email = ?, language = ?, timezone = ?,
             date_format = ?, time_format = ?, default_view = ?, theme = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          body.firstName ?? current.first_name,
          body.lastName ?? current.last_name,
          body.email ?? current.email,
          body.language ?? current.language,
          body.timezone !== undefined ? body.timezone : current.timezone,
          body.dateFormat !== undefined ? body.dateFormat : current.date_format,
          body.timeFormat !== undefined ? body.timeFormat : current.time_format,
          body.defaultView ?? current.default_view,
          body.theme !== undefined ? body.theme : current.theme,
          nowIso(),
          current.id
        );
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(current.id) as UserRow;
      res.json({ user: publicUser(user) });
    })
  );

  router.post(
    '/me/password',
    requireAuth,
    csrfMiddleware,
    asyncHandler(async (req, res) => {
      const body = passwordSchema.parse(req.body);
      const issue = passwordIssues(body.newPassword);
      if (issue) throw new HttpError(400, issue);
      const ok = await verifyPassword(body.currentPassword, req.user!.password_hash);
      if (!ok) throw new HttpError(400, 'current_password_invalid');
      const hash = await hashPassword(body.newPassword);
      req.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hash, nowIso(), req.user!.id);
      req.db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
        .run(req.user!.id, req.sessionRow!.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'auth.password_changed',
        entity: 'user',
        entityId: req.user!.id,
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
