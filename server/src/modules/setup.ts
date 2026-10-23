import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, passwordIssues } from '../lib/password';
import { createSession, publicUser, type UserRow } from '../lib/auth';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso } from '../lib/util';
import { SettingsStore } from '../settings';
import { isValidTimeZone } from '../lib/time';

const setupSchema = z.object({
  appName: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().max(200).optional().default(''),
  language: z.enum(['fr', 'en', 'de']).default('fr'),
  timezone: z.string().min(1).max(80),
  admin: z.object({
    username: z.string().trim().min(3).max(50),
    email: z.string().trim().email().max(200),
    firstName: z.string().trim().max(80).default(''),
    lastName: z.string().trim().max(80).default(''),
    password: z.string().min(8).max(200)
  })
});

export function setupRoutes(): Router {
  const router = Router();

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const store = new SettingsStore(req.db);
      res.json({ needsSetup: !store.get().setupCompleted });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const store = new SettingsStore(req.db);
      if (store.get().setupCompleted) throw new HttpError(409, 'setup_already_completed');
      const body = setupSchema.parse(req.body);
      if (!isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      const issue = passwordIssues(body.admin.password);
      if (issue) throw new HttpError(400, issue);
      const existing = req.db.prepare('SELECT 1 FROM users LIMIT 1').get();
      if (existing) throw new HttpError(409, 'setup_already_completed');

      const now = nowIso();
      const userId = newId();
      const hash = await hashPassword(body.admin.password);
      req.db.transaction(() => {
        req.db
          .prepare(
            `INSERT INTO users (id, username, email, first_name, last_name, password_hash, is_admin, is_active, language, timezone, default_view, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, 'week', ?, ?)`
          )
          .run(
            userId,
            body.admin.username,
            body.admin.email,
            body.admin.firstName,
            body.admin.lastName,
            hash,
            body.language,
            body.timezone,
            now,
            now
          );
        req.db
          .prepare('INSERT INTO calendars (id, owner_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId(), userId, `${body.admin.username}`, '#2f6feb', now);
        req.db
          .prepare('INSERT INTO categories (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(newId(), 'Général', '#2f6feb', now, now);
        store.set({
          appName: body.appName,
          baseUrl: body.baseUrl,
          defaultLanguage: body.language,
          defaultTimezone: body.timezone,
          setupCompleted: true
        });
      })();

      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
      const session = createSession(req, res, user.id, store.get().sessionDurationDays);
      audit(req.db, {
        userId: user.id,
        action: 'setup.completed',
        entity: 'user',
        entityId: user.id,
        ip: req.ip
      });
      res.status(201).json({
        user: publicUser(user),
        csrfToken: session.csrf_token,
        settings: store.publicView()
      });
    })
  );

  return router;
}
