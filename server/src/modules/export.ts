import { Router } from 'express';
import type { UserRow } from '../lib/auth';
import { requireAuth } from '../lib/auth';
import { buildRawIcs, type RawIcsEvent } from '../lib/ics';
import type { EventRow } from '../lib/permissions';
import type { ExceptionRow, OverrideData } from '../lib/recurrence';
import { parseEventRdates } from '../lib/recurrence';
import { cleanDescription } from '../lib/sanitize';
import { addDays } from '../lib/time';
import { asyncHandler, HttpError } from '../lib/util';
import { SettingsStore } from '../settings';

interface ExportEventRow extends EventRow {
  category_name: string | null;
}

function durationMs(event: EventRow): number {
  return new Date(event.end_at).getTime() - new Date(event.start_at).getTime();
}

function allDayDuration(event: EventRow): number {
  const start = new Date(`${event.start_at.slice(0, 10)}T00:00:00.000Z`).getTime();
  const end = new Date(`${event.end_at.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

function originalUid(uid: string): string {
  const match = /^import:[^:]+:(.+)$/s.exec(uid);
  return match ? match[1] : uid;
}

export function exportRoutes(): Router {
  const router = Router();

  router.get(
    '/ics',
    requireAuth,
    asyncHandler(async (req, res) => {
      const requested = typeof req.query.userId === 'string' ? req.query.userId : '';
      if (requested && requested !== req.user!.id && !req.user!.is_admin) {
        throw new HttpError(403, 'forbidden');
      }
      const userId = requested || req.user!.id;
      const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
        | UserRow
        | undefined;
      if (!user) throw new HttpError(404, 'user_not_found');

      const events = req.db
        .prepare(
          `SELECT e.*, c.name AS category_name
           FROM events e
           LEFT JOIN categories c ON c.id = e.category_id
           WHERE e.status <> 'cancelled'
             AND e.owner_id = ?
           ORDER BY e.start_at`
        )
        .all(user.id) as ExportEventRow[];

      const eventIds = events.map((event) => event.id);
      const exceptions: ExceptionRow[] =
        eventIds.length > 0
          ? (req.db
              .prepare(
                `SELECT * FROM event_exceptions WHERE event_id IN (${eventIds.map(() => '?').join(',')})`
              )
              .all(...eventIds) as ExceptionRow[])
          : [];
      const exceptionsByEvent = new Map<string, ExceptionRow[]>();
      for (const exception of exceptions) {
        const list = exceptionsByEvent.get(exception.event_id) ?? [];
        list.push(exception);
        exceptionsByEvent.set(exception.event_id, list);
      }

      const categoryRows = req.db.prepare('SELECT id, name FROM categories').all() as {
        id: string;
        name: string;
      }[];
      const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name]));

      const items: RawIcsEvent[] = [];
      for (const event of events) {
        const eventAllDay = Boolean(event.all_day);
        const timeZone = eventAllDay ? 'UTC' : event.timezone || 'UTC';
        const rdates = parseEventRdates(event);
        const recurring = Boolean(event.rrule || rdates.length);
        const exdates: string[] = [];
        const overrides: RawIcsEvent[] = [];

        for (const exception of exceptionsByEvent.get(event.id) ?? []) {
          if (exception.action === 'cancelled') {
            exdates.push(exception.occurrence_start);
            continue;
          }
          if (exception.action !== 'modified' || !exception.override_json) continue;
          let override: OverrideData;
          try {
            override = JSON.parse(exception.override_json) as OverrideData;
          } catch {
            continue;
          }
          const allDay = override.allDay ?? eventAllDay;
          const start = override.start ?? exception.occurrence_start;
          let end: string;
          if (override.end) {
            end = override.end;
          } else if (allDay) {
            end = addDays(start.slice(0, 10), allDayDuration(event));
          } else {
            end = new Date(new Date(start).getTime() + durationMs(event)).toISOString();
          }
          const categoryId = override.categoryId ?? event.category_id;
          const categoryName = categoryId ? categoryNames.get(categoryId) : event.category_name;
          overrides.push({
            uid: originalUid(event.uid),
            sequence: event.sequence,
            title: override.title ?? event.title,
            description: cleanDescription(override.description ?? event.description, false),
            location: override.location !== undefined ? override.location : event.location,
            url: override.url !== undefined ? override.url : event.url,
            start,
            end,
            allDay,
            timezone: allDay ? 'UTC' : timeZone,
            recurrenceId: exception.occurrence_start,
            categories: categoryName ? [categoryName] : undefined,
            stamp: event.updated_at
          });
        }

        items.push({
          uid: originalUid(event.uid),
          sequence: event.sequence,
          title: event.title,
          description: cleanDescription(event.description, false),
          location: event.location,
          url: event.url,
          start: event.start_at,
          end: event.end_at,
          allDay: eventAllDay,
          timezone: timeZone,
          rrule: event.rrule,
          exdates: recurring ? exdates : undefined,
          rdates: rdates.length ? rdates : undefined,
          categories: event.category_name ? [event.category_name] : undefined,
          stamp: event.updated_at
        });
        if (recurring) items.push(...overrides);
      }

      const settings = new SettingsStore(req.db).get();
      const name = `${user.first_name} ${user.last_name}`.trim() || user.username;
      const body = buildRawIcs(`${settings.appName} - ${name}`, items);
      const safeName = user.username.replace(/[^a-zA-Z0-9._-]/g, '_') || 'teamcal';
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="teamcal_${safeName}.ics"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.send(body);
    })
  );

  return router;
}
