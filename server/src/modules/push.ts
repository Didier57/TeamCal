import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth';
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
      res.json({ ok: true });
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

  return router;
}
