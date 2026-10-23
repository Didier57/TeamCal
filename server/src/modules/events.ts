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
  recurrence: recurrenceSchema.nullable().optional()
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
    calendarId: event.calendar_id,
    ownerId: event.owner_id,
    createdBy: event.created_by,
    rrule: event.rrule,
    recurrenceUntil: event.recurrence_until,
    sequence: event.sequence,
    status: event.status,
    participantIds: participants
  };
}

function calendarColor(db: any, calendarId: string): string {
  const row = db.prepare('SELECT color FROM calendars WHERE id = ?').get(calendarId) as
    | { color: string }
    | undefined;
  return row?.color ?? '#2f6feb';
}

function categoryInfo(db: any, categoryId: string | null): { color: string | null; name: string | null } {
  if (!categoryId) return { color: null, name: null };
  const row = db.prepare('SELECT name, color FROM categories WHERE id = ?').get(categoryId) as
    | { name: string; color: string }
    | undefined;
  return { color: row?.color ?? null, name: row?.name ?? null };
}

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
      res.json({
        event: eventToApi(req.db, event, eventOccurrenceId(event.id, event.start_at), participants),
        exceptions,
        editable: canEditEvent(req.db, req.user!, event),
        deletable: canDeleteEvent(req.db, req.user!, event)
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
      req.db.transaction(() => {
        req.db
          .prepare(
            `UPDATE events SET calendar_id = ?, title = ?, description = ?, start_at = ?, end_at = ?,
               all_day = ?, timezone = ?, location = ?, url = ?, priority = ?, visibility = ?,
               category_id = ?, rrule = ?, recurrence_until = ?, sequence = sequence + 1, updated_at = ?
             WHERE id = ?`
          )
          .run(
            merged.calendarId,
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
        details: { title: updated.title },
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
        notifyEvent(req.db, settings, updated, 'cancelled').catch(() => undefined);
        res.json({ ok: true, scope: 'occurrence' });
        return;
      }

      const participants = (
        req.db.prepare('SELECT user_id FROM event_participants WHERE event_id = ?').all(event.id) as {
          user_id: string;
        }[]
      ).map((r) => r.user_id);
      const cancelled: EventRow = { ...event, sequence: event.sequence + 1, status: 'cancelled' };
      req.db.transaction(() => {
        req.db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
      })();
      audit(req.db, {
        userId: req.user!.id,
        action: 'event.deleted',
        entity: 'event',
        entityId: event.id,
        details: { title: event.title, participants },
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
