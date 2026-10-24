import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type UserRow } from '../lib/auth';
import {
  calendarAccess,
  canDeleteEvent,
  canEditEvent,
  canViewEvent,
  getCalendar,
  type EventRow
} from '../lib/permissions';
import { notifyEvent } from '../lib/mailer';
import { cleanDescription, isValidHttpUrl } from '../lib/sanitize';
import { findEventConflicts } from '../lib/conflicts';
import {
  eventOccurrenceId,
  expandEvent,
  parseEventOccurrenceId,
  type ExceptionRow
} from '../lib/recurrence';
import { audit } from '../lib/audit';
import { asyncHandler, HttpError, newId, nowIso } from '../lib/util';
import { SettingsStore } from '../settings';
import { isValidTimeZone } from '../lib/time';
import { logger } from '../lib/logger';

const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(99).default(1),
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  count: z.number().int().min(1).max(1000).nullable().optional()
});

const eventSchema = z.object({
  calendarId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).optional().default(''),
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  allDay: z.boolean().optional().default(false),
  timezone: z.string().max(80).optional(),
  location: z.string().max(300).nullable().optional(),
  url: z.string().max(1000).nullable().optional(),
  priority: z.number().int().min(0).max(5).nullable().optional(),
  visibility: z.string().max(30).optional(),
  categoryId: z.string().nullable().optional(),
  participantIds: z.array(z.string()).max(200).optional().default([]),
  recurrence: recurrenceSchema.nullable().optional(),
  force: z.boolean().optional()
});

const updateSchema = eventSchema.partial().extend({
  scope: z.enum(['series', 'occurrence']).optional(),
  occurrenceStart: z.string().max(40).optional()
});

const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function buildRule(
  recurrence: z.infer<typeof recurrenceSchema> | null | undefined
): { rrule: string | null; until: string | null } {
  if (!recurrence) return { rrule: null, until: null };
  const parts = [
    `FREQ=${recurrence.frequency.toUpperCase()}`,
    `INTERVAL=${recurrence.interval}`
  ];
  if (recurrence.byWeekday && recurrence.byWeekday.length > 0 && recurrence.frequency === 'weekly') {
    parts.push(`BYDAY=${recurrence.byWeekday.map((d) => weekdays[d]).join(',')}`);
  }
  if (recurrence.count) {
    parts.push(`COUNT=${recurrence.count}`);
  } else if (recurrence.until) {
    parts.push(`UNTIL=${recurrence.until.replace(/-/g, '')}T235959Z`);
  }
  return { rrule: parts.join(';'), until: recurrence.until ?? null };
}

function validateEventInput(
  body: z.infer<typeof eventSchema>,
  allowHtml: boolean
): {
  start: string;
  end: string;
  description: string;
  location: string | null;
  url: string | null;
} {
  const start = body.allDay ? body.start.slice(0, 10) : new Date(body.start).toISOString();
  const end = body.allDay ? body.end.slice(0, 10) : new Date(body.end).toISOString();
  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
    throw new HttpError(400, 'invalid_dates');
  }
  if (body.allDay) {
    if (end < start) throw new HttpError(400, 'end_before_start');
  } else if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new HttpError(400, 'end_before_start');
  }
  if (body.url && !isValidHttpUrl(body.url)) throw new HttpError(400, 'invalid_url');
  return {
    start,
    end,
    description: cleanDescription(body.description, allowHtml),
    location: body.location ?? null,
    url: body.url ?? null
  };
}

function ensureNoConflicts(db: any, event: EventRow, excludeEventId?: string) {
  const result = findEventConflicts(db, event, excludeEventId);
  if (result.total === 0) return;
  throw new HttpError(409, 'event_conflict', undefined, {
    conflicts: result.conflicts,
    total: result.total
  });
}

function replaceParticipants(db: any, eventId: string, participantIds: string[]) {
  db.prepare('DELETE FROM event_participants WHERE event_id = ?').run(eventId);
  const insert = db.prepare('INSERT OR IGNORE INTO event_participants (event_id, user_id) VALUES (?, ?)');
  const check = db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1');
  for (const userId of participantIds) {
    if (check.get(userId)) insert.run(eventId, userId);
  }
}

function eventToApi(
  db: any,
  event: EventRow,
  occurrenceId: string,
  participants: string[]
) {
  const category = categoryInfo(db, event.category_id);
  return {
    id: occurrenceId,
    eventId: event.id,
    uid: event.uid,
    title: event.title,
    description: event.description,
    start: event.start_at,
    end: event.end_at,
    allDay: Boolean(event.all_day),
    timezone: event.timezone,
    location: event.location,
    url: event.url,
    priority: event.priority,
    visibility: event.visibility,
    categoryId: event.category_id,
    categoryName: category.name,
    categoryColor: category.color,
    calendarId: event.calendar_id,
    ownerId: event.owner_id,
    createdBy: event.created_by,
    rrule: event.rrule,
    recurrenceUntil: event.recurrence_until,
    sequence: event.sequence,
    status: event.status,
    deletedAt: event.deleted_at ?? null,
    deletedBy: event.deleted_by ?? null,
    participantIds: participants,
    createdAt: event.created_at,
    updatedAt: event.updated_at
  };
}

function displayName(first: string | null, last: string | null, username: string | null): string {
  const full = `${first ?? ''} ${last ?? ''}`.trim();
  return full || username || '';
}

function userDisplayName(db: any, userId: string | null | undefined): string {
  if (!userId) return '';
  const row = db
    .prepare('SELECT username, first_name, last_name FROM users WHERE id = ?')
    .get(userId) as { username: string; first_name: string; last_name: string } | undefined;
  return row ? displayName(row.first_name, row.last_name, row.username) : '';
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

const HISTORY_LIMIT = 50;

function eventHistory(db: any, eventId: string) {
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.details, a.created_at,
              u.username, u.first_name, u.last_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity = 'event' AND a.entity_id = ?
       ORDER BY a.created_at DESC, a.rowid DESC
       LIMIT ?`
    )
    .all(eventId, HISTORY_LIMIT) as {
    id: string;
    action: string;
    details: string | null;
    created_at: string;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
  }[];
  return rows.map((row) => {
    const details = parseDetails(row.details);
    const fields = Array.isArray(details.fields)
      ? details.fields.filter((field): field is string => typeof field === 'string')
      : [];
    return {
      id: row.id,
      action: row.action.replace('event.', ''),
      createdAt: row.created_at,
      actorName: displayName(row.first_name, row.last_name, row.username),
      fields,
      scope: typeof details.scope === 'string' ? details.scope : null
    };
  });
}

function changedEventFields(
  before: EventRow,
  after: EventRow,
  participantsBefore: string[],
  participantsAfter: string[]
): string[] {
  const fields: string[] = [];
  if (before.title !== after.title) fields.push('title');
  if ((before.description ?? '') !== (after.description ?? '')) fields.push('description');
  if (before.start_at !== after.start_at) fields.push('start');
  if (before.end_at !== after.end_at) fields.push('end');
  if (before.all_day !== after.all_day) fields.push('allDay');
  if (before.timezone !== after.timezone) fields.push('timezone');
  if ((before.location ?? '') !== (after.location ?? '')) fields.push('location');
  if ((before.url ?? '') !== (after.url ?? '')) fields.push('url');
  if (before.priority !== after.priority) fields.push('priority');
  if (before.visibility !== after.visibility) fields.push('visibility');
  if ((before.category_id ?? '') !== (after.category_id ?? '')) fields.push('category');
  if (
    (before.rrule ?? '') !== (after.rrule ?? '') ||
    (before.recurrence_until ?? '') !== (after.recurrence_until ?? '')
  ) {
    fields.push('recurrence');
  }
  if (before.calendar_id !== after.calendar_id) fields.push('calendar');
  const beforeParticipants = new Set(participantsBefore);
  const afterParticipants = new Set(participantsAfter);
  if (
    beforeParticipants.size !== afterParticipants.size ||
    Array.from(afterParticipants).some((id) => !beforeParticipants.has(id))
  ) {
    fields.push('participants');
  }
  return fields;
}

const OVERRIDE_FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  start: 'start',
  end: 'end',
  allDay: 'allDay',
  location: 'location',
  url: 'url',
  priority: 'priority',
  visibility: 'visibility',
  categoryId: 'category'
};

function overrideChangedFields(override: Record<string, unknown>): string[] {
  return Object.keys(override)
    .map((key) => OVERRIDE_FIELD_LABELS[key])
    .filter((field): field is string => Boolean(field));
}

function calendarColor(db: any, calendarId: string): string {
  const row = db.prepare('SELECT color FROM calendars WHERE id = ?').get(calendarId) as
    | { color: string }
    | undefined;
  return row?.color ?? '#2f6feb';
}

function calendarInfo(db: any, calendarId: string): { name: string | null; color: string } {
  const row = db.prepare('SELECT name, color FROM calendars WHERE id = ?').get(calendarId) as
    | { name: string; color: string }
    | undefined;
  return { name: row?.name ?? null, color: row?.color ?? '#2f6feb' };
}

function categoryInfo(db: any, categoryId: string | null): { color: string | null; name: string | null } {
  if (!categoryId) return { color: null, name: null };
  const row = db.prepare('SELECT name, color FROM categories WHERE id = ?').get(categoryId) as
    | { name: string; color: string }
    | undefined;
  return { color: row?.color ?? null, name: row?.name ?? null };
}

function plainDescription(value: string): string {
  return cleanDescription(value, false)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

const SEARCH_LIMIT = 200;

export function eventRoutes(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const startParam = String(req.query.start ?? '');
      const endParam = String(req.query.end ?? '');
      if (!startParam || !endParam) throw new HttpError(400, 'start_end_required');
      const from = new Date(startParam);
      const to = new Date(endParam);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new HttpError(400, 'invalid_range');
      }
      const calendarIds = req.query.calendarIds
        ? String(req.query.calendarIds).split(',').filter(Boolean)
        : null;
      const userIds = req.query.userIds
        ? String(req.query.userIds).split(',').filter(Boolean)
        : null;

      let rows = req.db.prepare('SELECT * FROM events WHERE status <> ?').all('cancelled') as EventRow[];
      if (calendarIds) rows = rows.filter((e) => calendarIds.includes(e.calendar_id));
      if (userIds) rows = rows.filter((e) => userIds.includes(e.owner_id));
      rows = rows.filter((e) => canViewEvent(req.db, user, e));

      const eventIds = rows.map((e) => e.id);
      const exceptionRows: ExceptionRow[] =
        eventIds.length > 0
          ? (req.db
              .prepare(
                `SELECT * FROM event_exceptions WHERE event_id IN (${eventIds.map(() => '?').join(',')})`
              )
              .all(...eventIds) as ExceptionRow[])
          : [];
      const exceptionsByEvent = new Map<string, ExceptionRow[]>();
      for (const exception of exceptionRows) {
        const list = exceptionsByEvent.get(exception.event_id) ?? [];
        list.push(exception);
        exceptionsByEvent.set(exception.event_id, list);
      }
      const participantRows: { event_id: string; user_id: string }[] =
        eventIds.length > 0
          ? (req.db
              .prepare(
                `SELECT event_id, user_id FROM event_participants WHERE event_id IN (${eventIds.map(() => '?').join(',')})`
              )
              .all(...eventIds) as { event_id: string; user_id: string }[])
          : [];
      const participantsByEvent = new Map<string, string[]>();
      for (const row of participantRows) {
        const list = participantsByEvent.get(row.event_id) ?? [];
        list.push(row.user_id);
        participantsByEvent.set(row.event_id, list);
      }

      const result = [] as Record<string, unknown>[];
      for (const event of rows) {
        const occurrences = expandEvent(
          event,
          exceptionsByEvent.get(event.id) ?? [],
          from,
          to
        );
        const color = calendarColor(req.db, event.calendar_id);
        const category = categoryInfo(req.db, event.category_id);
        const editable = canEditEvent(req.db, user, event);
        const deletable = canDeleteEvent(req.db, user, event);
        for (const occurrence of occurrences) {
          result.push({
            id: occurrence.id,
            eventId: occurrence.eventId,
            uid: occurrence.uid,
            title: occurrence.title,
            description: occurrence.description,
            start: occurrence.start,
            end: occurrence.end,
            allDay: occurrence.allDay,
            timezone: occurrence.timezone,
            location: occurrence.location,
            url: occurrence.url,
            priority: occurrence.priority,
            visibility: occurrence.visibility,
            categoryId: occurrence.categoryId,
            categoryName: category.name,
            categoryColor: category.color,
            calendarId: occurrence.calendarId,
            calendarColor: color,
            ownerId: occurrence.ownerId,
            participantIds: participantsByEvent.get(event.id) ?? [],
            rrule: occurrence.rrule,
            recurring: occurrence.recurring,
            occurrenceStart: occurrence.occurrenceStart,
            isException: occurrence.isException,
            sequence: occurrence.sequence,
            status: occurrence.status,
            editable,
            deletable
          });
        }
      }
      result.sort((a, b) => String(a.start).localeCompare(String(b.start)));
      res.json(result);
    })
  );

  router.get(
    '/search',
    asyncHandler(async (req, res) => {
      const query = String(req.query.q ?? '').trim();
      if (!query) {
        res.json({ total: 0, results: [] });
        return;
      }
      const needle = query.toLocaleLowerCase();
      const rows = req.db.prepare('SELECT * FROM events WHERE status <> ?').all('cancelled') as EventRow[];
      const matches = rows.filter((event) => {
        const description = plainDescription(event.description);
        const matchesQuery =
          event.title.toLocaleLowerCase().includes(needle) ||
          description.toLocaleLowerCase().includes(needle);
        return matchesQuery && canViewEvent(req.db, req.user!, event);
      });
      matches.sort(
        (a, b) =>
          b.start_at.localeCompare(a.start_at) || b.updated_at.localeCompare(a.updated_at)
      );
      const limited = matches.slice(0, SEARCH_LIMIT);
      const eventIds = limited.map((event) => event.id);
      const participantRows: { event_id: string; first_name: string; last_name: string; username: string }[] =
        eventIds.length > 0
          ? (req.db
              .prepare(
                `SELECT ep.event_id, u.first_name, u.last_name, u.username
                 FROM event_participants ep
                 JOIN users u ON u.id = ep.user_id
                 WHERE ep.event_id IN (${eventIds.map(() => '?').join(',')})
                 ORDER BY u.first_name, u.last_name, u.username`
              )
              .all(...eventIds) as {
              event_id: string;
              first_name: string;
              last_name: string;
              username: string;
            }[])
          : [];
      const participantsByEvent = new Map<string, string[]>();
      for (const row of participantRows) {
        const name = `${row.first_name} ${row.last_name}`.trim() || row.username;
        const list = participantsByEvent.get(row.event_id) ?? [];
        list.push(name);
        participantsByEvent.set(row.event_id, list);
      }
      const results = limited.map((event) => {
        const category = categoryInfo(req.db, event.category_id);
        const calendar = calendarInfo(req.db, event.calendar_id);
        return {
          id: event.id,
          title: event.title,
          description: plainDescription(event.description),
          start: event.start_at,
          end: event.end_at,
          allDay: Boolean(event.all_day),
          timezone: event.timezone,
          calendarName: calendar.name,
          calendarColor: calendar.color,
          categoryName: category.name,
          categoryColor: category.color,
          participants: participantsByEvent.get(event.id) ?? []
        };
      });
      res.json({ total: matches.length, results });
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = parseEventOccurrenceId(req.params.id);
      const event = req.db.prepare('SELECT * FROM events WHERE id = ?').get(parsed.eventId) as
        | EventRow
        | undefined;
      if (!event) throw new HttpError(404, 'event_not_found');
      if (!canViewEvent(req.db, req.user!, event)) throw new HttpError(403, 'forbidden');
      const participants = (
        req.db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      const exceptions = req.db
        .prepare('SELECT * FROM event_exceptions WHERE event_id = ?')
        .all(event.id) as ExceptionRow[];
      const deleted = Boolean(event.deleted_at);
      const history = eventHistory(req.db, event.id);
      const createdByName = userDisplayName(req.db, event.created_by);
      const lastUpdate = history.find((entry) => entry.action === 'updated');
      res.json({
        event: {
          ...eventToApi(req.db, event, eventOccurrenceId(event.id, event.start_at), participants),
          createdByName,
          updatedByName: lastUpdate?.actorName ?? ''
        },
        exceptions,
        history,
        editable: !deleted && canEditEvent(req.db, req.user!, event),
        deletable: !deleted && canDeleteEvent(req.db, req.user!, event)
      });
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = eventSchema.parse(req.body);
      const settings = new SettingsStore(req.db).get();
      const access = calendarAccess(req.db, req.user!, body.calendarId);
      if (!access) throw new HttpError(404, 'calendar_not_found');
      if (!access.canCreate) throw new HttpError(403, 'forbidden');
      const calendar = access.calendar;
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      const validated = validateEventInput(body, settings.allowHtmlDescription);
      if (body.categoryId) {
        const exists = req.db.prepare('SELECT 1 FROM categories WHERE id = ?').get(body.categoryId);
        if (!exists) throw new HttpError(400, 'category_not_found');
      }
      const rule = buildRule(body.recurrence);
      const id = newId();
      const now = nowIso();
      const timezone = body.allDay
        ? 'UTC'
        : body.timezone || req.user!.timezone || settings.defaultTimezone;
      const ownerId = calendar.owner_id;
      if (!body.force) {
        ensureNoConflicts(req.db, {
          id,
          uid: `${id}@teamcal`,
          calendar_id: calendar.id,
          owner_id: ownerId,
          created_by: req.user!.id,
          title: body.title,
          description: validated.description,
          start_at: validated.start,
          end_at: validated.end,
          all_day: body.allDay ? 1 : 0,
          timezone,
          location: validated.location,
          url: validated.url,
          priority: body.priority ?? null,
          visibility: body.visibility ?? 'default',
          category_id: body.categoryId ?? null,
          rrule: rule.rrule,
          recurrence_until: rule.until,
          sequence: 0,
          status: 'confirmed',
          created_at: now,
          updated_at: now
        });
      }
      req.db.transaction(() => {
        req.db
          .prepare(
            `INSERT INTO events (id, uid, calendar_id, owner_id, created_by, title, description, start_at, end_at,
               all_day, timezone, location, url, priority, visibility, category_id, rrule, recurrence_until,
               sequence, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'confirmed', ?, ?)`
          )
          .run(
            id,
            `${id}@teamcal`,
            calendar.id,
            ownerId,
            req.user!.id,
            body.title,
            validated.description,
            validated.start,
            validated.end,
            body.allDay ? 1 : 0,
            timezone,
            validated.location,
            validated.url,
            body.priority ?? null,
            body.visibility ?? 'default',
            body.categoryId ?? null,
            rule.rrule,
            rule.until,
            now,
            now
          );
        replaceParticipants(req.db, id, body.participantIds);
      })();
      const event = req.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow;
      audit(req.db, {
        userId: req.user!.id,
        action: 'event.created',
        entity: 'event',
        entityId: id,
        details: { title: body.title, calendarId: calendar.id },
        ip: req.ip
      });
      logger.info('event_saved', {
        eventId: event.id,
        start: event.start_at,
        end: event.end_at,
        timezone: event.timezone,
        requestedStart: validated.start,
        requestedTimezone: body.timezone,
        userTimezone: req.user!.timezone,
        calendarId: event.calendar_id,
        userId: req.user!.id
      });
      notifyEvent(req.db, settings, event, 'created').catch((error) =>
        logger.error('notify_failed', { error: error instanceof Error ? error.message : String(error) })
      );
      const participants = (
        req.db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      res.status(201).json(eventToApi(req.db, event, eventOccurrenceId(id, event.start_at), participants));
    })
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const body = updateSchema.parse(req.body);
      const parsed = parseEventOccurrenceId(req.params.id);
      const event = req.db.prepare('SELECT * FROM events WHERE id = ?').get(parsed.eventId) as
        | EventRow
        | undefined;
      if (!event) throw new HttpError(404, 'event_not_found');
      if (event.status === 'cancelled' || event.deleted_at) throw new HttpError(409, 'event_deleted');
      if (!canEditEvent(req.db, req.user!, event)) throw new HttpError(403, 'forbidden');
      const settings = new SettingsStore(req.db).get();
      const occurrenceStart = body.occurrenceStart ?? parsed.occurrenceStart;

      if (event.rrule && body.scope === 'occurrence') {
        if (!occurrenceStart) throw new HttpError(400, 'occurrence_start_required');
        const existing = req.db
          .prepare('SELECT * FROM event_exceptions WHERE event_id = ? AND occurrence_start = ?')
          .get(event.id, occurrenceStart) as ExceptionRow | undefined;
        const override: Record<string, unknown> = existing?.override_json
          ? JSON.parse(existing.override_json)
          : {};
        if (body.title !== undefined) override.title = body.title;
        if (body.description !== undefined) {
          override.description = cleanDescription(body.description, settings.allowHtmlDescription);
        }
        if (body.start !== undefined) {
          override.start = body.allDay ? body.start.slice(0, 10) : new Date(body.start).toISOString();
        }
        if (body.end !== undefined) {
          override.end = body.allDay ? body.end.slice(0, 10) : new Date(body.end).toISOString();
        }
        if (body.location !== undefined) override.location = body.location;
        if (body.url !== undefined) {
          if (body.url && !isValidHttpUrl(body.url)) throw new HttpError(400, 'invalid_url');
          override.url = body.url;
        }
        if (body.priority !== undefined) override.priority = body.priority;
        if (body.visibility !== undefined) override.visibility = body.visibility;
        if (body.categoryId !== undefined) override.categoryId = body.categoryId;
        if (body.allDay !== undefined) override.allDay = body.allDay;
        if (
          !body.force &&
          (body.start !== undefined || body.end !== undefined || body.allDay !== undefined)
        ) {
          const eventExceptions = req.db
            .prepare('SELECT * FROM event_exceptions WHERE event_id = ?')
            .all(event.id) as ExceptionRow[];
          const around = new Date(occurrenceStart);
          const occurrence = expandEvent(
            event,
            eventExceptions,
            around,
            new Date(around.getTime() + 60000),
            10
          ).find((entry) => entry.occurrenceStart === occurrenceStart);
          ensureNoConflicts(
            req.db,
            {
              ...event,
              start_at: String(override.start ?? occurrence?.start ?? event.start_at),
              end_at: String(override.end ?? occurrence?.end ?? event.end_at),
              all_day:
                override.allDay !== undefined
                  ? override.allDay
                    ? 1
                    : 0
                  : occurrence
                    ? occurrence.allDay
                      ? 1
                      : 0
                    : event.all_day,
              rrule: null,
              recurrence_until: null
            },
            event.id
          );
        }
        req.db.transaction(() => {
          if (existing) {
            req.db
              .prepare(
                'UPDATE event_exceptions SET action = ?, override_json = ?, updated_at = ? WHERE id = ?'
              )
              .run('modified', JSON.stringify(override), nowIso(), existing.id);
          } else {
            req.db
              .prepare(
                `INSERT INTO event_exceptions (id, event_id, occurrence_start, action, override_json, created_at, updated_at)
                 VALUES (?, ?, ?, 'modified', ?, ?, ?)`
              )
              .run(newId(), event.id, occurrenceStart, JSON.stringify(override), nowIso(), nowIso());
          }
          req.db
            .prepare('UPDATE events SET sequence = sequence + 1, updated_at = ? WHERE id = ?')
            .run(nowIso(), event.id);
        })();
        const updated = req.db.prepare('SELECT * FROM events WHERE id = ?').get(event.id) as EventRow;
        audit(req.db, {
          userId: req.user!.id,
          action: 'event.updated',
          entity: 'event',
          entityId: event.id,
          details: {
            title: updated.title,
            calendarId: updated.calendar_id,
            scope: 'occurrence',
            occurrenceStart,
            fields: overrideChangedFields({
              ...(body.title !== undefined ? { title: body.title } : {}),
              ...(body.description !== undefined ? { description: body.description } : {}),
              ...(body.start !== undefined ? { start: body.start } : {}),
              ...(body.end !== undefined ? { end: body.end } : {}),
              ...(body.location !== undefined ? { location: body.location } : {}),
              ...(body.url !== undefined ? { url: body.url } : {}),
              ...(body.priority !== undefined ? { priority: body.priority } : {}),
              ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
              ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
              ...(body.allDay !== undefined ? { allDay: body.allDay } : {})
            })
          },
          ip: req.ip
        });
        notifyEvent(req.db, settings, updated, 'updated').catch(() => undefined);
        res.json({ ok: true, scope: 'occurrence', occurrenceStart });
        return;
      }

      const merged = {
        calendarId: body.calendarId ?? event.calendar_id,
        title: body.title ?? event.title,
        description: body.description ?? event.description,
        start: body.start ?? event.start_at,
        end: body.end ?? event.end_at,
        allDay: body.allDay ?? Boolean(event.all_day),
        timezone: body.timezone ?? event.timezone,
        location: body.location !== undefined ? body.location : event.location,
        url: body.url !== undefined ? body.url : event.url,
        priority: body.priority !== undefined ? body.priority : event.priority,
        visibility: body.visibility ?? event.visibility,
        categoryId: body.categoryId !== undefined ? body.categoryId : event.category_id,
        participantIds: body.participantIds,
        recurrence:
          body.recurrence !== undefined
            ? body.recurrence
            : event.rrule
              ? undefined
              : null
      };
      const access = calendarAccess(req.db, req.user!, merged.calendarId);
      if (!access) throw new HttpError(404, 'calendar_not_found');
      if (!access.canEdit) throw new HttpError(403, 'forbidden');
      if (body.timezone && !isValidTimeZone(body.timezone)) throw new HttpError(400, 'invalid_timezone');
      const validated = validateEventInput(merged as z.infer<typeof eventSchema>, settings.allowHtmlDescription);
      if (merged.categoryId) {
        const exists = req.db.prepare('SELECT 1 FROM categories WHERE id = ?').get(merged.categoryId);
        if (!exists) throw new HttpError(400, 'category_not_found');
      }
      let rrule = event.rrule;
      let recurrenceUntil = event.recurrence_until;
      if (body.recurrence !== undefined) {
        const rule = buildRule(body.recurrence);
        rrule = rule.rrule;
        recurrenceUntil = rule.until;
      }
      const timezone = merged.allDay
        ? 'UTC'
        : merged.timezone || settings.defaultTimezone;
      const timingChanged =
        validated.start !== event.start_at ||
        validated.end !== event.end_at ||
        (merged.allDay ? 1 : 0) !== event.all_day ||
        merged.calendarId !== event.calendar_id ||
        rrule !== event.rrule ||
        (recurrenceUntil ?? null) !== (event.recurrence_until ?? null);
      if (timingChanged && !body.force) {
        ensureNoConflicts(
          req.db,
          {
            ...event,
            calendar_id: merged.calendarId,
            owner_id: access.calendar.owner_id,
            start_at: validated.start,
            end_at: validated.end,
            all_day: merged.allDay ? 1 : 0,
            timezone,
            rrule,
            recurrence_until: recurrenceUntil
          },
          event.id
        );
      }
      const participantsBefore = (
        req.db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      req.db.transaction(() => {
        req.db
          .prepare(
            `UPDATE events SET calendar_id = ?, owner_id = ?, title = ?, description = ?, start_at = ?, end_at = ?,
               all_day = ?, timezone = ?, location = ?, url = ?, priority = ?, visibility = ?,
               category_id = ?, rrule = ?, recurrence_until = ?, sequence = sequence + 1, updated_at = ?
             WHERE id = ?`
          )
          .run(
            merged.calendarId,
            access.calendar.owner_id,
            merged.title,
            validated.description,
            validated.start,
            validated.end,
            merged.allDay ? 1 : 0,
            timezone,
            validated.location,
            validated.url,
            merged.priority ?? null,
            merged.visibility,
            merged.categoryId ?? null,
            rrule,
            recurrenceUntil,
            nowIso(),
            event.id
          );
        if (body.participantIds !== undefined) {
          replaceParticipants(req.db, event.id, body.participantIds);
        }
      })();
      const updated = req.db.prepare('SELECT * FROM events WHERE id = ?').get(event.id) as EventRow;
      const participants = (
        req.db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      audit(req.db, {
        userId: req.user!.id,
        action: 'event.updated',
        entity: 'event',
        entityId: event.id,
        details: {
          title: updated.title,
          calendarId: updated.calendar_id,
          scope: 'series',
          fields: changedEventFields(event, updated, participantsBefore, participants)
        },
        ip: req.ip
      });
      notifyEvent(req.db, settings, updated, 'updated').catch(() =>
        logger.error('notify_failed', { eventId: event.id })
      );
      res.json(eventToApi(req.db, updated, eventOccurrenceId(updated.id, updated.start_at), participants));
    })
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const parsed = parseEventOccurrenceId(req.params.id);
      const event = req.db.prepare('SELECT * FROM events WHERE id = ?').get(parsed.eventId) as
        | EventRow
        | undefined;
      if (!event) throw new HttpError(404, 'event_not_found');
      if (event.status === 'cancelled' || event.deleted_at) throw new HttpError(409, 'event_deleted');
      if (!canDeleteEvent(req.db, req.user!, event)) throw new HttpError(403, 'forbidden');
      const settings = new SettingsStore(req.db).get();
      const scope = req.query.scope === 'occurrence' ? 'occurrence' : 'series';
      const occurrenceStart = String(req.query.occurrenceStart ?? parsed.occurrenceStart ?? '');

      if (event.rrule && scope === 'occurrence') {
        if (!occurrenceStart) throw new HttpError(400, 'occurrence_start_required');
        const existing = req.db
          .prepare('SELECT * FROM event_exceptions WHERE event_id = ? AND occurrence_start = ?')
          .get(event.id, occurrenceStart) as ExceptionRow | undefined;
        req.db.transaction(() => {
          if (existing) {
            req.db
              .prepare(
                "UPDATE event_exceptions SET action = 'cancelled', override_json = NULL, updated_at = ? WHERE id = ?"
              )
              .run(nowIso(), existing.id);
          } else {
            req.db
              .prepare(
                `INSERT INTO event_exceptions (id, event_id, occurrence_start, action, created_at, updated_at)
                 VALUES (?, ?, ?, 'cancelled', ?, ?)`
              )
              .run(newId(), event.id, occurrenceStart, nowIso(), nowIso());
          }
          req.db
            .prepare('UPDATE events SET sequence = sequence + 1, updated_at = ? WHERE id = ?')
            .run(nowIso(), event.id);
        })();
        const updated = req.db.prepare('SELECT * FROM events WHERE id = ?').get(event.id) as EventRow;
        audit(req.db, {
          userId: req.user!.id,
          action: 'event.deleted',
          entity: 'event',
          entityId: event.id,
          details: {
            title: updated.title,
            calendarId: updated.calendar_id,
            scope: 'occurrence',
            occurrenceStart
          },
          ip: req.ip
        });
        notifyEvent(req.db, settings, updated, 'cancelled').catch(() => undefined);
        res.json({ ok: true, scope: 'occurrence' });
        return;
      }

      const participants = (
        req.db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      const deletedAt = nowIso();
      req.db.transaction(() => {
        req.db
          .prepare(
            `UPDATE events
             SET status = 'cancelled', deleted_at = ?, deleted_by = ?, sequence = sequence + 1, updated_at = ?
             WHERE id = ?`
          )
          .run(deletedAt, req.user!.id, deletedAt, event.id);
      })();
      const cancelled = req.db.prepare('SELECT * FROM events WHERE id = ?').get(event.id) as EventRow;
      audit(req.db, {
        userId: req.user!.id,
        action: 'event.deleted',
        entity: 'event',
        entityId: event.id,
        details: {
          title: event.title,
          calendarId: event.calendar_id,
          scope: 'series',
          participants
        },
        ip: req.ip
      });
      notifyEvent(req.db, settings, cancelled, 'cancelled', participants).catch(() =>
        logger.error('notify_failed', { eventId: event.id })
      );
      res.json({ ok: true, scope: 'series' });
    })
  );

  return router;
}
