import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth';
import { regenerateVapidKeys, sendTestPush } from '../lib/push';
import { logger } from '../lib/logger';
import { SettingsStore } from '../settings';
import { asyncHandler, newId, nowIso } from '../lib/util';

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({
      p256dh: z.string().min(1).max(500),
      auth: z.string().min(1).max(500)
    })
  })
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000)
});

export function pushRoutes(): Router {
  const router = Router();

  router.post(
    '/subscribe',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = subscriptionSchema.parse(req.body);
      const now = nowIso();
      req.db
        .prepare(
          `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET
             user_id = excluded.user_id,
             p256dh = excluded.p256dh,
             auth = excluded.auth,
             updated_at = excluded.updated_at`
        )
        .run(
          newId(),
          req.user!.id,
          body.subscription.endpoint,
          body.subscription.keys.p256dh,
          body.subscription.keys.auth,
          now,
          now
        );
      logger.info('push_subscribed', {
        userId: req.user!.id,
        endpoint: body.subscription.endpoint.slice(0, 60)
      });
      res.json({ ok: true });
    })
  );

  router.post(
    '/test',
    requireAuth,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      const result = await sendTestPush(req.db, settings, req.user!.id);
      logger.info('push_test', { userId: req.user!.id, ...result });
      res.json(result);
    })
  );

  router.post(
    '/unsubscribe',
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = unsubscribeSchema.parse(req.body);
      req.db
        .prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
        .run(body.endpoint, req.user!.id);
      res.json({ ok: true });
    })
  );

  router.post(
    '/regenerate',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const vapidPublicKey = regenerateVapidKeys(req.db);
      res.json({ ok: true, vapidPublicKey });
    })
  );

  return router;
}
