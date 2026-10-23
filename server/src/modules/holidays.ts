import { Router } from 'express';
import { requireAdmin, requireAuth } from '../lib/auth';
import { syncHolidays } from '../lib/holidays';
import { asyncHandler } from '../lib/util';
import { SettingsStore } from '../settings';

export function holidayRoutes(): Router {
  const router = Router();

  router.post(
    '/sync',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      const result = await syncHolidays(req.db, settings);
      res.json(result);
    })
  );

  return router;
}
