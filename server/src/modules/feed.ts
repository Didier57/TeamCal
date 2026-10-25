import { Router } from 'express';
import type { UserRow } from '../lib/auth';
import { cleanDescription } from '../lib/sanitize';
import { buildFeedIcs, type FeedItem } from '../lib/ics';
import { expandEvent, type ExceptionRow } from '../lib/recurrence';
import type { EventRow } from '../lib/permissions';
import { asyncHandler, HttpError } from '../lib/util';
import { SettingsStore } from '../settings';

const MAX_ITEMS = 10000;

export function feedRoutes(): Router {
  const router = Router();

  router.get(
    '/:token',
    asyncHandler(async (req, res) => {
      let token = req.params.token;
      try {
        token = decodeURIComponent(token);
      } catch {
        throw new HttpError(404, 'feed_not_found');
      }
      token = token.replace(/\.ics$/i, '');
      const user = req.db
        .prepare('SELECT * FROM users WHERE feed_token = ? AND is_active = 1')
        .get(token) as UserRow | undefined;
      if (!user) throw new HttpError(404, 'feed_not_found');

      const events = req.db
        .prepare(
          `SELECT DISTINCT e.*
           FROM events e
           LEFT JOIN event_participants p ON p.event_id = e.id AND p.user_id = ?
           WHERE e.status <> 'cancelled'
             AND (e.owner_id = ? OR p.user_id IS NOT NULL)
           ORDER BY e.start_at`
        )
        .all(user.id, user.id) as EventRow[];

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

      const from = new Date(Date.now() - 365 * 86400000);
      const to = new Date(Date.now() + 5 * 365.25 * 86400000);
      const items: FeedItem[] = [];
      for (const event of events) {
        const occurrences = expandEvent(
          event,
          exceptionsByEvent.get(event.id) ?? [],
          from,
          to,
          5000
        );
        for (const occurrence of occurrences) {
          if (items.length >= MAX_ITEMS) break;
          const uid = event.rrule
            ? `${event.uid}-${occurrence.occurrenceStart}`
            : event.uid;
          items.push({
            uid,
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
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="teamcal.ics"');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.send(body);
    })
  );

  return router;
}
