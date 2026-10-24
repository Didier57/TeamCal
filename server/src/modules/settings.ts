import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError } from '../lib/util';
import { SettingsStore } from '../settings';
import { sendTestEmail } from '../lib/mailer';
import { isValidTimeZone } from '../lib/time';
import { isCountryCode } from '../lib/countries';
import { syncHolidays } from '../lib/holidays';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const themeColors = z.object({
  primary: color,
  accent: color,
  background: color,
  surface: color,
  text: color,
  muted: color,
  border: color,
  documentTitle: color,
  eventText: color,
  headerBackground: color,
  headerText: color,
  cellBackground: color,
  todayBackground: color,
  eventDayBackground: color,
  weekendBackground: color,
  otherMonthBackground: color,
  weekNumberColor: color,
  eventDetailsBackground: color,
  eventDetailsText: color
});

const settingsSchema = z.object({
  appName: z.string().trim().min(1).max(80).optional(),
  baseUrl: z.string().trim().max(200).optional(),
  defaultLanguage: z.enum(['fr', 'en', 'de']).optional(),
  defaultTimezone: z.string().max(80).optional(),
  dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'dd/MM', 'MM/yyyy']).optional(),
  timeFormat: z.enum(['12', '24']).optional(),
  firstDay: z.number().int().min(0).max(6).optional(),
  weekendDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  workHours: z
    .object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })
    .optional(),
  defaultView: z.enum(['day', 'week', 'month']).optional(),
  fields: z
    .object({
      location: z.boolean(),
      url: z.boolean(),
      priority: z.boolean(),
      visibility: z.boolean(),
      participants: z.boolean(),
      recurrence: z.boolean()
    })
    .partial()
    .optional(),
  allowHtmlDescription: z.boolean().optional(),
  allowUserColors: z.boolean().optional(),
  priorities: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  visibilityOptions: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  holidaySources: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        country: z.string().trim().min(2).max(2),
        url: z
          .string()
          .trim()
          .url()
          .max(1000)
          .refine((value) => /^https?:\/\//i.test(value), 'invalid_url'),
        name: z.string().trim().max(120).optional().default('')
      })
    )
    .max(100)
    .optional(),
  theme: z.object({ light: themeColors, dark: themeColors }).partial().optional(),
  smtp: z
    .object({
      host: z.string().trim().max(200),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      user: z.string().trim().max(200),
      password: z.string().max(500),
      fromName: z.string().trim().max(120),
      fromEmail: z.string().trim().max(200)
    })
    .partial()
    .optional(),
  sessionDurationDays: z.number().int().min(1).max(90).optional()
});

export function settingsRoutes(): Router {
  const router = Router();

  router.get(
    '/public',
    asyncHandler(async (req, res) => {
      res.json(new SettingsStore(req.db).publicView());
    })
  );

  router.get(
    '/',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const settings = new SettingsStore(req.db).get();
      res.json({
        ...settings,
        smtp: { ...settings.smtp, password: '', hasPassword: Boolean(settings.smtp.password) }
      });
    })
  );

  router.put(
    '/',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const body = settingsSchema.parse(req.body);
      if (body.defaultTimezone && !isValidTimeZone(body.defaultTimezone)) {
        throw new HttpError(400, 'invalid_timezone');
      }
      if (body.holidaySources) {
        for (const source of body.holidaySources) {
          if (!isCountryCode(source.country)) throw new HttpError(400, 'invalid_country');
        }
        if (new Set(body.holidaySources.map((source) => source.id)).size !== body.holidaySources.length) {
          throw new HttpError(400, 'duplicate_holiday_source');
        }
      }
      const store = new SettingsStore(req.db);
      const current = store.get();
      if (body.smtp) {
        if (!body.smtp.password) {
          body.smtp.password = current.smtp.password;
        }
        if (body.smtp.fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.smtp.fromEmail)) {
          throw new HttpError(400, 'invalid_from_email');
        }
      }
      store.set(body as Record<string, unknown>);
      audit(req.db, {
        userId: req.user!.id,
        action: 'settings.updated',
        entity: 'settings',
        details: { keys: Object.keys(body) },
        ip: req.ip
      });
      const settings = store.get();
      void syncHolidays(req.db, settings).catch(() => undefined);
      res.json({
        ...settings,
        smtp: { ...settings.smtp, password: '', hasPassword: Boolean(settings.smtp.password) }
      });
    })
  );

  router.post(
    '/smtp/test',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const schema = z.object({ to: z.string().trim().email().max(200) });
      const body = schema.parse(req.body);
      const settings = new SettingsStore(req.db).get();
      const result = await sendTestEmail(settings, body.to);
      if (!result.ok) throw new HttpError(400, result.error ?? 'smtp_error');
      res.json({ ok: true });
    })
  );

  return router;
}
