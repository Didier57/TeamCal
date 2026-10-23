import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db';
import { audit } from '../lib/audit';
import { requireAdmin, requireAuth } from '../lib/auth';
import { isCountryCode } from '../lib/countries';
import { applyHolidayToCountryUsers, holidayKey, syncHolidays } from '../lib/holidays';
import { asyncHandler, HttpError, nowIso } from '../lib/util';
import { SettingsStore } from '../settings';

interface HolidayRow {
  key: string;
  country: string;
  date: string;
  title: string;
  users: number;
  manual: number;
}

interface EventRow {
  holiday_key: string;
  holiday_source_id: string | null;
  start_at: string;
  title: string;
}

interface AdjustmentRow {
  holiday_key: string;
  country: string;
  holiday_date: string;
  title: string | null;
  hidden: number;
  manual: number;
}

const manualSchema = z.object({
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(200)
});

const titleSchema = z.object({
  title: z.string().trim().min(1).max(200)
});

function isValidDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date.getUTCFullYear() >= 1900 &&
    date.getUTCFullYear() <= 2100
  );
}

function getAdjustment(db: DB, key: string): AdjustmentRow | undefined {
  return db.prepare('SELECT * FROM holiday_adjustments WHERE holiday_key = ?').get(key) as
    | AdjustmentRow
    | undefined;
}

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

  router.get(
    '/admin',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const rows = req.db
        .prepare(
          `SELECT e.holiday_key AS key,
                  MAX(e.holiday_source_id) AS country,
                  MAX(e.start_at) AS date,
                  MAX(e.title) AS title,
                  COUNT(*) AS users,
                  COALESCE(MAX(a.manual), 0) AS manual
           FROM events e
           LEFT JOIN holiday_adjustments a ON a.holiday_key = e.holiday_key
           WHERE e.holiday_key IS NOT NULL AND e.status <> 'cancelled'
           GROUP BY e.holiday_key`
        )
        .all() as HolidayRow[];
      const result = new Map(rows.map((row) => [row.key, row]));
      const manual = req.db
        .prepare('SELECT * FROM holiday_adjustments WHERE manual = 1 AND hidden = 0')
        .all() as AdjustmentRow[];
      for (const adjustment of manual) {
        if (result.has(adjustment.holiday_key) || !adjustment.title) continue;
        result.set(adjustment.holiday_key, {
          key: adjustment.holiday_key,
          country: adjustment.country,
          date: adjustment.holiday_date,
          title: adjustment.title,
          users: 0,
          manual: 1
        });
      }
      res.json(
        Array.from(result.values())
          .map((row) => ({ ...row, manual: Boolean(row.manual) }))
          .sort(
            (a, b) =>
              a.date.localeCompare(b.date) ||
              a.country.localeCompare(b.country) ||
              a.title.localeCompare(b.title)
          )
      );
    })
  );

  router.post(
    '/admin',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = manualSchema.parse(req.body);
      if (!isCountryCode(body.country)) throw new HttpError(400, 'invalid_country');
      if (!isValidDate(body.date)) throw new HttpError(400, 'invalid_date');
      const key = holidayKey(body.country, body);
      const now = nowIso();
      req.db
        .prepare(
          `INSERT INTO holiday_adjustments
             (holiday_key, country, holiday_date, title, hidden, manual, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 1, ?, ?)
           ON CONFLICT(holiday_key) DO UPDATE SET
             country = excluded.country,
             holiday_date = excluded.holiday_date,
             title = excluded.title,
             hidden = 0,
             manual = 1,
             updated_at = excluded.updated_at`
        )
        .run(key, body.country, body.date, body.title, now, now);
      const users = applyHolidayToCountryUsers(req.db, body.country, key, body.date, body.title);
      audit(req.db, {
        userId: req.user?.id,
        action: 'holiday.manual_add',
        entity: 'holiday',
        entityId: key,
        details: { country: body.country, date: body.date, title: body.title, users },
        ip: req.ip
      });
      res.status(201).json({ key, users });
    })
  );

  router.patch(
    '/admin/:key',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      const body = titleSchema.parse(req.body);
      const event = req.db
        .prepare(
          'SELECT holiday_key, holiday_source_id, start_at, title FROM events WHERE holiday_key = ? LIMIT 1'
        )
        .get(key) as EventRow | undefined;
      const adjustment = getAdjustment(req.db, key);
      if (!event && !adjustment) throw new HttpError(404, 'not_found');
      const country = event?.holiday_source_id ?? adjustment?.country;
      const date = event?.start_at ?? adjustment?.holiday_date;
      if (!country || !date) throw new HttpError(404, 'not_found');
      const manual = adjustment?.manual ? 1 : 0;
      const now = nowIso();
      req.db.transaction(() => {
        req.db
          .prepare(
            `INSERT INTO holiday_adjustments
               (holiday_key, country, holiday_date, title, hidden, manual, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?)
             ON CONFLICT(holiday_key) DO UPDATE SET
               title = excluded.title,
               hidden = 0,
               updated_at = excluded.updated_at`
          )
          .run(key, country, date, body.title, manual, now, now);
        req.db.prepare('UPDATE events SET title = ?, updated_at = ? WHERE holiday_key = ?').run(
          body.title,
          now,
          key
        );
      })();
      audit(req.db, {
        userId: req.user?.id,
        action: 'holiday.title_update',
        entity: 'holiday',
        entityId: key,
        details: { title: body.title },
        ip: req.ip
      });
      res.json({ key, title: body.title });
    })
  );

  router.delete(
    '/admin/:key',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const key = req.params.key;
      const event = req.db
        .prepare(
          'SELECT holiday_key, holiday_source_id, start_at, title FROM events WHERE holiday_key = ? LIMIT 1'
        )
        .get(key) as EventRow | undefined;
      const adjustment = getAdjustment(req.db, key);
      if (!event && !adjustment) throw new HttpError(404, 'not_found');
      const country = event?.holiday_source_id ?? adjustment?.country;
      const date = event?.start_at ?? adjustment?.holiday_date;
      const title = adjustment?.title ?? event?.title ?? '';
      const manual = adjustment?.manual ? 1 : 0;
      if (!country || !date) throw new HttpError(404, 'not_found');
      const now = nowIso();
      req.db.transaction(() => {
        req.db
          .prepare(
            `INSERT INTO holiday_adjustments
               (holiday_key, country, holiday_date, title, hidden, manual, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)
             ON CONFLICT(holiday_key) DO UPDATE SET
               hidden = 1,
               title = excluded.title,
               updated_at = excluded.updated_at`
          )
          .run(key, country, date, title, manual, now, now);
        req.db.prepare('DELETE FROM events WHERE holiday_key = ?').run(key);
      })();
      audit(req.db, {
        userId: req.user?.id,
        action: 'holiday.delete',
        entity: 'holiday',
        entityId: key,
        details: { country, date },
        ip: req.ip
      });
      res.json({ ok: true });
    })
  );

  return router;
}
