import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { importIcsEvents } from '../lib/ics-import';
import { asyncHandler, HttpError } from '../lib/util';
import { SettingsStore } from '../settings';

const importSchema = z.object({
  userId: z.string().min(1),
  defaultCategoryId: z.string().nullable().optional(),
  content: z.string().min(1).max(10_000_000)
});

export function importRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    '/ics',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = importSchema.parse(req.body);
      const user = req.db.prepare('SELECT id FROM users WHERE id = ?').get(body.userId);
      if (!user) throw new HttpError(404, 'user_not_found');
      if (body.defaultCategoryId) {
        const category = req.db
          .prepare('SELECT 1 FROM categories WHERE id = ?')
          .get(body.defaultCategoryId);
        if (!category) throw new HttpError(400, 'category_not_found');
      }
      const settings = new SettingsStore(req.db).get();
      const result = importIcsEvents(req.db, {
        userId: body.userId,
        content: body.content,
        createdBy: req.user!.id,
        defaultCategoryId: body.defaultCategoryId ?? null,
        allowHtmlDescription: settings.allowHtmlDescription
      });
      audit(req.db, {
        userId: req.user!.id,
        action: 'events.imported',
        entity: 'user',
        entityId: body.userId,
        details: {
          imported: result.imported,
          updated: result.updated,
          skipped: result.skipped,
          exceptions: result.exceptions,
          categoriesMatched: result.categoriesMatched
        },
        ip: req.ip
      });
      res.status(201).json(result);
    })
  );

  return router;
}
