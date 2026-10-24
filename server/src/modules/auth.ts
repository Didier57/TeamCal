import { Router } from 'express';
import { z } from 'zod';
import {
  checkLoginRate,
  createSession,
  csrfMiddleware,
  destroySession,
  ensureFeedToken,
  publicUser,
  recordLoginFailure,
  recordLoginSuccess,
  requireAuth,
  type UserRow
} from '../lib/auth';
import { hashPassword, passwordIssues, verifyPassword } from '../lib/password';
import { audit } from '../lib/audit';
import { accountTokenExpiry, asyncHandler, HttpError, nowIso, randomToken } from '../lib/util';
import { SettingsStore, type AppSettings } from '../settings';
import { isValidTimeZone } from '../lib/time';
import { isCountryCode } from '../lib/countries';
import { syncHolidays } from '../lib/holidays';
import { sendAccountEmail } from '../lib/mailer';

function appBaseUrl(req: { protocol: string; get(header: string): string | undefined }, settings: AppSettings) {
  return (settings.baseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function accountUrl(req: { protocol: string; get(header: string): string | undefined }, settings: AppSettings, token: string) {
  return `${appBaseUrl(req, settings)}/reset-password?token=${encodeURIComponent(token)}`;
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(false)
});

const themeColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const themeColorSetSchema = z.object({
  primary: themeColorSchema,
  accent: themeColorSchema,
  background: themeColorSchema,
  surface: themeColorSchema,
  text: themeColorSchema,
  muted: themeColorSchema,
  border: themeColorSchema,
  documentTitle: themeColorSchema,
  eventText: themeColorSchema,
  headerBackground: themeColorSchema,
  headerText: themeColorSchema,
  cellBackground: themeColorSchema,
  todayBackground: themeColorSchema,
  eventDayBackground: themeColorSchema,
  weekendBackground: themeColorSchema,
  otherMonthBackground: themeColorSchema,
  weekNumberColor: themeColorSchema,
  eventDetailsBackground: themeColorSchema,
  eventDetailsText: themeColorSchema
});

const themeColorsSchema = z
  .object({ light: themeColorSetSchema, dark: themeColorSetSchema })
  .nullable()
  .optional();

const preferencesSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  language: z.enum(['fr', 'en', 'de']).optional(),
  timezone: z.string().max(80).nullable().optional(),
  country: z.string().trim().length(2).nullable().optional(),
  dateFormat: z.string().max(30).nullable().optional(),
  timeFormat: z.enum(['12', '24']).nullable().optional(),
  defaultView: z
    .string()
    .regex(/^(day|week|month|view:[0-9a-fA-F-]{36})$/)
    .optional(),
  theme: z.enum(['light', 'dark']).nullable().optional(),
  themeColors: themeColorsSchema,
  notifyNewEvents: z.boolean().optional()
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200)
});

const forgotSchema = z.object({ email: z.string().trim().email().max(200) });

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200)
});

export function authRoutes(): Router {
  const router = Router();

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      const store = new SettingsStore(req.db);
      if (req.user) ensureFeedToken(req.db, req.user);
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
      ensureFeedToken(req.db, user);
      recordLoginSuccess(ip);
      const duration = body.remember ? Math.max(30, settings.sessionDurationDays) : 1;
      const session = createSession(req, res, user.id, duration);
      req.db
        .prepare(
          'UPDATE users SET last_login_at = ?, updated_at = ?, password_token = NULL, password_token_expires_at = NULL WHERE id = ?'
        )
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
    '/forgot-password',
    asyncHandler(async (req, res) => {
      const body = forgotSchema.parse(req.body);
      const user = req.db
        .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1')
        .get(body.email) as UserRow | undefined;
      if (user) {
        const token = randomToken(32);
        req.db
          .prepare(
            'UPDATE users SET password_token = ?, password_token_expires_at = ?, updated_at = ? WHERE id = ?'
          )
          .run(token, accountTokenExpiry(), nowIso(), user.id);
        const settings = new SettingsStore(req.db).get();
        const displayName = `${user.first_name} ${user.last_name}`.trim() || user.username;
        await sendAccountEmail(settings, {
          to: user.email,
          name: displayName,
          language: user.language,
          url: accountUrl(req, settings, token),
          kind: 'reset'
        });
        audit(req.db, {
          action: 'auth.password_reset_requested',
          entity: 'user',
          entityId: user.id,
          ip: req.ip
        });
      }
      res.json({ ok: true });
    })
  );

  router.get(
    '/reset/:token',
    asyncHandler(async (req, res) => {
      const user = req.db
        .prepare('SELECT * FROM users WHERE password_token = ? AND is_active = 1')
        .get(req.params.token) as UserRow | undefined;
      const valid = Boolean(
        user && user.password_token_expires_at && user.password_token_expires_at > nowIso()
      );
      res.json(
        valid && user
          ? { valid: true, username: user.username, firstName: user.first_name, email: user.email }
          : { valid: false }
      );
    })
  );

  router.post(
    '/reset-password',
    asyncHandler(async (req, res) => {
      const body = resetSchema.parse(req.body);
      const issue = passwordIssues(body.password);
      if (issue) throw new HttpError(400, issue);
      const user = req.db
        .prepare('SELECT * FROM users WHERE password_token = ? AND is_active = 1')
        .get(body.token) as UserRow | undefined;
      if (!user || !user.password_token_expires_at || user.password_token_expires_at <= nowIso()) {
        throw new HttpError(400, 'invalid_token');
      }
      const hash = await hashPassword(body.password);
      req.db
        .prepare(
          `UPDATE users SET password_hash = ?, password_token = NULL, password_token_expires_at = NULL,
             updated_at = ? WHERE id = ?`
        )
        .run(hash, nowIso(), user.id);
      req.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      audit(req.db, {
        action: 'auth.password_reset',
        entity: 'user',
        entityId: user.id,
        ip: req.ip
      });
      res.json({ ok: true });
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
      if (body.country && !isCountryCode(body.country)) throw new HttpError(400, 'invalid_country');
      if (body.themeColors && !new SettingsStore(req.db).get().allowUserColors) {
        throw new HttpError(403, 'user_colors_disabled');
      }
      if (body.defaultView?.startsWith('view:')) {
        const viewId = body.defaultView.slice('view:'.length);
        const view = req.db
          .prepare('SELECT 1 FROM custom_views WHERE id = ? AND (is_shared = 1 OR owner_id = ?)')
          .get(viewId, req.user!.id);
        if (!view) throw new HttpError(400, 'invalid_default_view');
      }
      const current = req.user!;
      const themeColors =
        body.themeColors !== undefined
          ? body.themeColors
            ? JSON.stringify(body.themeColors)
            : null
          : current.theme_colors;
      req.db
        .prepare(
          `UPDATE users SET first_name = ?, last_name = ?, email = ?, language = ?, timezone = ?,
             country = ?, date_format = ?, time_format = ?, default_view = ?, theme = ?, theme_colors = ?,
             notify_new_events = ?, updated_at = ? WHERE id = ?`
        )
        .run(
          body.firstName ?? current.first_name,
          body.lastName ?? current.last_name,
          body.email ?? current.email,
          body.language ?? current.language,
          body.timezone !== undefined ? body.timezone : current.timezone,
          body.country !== undefined ? body.country : current.country,
          body.dateFormat !== undefined ? body.dateFormat : current.date_format,
          body.timeFormat !== undefined ? body.timeFormat : current.time_format,
          body.defaultView ?? current.default_view,
          body.theme !== undefined ? body.theme : current.theme,
          themeColors,
          body.notifyNewEvents !== undefined
            ? body.notifyNewEvents
              ? 1
              : 0
            : current.notify_new_events,
          nowIso(),
          current.id
        );
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(current.id) as UserRow;
      if (body.country !== undefined && body.country !== current.country) {
        void syncHolidays(req.db, new SettingsStore(req.db).get(), current.id).catch(() => undefined);
      }
      res.json({ user: publicUser(user) });
    })
  );

  router.post(
    '/me/feed/regenerate',
    requireAuth,
    csrfMiddleware,
    asyncHandler(async (req, res) => {
      const token = randomToken(24);
      req.db
        .prepare('UPDATE users SET feed_token = ?, updated_at = ? WHERE id = ?')
        .run(token, nowIso(), req.user!.id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'auth.feed_token_regenerated',
        entity: 'user',
        entityId: req.user!.id,
        ip: req.ip
      });
      res.json({ feedToken: token });
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
