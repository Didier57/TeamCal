import type { DB } from '../db';
import type { EventRow } from './permissions';
import { expandEvent, type ExceptionRow, type Occurrence } from './recurrence';
import { addDays, dateKeyInZone } from './time';

export interface EventConflict {
  eventId: string;
  occurrenceStart: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export interface EventConflictResult {
  conflicts: EventConflict[];
  total: number;
}

const DAY_MS = 86400000;
const MAX_LISTED = 10;
const MAX_OCCURRENCES = 2000;
const RECURRENCE_HORIZON_DAYS = 5 * 365;

function eventStartMs(event: EventRow): number {
  return event.all_day
    ? Date.parse(`${event.start_at.slice(0, 10)}T00:00:00Z`)
    : new Date(event.start_at).getTime();
}

function eventEndMs(event: EventRow): number {
  return event.all_day
    ? Date.parse(`${addDays(event.end_at.slice(0, 10), 1)}T00:00:00Z`)
    : new Date(event.end_at).getTime();
}

function detectionWindow(event: EventRow): { from: Date; to: Date } {
  const start = eventStartMs(event);
  const end = eventEndMs(event);
  if (!event.rrule) {
    return { from: new Date(start - DAY_MS), to: new Date(end + DAY_MS) };
  }
  const to = event.recurrence_until
    ? new Date(Date.parse(`${addDays(event.recurrence_until.slice(0, 10), 1)}T00:00:00Z`))
    : new Date(start + RECURRENCE_HORIZON_DAYS * DAY_MS);
  return { from: new Date(start - DAY_MS), to };
}

function overlaps(a: Occurrence, b: Occurrence): boolean {
  if (a.allDay || b.allDay) {
    if (a.allDay && b.allDay) {
      return a.start.slice(0, 10) <= b.end.slice(0, 10) && b.start.slice(0, 10) <= a.end.slice(0, 10);
    }
    const allDay = a.allDay ? a : b;
    const timed = a.allDay ? b : a;
    const timezone = timed.timezone || 'UTC';
    const startKey = dateKeyInZone(new Date(timed.start), timezone);
    const timedEnd = Math.max(new Date(timed.end).getTime() - 1000, new Date(timed.start).getTime());
    const endKey = dateKeyInZone(new Date(timedEnd), timezone);
    return allDay.start.slice(0, 10) <= endKey && startKey <= allDay.end.slice(0, 10);
  }
  return new Date(a.start).getTime() < new Date(b.end).getTime() &&
    new Date(b.start).getTime() < new Date(a.end).getTime();
}

function exceptionsFor(db: DB, eventId: string): ExceptionRow[] {
  return db.prepare('SELECT * FROM event_exceptions WHERE event_id = ?').all(eventId) as ExceptionRow[];
}

export function findEventConflicts(
  db: DB,
  event: EventRow,
  excludeEventId?: string
): EventConflictResult {
  const window = detectionWindow(event);
  const targetOccurrences = expandEvent(
    event,
    exceptionsFor(db, event.id),
    window.from,
    window.to,
    MAX_OCCURRENCES
  );
  if (targetOccurrences.length === 0) return { conflicts: [], total: 0 };

  const candidates = db
    .prepare(
      `SELECT * FROM events
       WHERE calendar_id = ? AND status <> 'cancelled' AND id <> ?
       ORDER BY start_at`
    )
    .all(event.calendar_id, excludeEventId ?? '') as EventRow[];

  const seen = new Set<string>();
  const conflicts: EventConflict[] = [];
  let total = 0;

  for (const candidate of candidates) {
    const occurrences = expandEvent(
      candidate,
      exceptionsFor(db, candidate.id),
      window.from,
      window.to,
      MAX_OCCURRENCES
    );
    for (const occurrence of occurrences) {
      if (!targetOccurrences.some((target) => overlaps(target, occurrence))) continue;
      const key = occurrence.id;
      if (seen.has(key)) continue;
      seen.add(key);
      total += 1;
      if (conflicts.length < MAX_LISTED) {
        conflicts.push({
          eventId: occurrence.eventId,
          occurrenceStart: occurrence.occurrenceStart,
          title: occurrence.title,
          start: occurrence.start,
          end: occurrence.end,
          allDay: occurrence.allDay
        });
      }
    }
  }

  conflicts.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { conflicts, total };
}
