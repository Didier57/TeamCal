import { Router } from 'express';
import type { UserRow } from '../lib/auth';
import { requireAuth } from '../lib/auth';
import { buildFeedIcs, type FeedItem } from '../lib/ics';
import type { EventRow } from '../lib/permissions';
import { expandEvent, type ExceptionRow } from '../lib/recurrence';
import { cleanDescription } from '../lib/sanitize';
import { asyncHandler, HttpError } from '../lib/util';
import { SettingsStore } from '../settings';

const MAX_ITEMS = 50000;

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
          `SELECT DISTINCT e.*
           FROM events e
           LEFT JOIN event_participants p ON p.event_id = e.id AND p.user_id = ?
           WHERE e.status <> 'cancelled'
             AND (e.owner_id = ? OR e.created_by = ? OR p.user_id IS NOT NULL)
           ORDER BY e.start_at`
        )
        .all(user.id, user.id, user.id) as EventRow[];

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

      const from = new Date(0);
      const to = new Date(Date.now() + 10 * 365.25 * 86400000);
      const items: FeedItem[] = [];
      for (const event of events) {
        const occurrences = expandEvent(
          event,
          exceptionsByEvent.get(event.id) ?? [],
          from,
          to,
          10000
        );
        for (const occurrence of occurrences) {
          if (items.length >= MAX_ITEMS) break;
          items.push({
            uid: event.rrule ? `${event.uid}-${occurrence.occurrenceStart}` : event.uid,
            title: occurrence.title,
            description: cleanDescription(occurrence.description, false),
            location: occurrence.location,
            url: occurrence.url,
            start: occurrence.start,
            end: occurrence.end,
            allDay: occurrence.allDay,
            sequence: occurrence.sequence,
            stamp: event.updated_at
          });
        }
        if (items.length >= MAX_ITEMS) break;
      }

      const settings = new SettingsStore(req.db).get();
      const name = `${user.first_name} ${user.last_name}`.trim() || user.username;
      const body = buildFeedIcs(`${settings.appName} - ${name}`, items);
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
