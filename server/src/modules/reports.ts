import { Router } from 'express';
import { requireAdmin, requireAuth } from '../lib/auth';
import { asyncHandler } from '../lib/util';

const EVENT_ACTIONS = ['event.created', 'event.updated', 'event.deleted'] as const;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

interface AuditRow {
  id: string;
  action: string;
  entity_id: string;
  details: string | null;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_first_name: string | null;
  actor_last_name: string | null;
  event_id: string | null;
  event_title: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: number | null;
  event_status: string | null;
  event_deleted_at: string | null;
  event_calendar_id: string | null;
  calendar_name: string | null;
  calendar_owner_id: string | null;
  owner_username: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
}

interface CalendarRow {
  id: string;
  name: string;
  owner_id: string;
  username: string;
  first_name: string;
  last_name: string;
}

function displayName(first: string | null, last: string | null, username: string | null): string {
  const full = `${first ?? ''} ${last ?? ''}`.trim();
  return full || username || '';
}

function parseDetails(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function reportRoutes(): Router {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get(
    '/audit',
    asyncHandler(async (req, res) => {
      const requested = Number(req.query.limit ?? DEFAULT_LIMIT);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

      const rows = req.db
        .prepare(
          `SELECT a.id, a.action, a.entity_id, a.details, a.created_at,
                  u.id AS actor_id, u.username AS actor_username,
                  u.first_name AS actor_first_name, u.last_name AS actor_last_name,
                  e.id AS event_id, e.title AS event_title, e.start_at, e.end_at,
                  e.all_day, e.status AS event_status, e.deleted_at AS event_deleted_at,
                  e.calendar_id AS event_calendar_id, c.name AS calendar_name,
                  c.owner_id AS calendar_owner_id, o.username AS owner_username,
                  o.first_name AS owner_first_name, o.last_name AS owner_last_name
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
           LEFT JOIN events e ON e.id = a.entity_id
           LEFT JOIN calendars c ON c.id = e.calendar_id
           LEFT JOIN users o ON o.id = c.owner_id
           WHERE a.action IN (${EVENT_ACTIONS.map(() => '?').join(',')})
           ORDER BY a.created_at DESC, a.rowid DESC
           LIMIT ?`
        )
        .all(...EVENT_ACTIONS, limit) as AuditRow[];

      const detailsById = new Map<string, Record<string, unknown>>();
      const fallbackCalendarIds = new Set<string>();
      for (const row of rows) {
        const details = parseDetails(row.details);
        detailsById.set(row.id, details);
        if (!row.event_calendar_id && typeof details.calendarId === 'string') {
          fallbackCalendarIds.add(details.calendarId);
        }
      }

      const fallbackCalendars = new Map<string, CalendarRow>();
      if (fallbackCalendarIds.size > 0) {
        const ids = Array.from(fallbackCalendarIds);
        const calendarRows = req.db
          .prepare(
            `SELECT c.id, c.name, c.owner_id, u.username, u.first_name, u.last_name
             FROM calendars c
             JOIN users u ON u.id = c.owner_id
             WHERE c.id IN (${ids.map(() => '?').join(',')})`
          )
          .all(...ids) as CalendarRow[];
        for (const calendar of calendarRows) fallbackCalendars.set(calendar.id, calendar);
      }

      const entries = rows.map((row) => {
        const details = detailsById.get(row.id) ?? {};
        const fallback = typeof details.calendarId === 'string'
          ? fallbackCalendars.get(details.calendarId)
          : undefined;
        const calendarId = row.event_calendar_id ?? fallback?.id ?? null;
        const calendarName = row.calendar_name ?? fallback?.name ?? null;
        const ownerUsername = row.owner_username ?? fallback?.username ?? null;
        const ownerName = row.event_calendar_id
          ? displayName(row.owner_first_name, row.owner_last_name, row.owner_username)
          : fallback
            ? displayName(fallback.first_name, fallback.last_name, fallback.username)
            : '';
        const eventTitle =
          row.event_title ??
          (typeof details.title === 'string' ? details.title : '') ??
          '';
        const available = Boolean(row.event_id);

        return {
          id: row.id,
          action: row.action.replace('event.', ''),
          createdAt: row.created_at,
          actor: {
            id: row.actor_id,
            username: row.actor_username,
            name: displayName(row.actor_first_name, row.actor_last_name, row.actor_username)
          },
          agenda: calendarId
            ? {
                id: calendarId,
                name: calendarName,
                username: ownerUsername,
                ownerName
              }
            : null,
          event: {
            id: row.entity_id,
            title: eventTitle,
            start: row.start_at,
            end: row.end_at,
            allDay: Boolean(row.all_day),
            status: row.event_status,
            deleted: row.event_status === 'cancelled',
            deletedAt: row.event_deleted_at,
            available
          }
        };
      });

      res.json({ entries });
    })
  );

  return router;
}
