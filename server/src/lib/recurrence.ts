import { RRule } from 'rrule';
import type { EventRow } from './permissions';
import { utcAsWallClock, wallClockAsUtc } from './time';

export interface ExceptionRow {
  id: string;
  event_id: string;
  occurrence_start: string;
  action: string;
  override_json: string | null;
}

export interface Occurrence {
  id: string;
  eventId: string;
  uid: string;
  calendarId: string;
  ownerId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  location: string | null;
  url: string | null;
  priority: number | null;
  visibility: string;
  categoryId: string | null;
  rrule: string | null;
  recurring: boolean;
  occurrenceStart: string;
  isException: boolean;
  status: string;
  sequence: number;
}

export interface OverrideData {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  location?: string | null;
  url?: string | null;
  priority?: number | null;
  visibility?: string;
  categoryId?: string | null;
  allDay?: boolean;
}

export function eventOccurrenceId(eventId: string, start: string): string {
  return `${eventId}::${start}`;
}

export function parseEventOccurrenceId(value: string): { eventId: string; occurrenceStart?: string } {
  const index = value.indexOf('::');
  if (index === -1) return { eventId: value };
  return { eventId: value.slice(0, index), occurrenceStart: value.slice(index + 2) };
}

export function parseEventRdates(event: EventRow): string[] {
  if (!event.rdates) return [];
  try {
    const parsed = JSON.parse(event.rdates);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function baseOccurrence(event: EventRow): Occurrence {
  return {
    id: event.id,
    eventId: event.id,
    uid: event.uid,
    calendarId: event.calendar_id,
    ownerId: event.owner_id,
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
    rrule: event.rrule,
    recurring: Boolean(event.rrule || parseEventRdates(event).length),
    occurrenceStart: event.start_at,
    isException: false,
    status: event.status,
    sequence: event.sequence
  };
}

export function expandEvent(
  event: EventRow,
  exceptions: ExceptionRow[],
  from: Date,
  to: Date,
  limit = 2000
): Occurrence[] {
  if (event.status === 'cancelled') return [];
  const exceptionByStart = new Map(exceptions.map((e) => [e.occurrence_start, e]));
  const duration = new Date(event.end_at).getTime() - new Date(event.start_at).getTime();

  const rdates = parseEventRdates(event);
  if (!event.rrule && rdates.length === 0) {
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    if (end < from || start > to) return [];
    return [baseOccurrence(event)];
  }

  const timezone = event.timezone || 'UTC';
  const originalStarts: string[] = [];
  if (rdates.length > 0) {
    originalStarts.push(
      event.all_day
        ? `${event.start_at.slice(0, 10)}T00:00:00.000Z`
        : new Date(event.start_at).toISOString()
    );
  }
  if (event.rrule) {
    const startWall = wallClockAsUtc(new Date(event.start_at), timezone);
    let rule: RRule | null = null;
    try {
      rule = new RRule({
        ...RRule.parseString(event.rrule.replace(/^RRULE:/i, '')),
        dtstart: startWall
      });
    } catch {
      rule = null;
    }
    if (rule) {
      const fromWall = wallClockAsUtc(new Date(from.getTime() - 86400000), timezone);
      const toWall = wallClockAsUtc(new Date(to.getTime() + 86400000), timezone);
      for (const occurrence of rule.between(fromWall, toWall, true).slice(0, limit)) {
        originalStarts.push(utcAsWallClock(occurrence, timezone).toISOString());
      }
    }
  }
  for (const key of rdates) {
    const date = new Date(key);
    if (!Number.isNaN(date.getTime())) originalStarts.push(date.toISOString());
  }
  const result: Occurrence[] = [];
  for (const originalStart of [...new Set(originalStarts)].sort()) {
    const realStart = new Date(originalStart);
    const exception = exceptionByStart.get(originalStart);
    if (exception?.action === 'cancelled') continue;
    let start = realStart;
    let end = new Date(realStart.getTime() + duration);
    let data: Occurrence = {
      ...baseOccurrence(event),
      id: eventOccurrenceId(event.id, originalStart),
      start: start.toISOString(),
      end: end.toISOString(),
      occurrenceStart: originalStart,
      isException: Boolean(exception)
    };
    if (exception?.action === 'modified' && exception.override_json) {
      try {
        const override = JSON.parse(exception.override_json) as OverrideData;
        if (override.start) start = new Date(override.start);
        if (override.end) end = new Date(override.end);
        data = {
          ...data,
          start: start.toISOString(),
          end: end.toISOString(),
          title: override.title ?? data.title,
          description: override.description ?? data.description,
          location: override.location !== undefined ? override.location : data.location,
          url: override.url !== undefined ? override.url : data.url,
          priority: override.priority !== undefined ? override.priority : data.priority,
          visibility: override.visibility ?? data.visibility,
          categoryId: override.categoryId !== undefined ? override.categoryId : data.categoryId,
          allDay: override.allDay ?? data.allDay,
          isException: true
        };
      } catch {
        data.isException = false;
      }
    }
    if (end < from || start > to) continue;
    result.push(data);
  }
  return result;
}
