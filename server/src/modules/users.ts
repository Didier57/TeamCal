import { Router } from 'express';
import { z } from 'zod';
import { publicUser, requireAdmin, requireAuth, type UserRow } from '../lib/auth';
import { hashPassword, passwordIssues } from '../lib/password';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso, randomToken, accountTokenExpiry } from '../lib/util';
import { isValidTimeZone } from '../lib/time';
import { isCountryCode } from '../lib/countries';
import { SettingsStore, type AppSettings } from '../settings';
import { syncHolidays } from '../lib/holidays';
import { sendAccountEmail } from '../lib/mailer';
import { createDefaultPersonalView, renameDefaultPersonalView } from '../lib/personal-view';

const createSchema = z.object({
  username: z.string().trim().min(3).max(50),
  email: z.string().trim().email().max(200),
  firstName: z.string().trim().max(80).default(''),
  lastName: z.string().trim().max(80).default(''),
  password: z.string().min(8).max(200).optional(),
  isAdmin: z.boolean().optional().default(false),
  language: z.enum(['fr', 'en', 'de']).optional().default('fr'),
  timezone: z.string().max(80).optional(),
  country: z.string().trim().length(2).optional()
});

const updateSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  isAdmin: z.boolean().optional(),
  isActive: z.boolean().optional(),
  language: z.enum(['fr', 'en', 'de']).optional(),
  timezone: z.string().max(80).nullable().optional(),
  country: z.string().trim().length(2).nullable().optional(),
  defaultView: z.enum(['day', 'week', 'month']).optional()
});

function appBaseUrl(req: { protocol: string; get(header: string): string | undefined }, settings: AppSettings) {
  return (settings.baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function accountUrl(req: { protocol: string; get(header: string): string | undefined }, settings: AppSettings, token: string) {
  return `${appBaseUrl(req, settings)}/reset-password?token=${encodeURIComponent(token)}`;
}

export function userRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const me = req.user!;
      const isAdmin = Boolean(me.is_admin);
      const rows = req.db
        .prepare(
          `SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.is_admin, u.is_active,
                  u.language, u.timezone, u.country, u.default_view, u.last_login_at, u.created_at
           FROM users u
           WHERE ? = 1
              OR u.id = ?
              OR EXISTS (
                   SELECT 1 FROM calendars c
                   JOIN calendar_acl a ON a.calendar_id = c.id
                   WHERE c.owner_id = u.id AND a.user_id = ? AND a.can_view = 1
                 )
              OR EXISTS (
                   SELECT 1 FROM calendars c
                   JOIN calendar_acl a ON a.calendar_id = c.id
                   WHERE c.owner_id = ? AND a.user_id = u.id AND a.can_view = 1
                 )
           ORDER BY u.first_name, u.last_name, u.username`
        )
        .all(isAdmin ? 1 : 0, me.id, me.id, me.id) as UserRow[];
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
          country: u.country,
          defaultView: u.default_view,
          ...(isAdmin
            ? { email: u.email, lastLoginAt: u.last_login_at, createdAt: u.created_at }
            : {})
        }))
      );
    })
  );

  router.post(
    '/',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = createSchema.parse(req.body);
      const passwordProvided = Boolean(body.password);
      if (passwordProvided) {
        const issue = passwordIssues(body.password!);
        if (issue) throw new HttpError(400, issue);
      }
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      if (body.country && !isCountryCode(body.country)) throw new HttpError(400, 'invalid_country');
      const exists = req.db
        .prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
        .get(body.username);
      if (exists) throw new HttpError(409, 'username_taken');
      const id = newId();
      const now = nowIso();
      const hash = await hashPassword(passwordProvided ? body.password! : randomToken(32));
      const token = passwordProvided ? null : randomToken(32);
      const tokenExpiry = token ? accountTokenExpiry() : null;
      const color = ['#2f6feb', '#1f9d55', '#b45309', '#9333ea', '#dc2626', '#0891b2'][
        Math.floor(Math.random() * 6)
      ];
      req.db.transaction(() => {
        req.db
          .prepare(
            `INSERT INTO users (id, username, email, first_name, last_name, password_hash, is_admin, is_active, language, timezone, country, default_view, feed_token, password_token, password_token_expires_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'week', ?, ?, ?, ?, ?)`
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
            body.country ?? null,
            randomToken(24),
            token,
            tokenExpiry,
            now,
            now
          );
        req.db
          .prepare('INSERT INTO calendars (id, owner_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId(), id, body.username, color, now);
        const personalViewId = createDefaultPersonalView(req.db, id, body.language);
        req.db
          .prepare('UPDATE users SET default_view = ? WHERE id = ?')
          .run(`view:${personalViewId}`, id);
      })();
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
      const settings = new SettingsStore(req.db).get();
      const displayName = `${body.firstName} ${body.lastName}`.trim() || body.username;
      const emailSent =
        token && body.email
          ? await sendAccountEmail(settings, {
              to: body.email,
              name: displayName,
              language: body.language,
              url: accountUrl(req, settings, token),
              kind: 'invite'
            })
          : false;
      if (body.country) {
        void syncHolidays(req.db, settings, id).catch(() => undefined);
      }
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.created',
        entity: 'user',
        entityId: id,
        details: { username: body.username, invited: Boolean(token), emailSent },
        ip: req.ip
      });
      res.status(201).json({ ...publicUser(user), emailSent });
    })
  );

  router.patch(
    '/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = updateSchema.parse(req.body);
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      if (body.country && !isCountryCode(body.country)) throw new HttpError(400, 'invalid_country');
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
             language = ?, timezone = ?, country = ?, default_view = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          body.email ?? target.email,
          body.firstName ?? target.first_name,
          body.lastName ?? target.last_name,
          body.isAdmin === undefined ? target.is_admin : body.isAdmin ? 1 : 0,
          body.isActive === undefined ? target.is_active : body.isActive ? 1 : 0,
          body.language ?? target.language,
          body.timezone !== undefined ? body.timezone : target.timezone,
          body.country !== undefined ? body.country : target.country,
          body.defaultView ?? target.default_view,
          nowIso(),
          target.id
        );
      if (body.isActive === false) {
        req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
      if (body.language && body.language !== target.language) {
        renameDefaultPersonalView(req.db, target.id, body.language);
      }
      if (body.country !== undefined && body.country !== target.country) {
        void syncHolidays(req.db, new SettingsStore(req.db).get(), target.id).catch(() => undefined);
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
    '/:id/invite',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const target = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
        | UserRow
        | undefined;
      if (!target) throw new HttpError(404, 'user_not_found');
      if (!target.is_active) throw new HttpError(400, 'account_disabled');
      const token = randomToken(32);
      req.db
        .prepare('UPDATE users SET password_token = ?, password_token_expires_at = ?, updated_at = ? WHERE id = ?')
        .run(token, accountTokenExpiry(), nowIso(), target.id);
      const settings = new SettingsStore(req.db).get();
      const displayName = `${target.first_name} ${target.last_name}`.trim() || target.username;
      const emailSent = await sendAccountEmail(settings, {
        to: target.email,
        name: displayName,
        language: target.language,
        url: accountUrl(req, settings, token),
        kind: 'invite'
      });
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.invited',
        entity: 'user',
        entityId: target.id,
        details: { emailSent },
        ip: req.ip
      });
      res.json({ ok: true, emailSent });
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
      if (target.id === req.user!.id) throw new HttpError(400, 'cannot_delete_self');
      if (target.is_admin) {
        const admins = req.db
          .prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND is_active = 1')
          .get() as { count: number };
        if (admins.count <= 1) throw new HttpError(400, 'last_admin');
      }
      req.db.transaction(() => {
        req.db
          .prepare('UPDATE events SET created_by = owner_id WHERE created_by = ? AND owner_id <> ?')
          .run(target.id, target.id);
        req.db.prepare('DELETE FROM events WHERE owner_id = ?').run(target.id);
        req.db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'user.deleted',
        entity: 'user',
        entityId: target.id,
        details: { username: target.username },
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
