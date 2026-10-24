import { createHash } from 'node:crypto';
import type { DB } from '../db';
import type { EventRow } from './permissions';
import { cleanDescription, isValidHttpUrl } from './sanitize';
import { fromZonedParts, isValidTimeZone } from './time';
import { HttpError, newId, nowIso } from './util';

const DAY_MS = 86400000;
const MAX_EVENTS = 10000;

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface ParsedDate {
  date: Date;
  allDay: boolean;
  timezone: string;
}

export interface ParsedIcsEvent {
  uid: string | null;
  title: string;
  description: string;
  location: string | null;
  url: string | null;
  allDay: boolean;
  start: string;
  end: string;
  timezone: string;
  rrule: string | null;
  recurrenceUntil: string | null;
  categories: string[];
  exdates: string[];
  recurrenceId: string | null;
  recurrenceRange: string | null;
  status: string;
}

export interface IcsParseResult {
  events: ParsedIcsEvent[];
  warnings: string[];
}

export interface ImportIcsOptions {
  userId: string;
  content: string;
  createdBy: string;
  defaultCategoryId?: string | null;
  allowHtmlDescription: boolean;
}

export interface ImportIcsResult {
  imported: number;
  updated: number;
  skipped: number;
  exceptions: number;
  categoriesMatched: number;
  unmatchedCategories: string[];
  warnings: string[];
}

interface TargetRow {
  id: string;
  username: string;
  timezone: string | null;
  calendar_id: string;
}

const windowsTimeZones: Record<string, string> = {
  'Romance Standard Time': 'Europe/Paris',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kyiv',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago'
};

function splitOutsideQuotes(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === separator && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function propertyLine(line: string): IcsProperty | null {
  let quoted = false;
  let escaped = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ':' && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = splitOutsideQuotes(left, ';');
  const name = (parts.shift() ?? '').trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals <= 0) continue;
    params[part.slice(0, equals).trim().toUpperCase()] = unquote(part.slice(equals + 1));
  }
  return { name, params, value };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_match, char: string) => {
    if (char === 'n' || char === 'N') return '\n';
    return char;
  });
}

function splitValues(value: string): string[] {
  return splitOutsideQuotes(value, ',')
    .map((part) => unescapeText(part).trim())
    .filter(Boolean);
}

function resolveTimeZone(tzid: string | undefined, fallback: string): string {
  const raw = unquote(tzid ?? '');
  if (!raw) return fallback;
  if (isValidTimeZone(raw)) return raw;
  const stripped = raw.replace(/^\/+/, '');
  if (isValidTimeZone(stripped)) return stripped;
  const segments = stripped.split('/').filter(Boolean);
  for (let index = 0; index < segments.length - 1; index += 1) {
    const candidate = segments.slice(index).join('/');
    if (isValidTimeZone(candidate)) return candidate;
  }
  return windowsTimeZones[raw] ?? fallback;
}

function parseDateValue(
  value: string,
  params: Record<string, string>,
  fallbackTimezone: string
): ParsedDate | null {
  const raw = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(date.getTime())) return null;
    return { date, allDay: true, timezone: 'UTC' };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i.exec(raw);
  if (!dateTime) return null;
  const parts = {
    year: Number(dateTime[1]),
    month: Number(dateTime[2]),
    day: Number(dateTime[3]),
    hour: Number(dateTime[4]),
    minute: Number(dateTime[5]),
    second: Number(dateTime[6])
  };
  if (dateTime[7]) {
    const date = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    );
    return Number.isNaN(date.getTime()) ? null : { date, allDay: false, timezone: 'UTC' };
  }
  const timezone = resolveTimeZone(params.TZID, fallbackTimezone);
  const date = fromZonedParts(parts, timezone);
  return Number.isNaN(date.getTime()) ? null : { date, allDay: false, timezone };
}

function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase()
  );
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const weeks = Number(match[2] ?? 0);
  const days = Number(match[3] ?? 0);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);
  return sign * (((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60000 + seconds * 1000;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function occurrenceKey(parsed: ParsedDate, eventAllDay: boolean, eventTimezone: string): string {
  if (!parsed.allDay) return parsed.date.toISOString();
  if (eventAllDay) return `${dateOnly(parsed.date)}T00:00:00.000Z`;
  const key = dateOnly(parsed.date);
  const date = fromZonedParts(
    {
      year: Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      day: Number(key.slice(8, 10)),
      hour: 0,
      minute: 0,
      second: 0
    },
    eventTimezone
  );
  return date.toISOString();
}

function recurrenceUntil(rrule: string, timezone: string): string | null {
  const match = /(?:^|;)UNTIL=([^;]+)/i.exec(rrule);
  if (!match) return null;
  const parsed = parseDateValue(match[1], {}, timezone);
  if (!parsed) return null;
  return parsed.allDay ? dateOnly(parsed.date) : parsed.date.toISOString();
}

function sanitizeText(value: string, max: number): string {
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function parseEventLines(lines: string[], fallbackTimezone: string): ParsedIcsEvent | null {
  const props: IcsProperty[] = [];
  for (const line of lines) {
    const prop = propertyLine(line);
    if (prop) props.push(prop);
  }
  const first = (name: string) => props.find((prop) => prop.name === name);
  const all = (name: string) => props.filter((prop) => prop.name === name);
  const dtstart = first('DTSTART');
  if (!dtstart) return null;

  const startParsed = parseDateValue(dtstart.value, dtstart.params, fallbackTimezone);
  if (!startParsed) return null;

  const dtend = first('DTEND');
  const duration = first('DURATION');
  let endParsed: ParsedDate | null = null;
  if (dtend) endParsed = parseDateValue(dtend.value, dtend.params, fallbackTimezone);

  let start = startParsed.date;
  let end: Date;
  if (endParsed) {
    end = endParsed.date;
  } else if (duration) {
    const length = parseDuration(duration.value);
    end = new Date(start.getTime() + (length ?? 0));
  } else {
    end = new Date(start.getTime() + (startParsed.allDay ? 0 : 3600000));
  }

  if (startParsed.allDay) {
    if (endParsed) {
      end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 1));
    } else if (duration) {
      end = new Date(end.getTime() - DAY_MS);
    } else {
      end = start;
    }
    if (end.getTime() < start.getTime()) end = start;
  } else if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 3600000);
  }

  const rruleProp = first('RRULE');
  const rrule = rruleProp ? rruleProp.value.replace(/^RRULE:/i, '').trim() : null;

  const categories = all('CATEGORIES').flatMap((prop) => splitValues(prop.value));

  const exdates: string[] = [];
  for (const prop of all('EXDATE')) {
    for (const value of splitValues(prop.value)) {
      const parsed = parseDateValue(value, prop.params, startParsed.timezone || fallbackTimezone);
      if (parsed) exdates.push(occurrenceKey(parsed, startParsed.allDay, startParsed.timezone));
    }
  }

  const recurrenceIdProp = first('RECURRENCE-ID');
  let recurrenceId: string | null = null;
  if (recurrenceIdProp) {
    const parsed = parseDateValue(
      recurrenceIdProp.value,
      recurrenceIdProp.params,
      startParsed.timezone || fallbackTimezone
    );
    if (parsed) {
      recurrenceId = occurrenceKey(parsed, startParsed.allDay, startParsed.timezone);
    }
  }

  const uid = first('UID');
  const summary = first('SUMMARY');
  const description = first('DESCRIPTION');
  const location = first('LOCATION');
  const url = first('URL');
  const status = first('STATUS');

  return {
    uid: uid ? unescapeText(uid.value).trim() || null : null,
    title: sanitizeText(unescapeText(summary?.value ?? ''), 200) || 'Sans titre',
    description: unescapeText(description?.value ?? '').slice(0, 20000),
    location: location ? sanitizeText(unescapeText(location.value), 300) || null : null,
    url: url ? sanitizeText(unescapeText(url.value), 1000) || null : null,
    allDay: startParsed.allDay,
    start: startParsed.allDay ? dateOnly(start) : start.toISOString(),
    end: startParsed.allDay ? dateOnly(end) : end.toISOString(),
    timezone: startParsed.allDay ? 'UTC' : startParsed.timezone,
    rrule,
    recurrenceUntil: rrule ? recurrenceUntil(rrule, startParsed.timezone) : null,
    categories,
    exdates,
    recurrenceId,
    recurrenceRange: recurrenceIdProp?.params.RANGE ?? null,
    status: (status?.value ?? 'CONFIRMED').toUpperCase()
  };
}

export function parseIcsEvents(text: string, fallbackTimezone = 'UTC'): IcsParseResult {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
  const lines = normalized.split('\n');
  const events: ParsedIcsEvent[] = [];
  const warnings: string[] = [];
  let current: string[] | null = null;
  let depth = 0;

  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (!current) {
      if (upper === 'BEGIN:VEVENT') {
        current = [];
        depth = 1;
      }
      continue;
    }
    if (upper.startsWith('BEGIN:')) {
      depth += 1;
      continue;
    }
    if (upper.startsWith('END:')) {
      depth -= 1;
      if (depth === 0) {
        const event = parseEventLines(current, fallbackTimezone);
        if (event) {
          events.push(event);
          if (events.length >= MAX_EVENTS) {
            warnings.push('event_limit_reached');
            break;
          }
        } else {
          warnings.push('event_skipped_invalid_dates');
        }
        current = null;
      }
      continue;
    }
    if (depth === 1) current.push(line);
  }

  return { events, warnings };
}

function findTarget(db: DB, userId: string): TargetRow {
  const target = db
    .prepare(
      `SELECT u.id, u.username, u.timezone, c.id AS calendar_id
       FROM users u JOIN calendars c ON c.owner_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as TargetRow | undefined;
  if (!target) throw new HttpError(404, 'user_not_found');
  return target;
}

export function importIcsEvents(db: DB, options: ImportIcsOptions): ImportIcsResult {
  const target = findTarget(db, options.userId);
  const parsed = parseIcsEvents(
    options.content,
    target.timezone || 'UTC'
  );
  const warnings = [...parsed.warnings];
  const categoryRows = db
    .prepare('SELECT id, name FROM categories')
    .all() as { id: string; name: string }[];
  const categoryByName = new Map(
    categoryRows.map((row) => [row.name.trim().toLocaleLowerCase(), row.id])
  );
  const categoryIds = new Set(categoryRows.map((row) => row.id));
  const defaultCategoryId =
    options.defaultCategoryId && categoryIds.has(options.defaultCategoryId)
      ? options.defaultCategoryId
      : null;
  const unmatchedCategories = new Set<string>();
  const eventIdByUid = new Map<string, string>();
  const now = nowIso();
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let exceptions = 0;
  let categoriesMatched = 0;

  function sourceUid(event: ParsedIcsEvent, index: number): string {
    if (event.uid) return event.uid;
    return createHash('sha1')
      .update(`${event.title}|${event.start}|${event.end}|${event.rrule ?? ''}|${index}`)
      .digest('hex');
  }

  function resolveCategory(event: ParsedIcsEvent): string | null {
    for (const name of event.categories) {
      const id = categoryByName.get(name.trim().toLocaleLowerCase());
      if (id) {
        categoriesMatched += 1;
        return id;
      }
      unmatchedCategories.add(name.trim());
    }
    return defaultCategoryId;
  }

  function insertException(
    eventId: string,
    occurrenceStart: string,
    action: 'cancelled' | 'modified',
    override?: Record<string, unknown>
  ) {
    db.prepare(
      `INSERT INTO event_exceptions (id, event_id, occurrence_start, action, override_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id, occurrence_start) DO UPDATE SET
         action = excluded.action,
         override_json = excluded.override_json,
         updated_at = excluded.updated_at`
    ).run(
      newId(),
      eventId,
      occurrenceStart,
      action,
      override ? JSON.stringify(override) : null,
      now,
      now
    );
    exceptions += 1;
  }

  const masters = parsed.events.filter(
    (event) => !event.recurrenceId && event.status !== 'CANCELLED'
  );
  skipped += parsed.events.filter((event) => event.status === 'CANCELLED').length;

  db.transaction(() => {
    masters.forEach((event, index) => {
      const uid = `import:${target.id}:${sourceUid(event, index)}`;
      const categoryId = resolveCategory(event);
      const description = cleanDescription(event.description, options.allowHtmlDescription);
      const url = event.url && isValidHttpUrl(event.url) ? event.url : null;
      const existing = db.prepare('SELECT * FROM events WHERE uid = ?').get(uid) as
        | EventRow
        | undefined;
      let eventId: string;
      if (existing) {
        eventId = existing.id;
        db.prepare(
          `UPDATE events SET calendar_id = ?, owner_id = ?, title = ?, description = ?,
             start_at = ?, end_at = ?, all_day = ?, timezone = ?, location = ?, url = ?,
             priority = NULL, visibility = 'default', category_id = ?, rrule = ?, recurrence_until = ?,
             sequence = sequence + 1, status = 'confirmed', updated_at = ?
           WHERE id = ?`
        ).run(
          target.calendar_id,
          target.id,
          event.title,
          description,
          event.start,
          event.end,
          event.allDay ? 1 : 0,
          event.timezone,
          event.location,
          url,
          categoryId,
          event.rrule,
          event.recurrenceUntil,
          now,
          eventId
        );
        updated += 1;
      } else {
        eventId = newId();
        db.prepare(
          `INSERT INTO events (id, uid, calendar_id, owner_id, created_by, title, description, start_at, end_at,
             all_day, timezone, location, url, priority, visibility, category_id, rrule, recurrence_until,
             sequence, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'default', ?, ?, ?, 0, 'confirmed', ?, ?)`
        ).run(
          eventId,
          uid,
          target.calendar_id,
          target.id,
          options.createdBy,
          event.title,
          description,
          event.start,
          event.end,
          event.allDay ? 1 : 0,
          event.timezone,
          event.location,
          url,
          categoryId,
          event.rrule,
          event.recurrenceUntil,
          now,
          now
        );
        imported += 1;
      }
      eventIdByUid.set(sourceUid(event, index), eventId);
      db.prepare(
        'INSERT OR IGNORE INTO event_participants (event_id, user_id) VALUES (?, ?)'
      ).run(eventId, target.id);
      db.prepare('DELETE FROM event_exceptions WHERE event_id = ?').run(eventId);
      for (const occurrenceStart of event.exdates) {
        insertException(eventId, occurrenceStart, 'cancelled');
      }
    });

    parsed.events.forEach((event) => {
      if (!event.recurrenceId || !event.uid) return;
      const eventId = eventIdByUid.get(event.uid);
      if (!eventId) {
        skipped += 1;
        warnings.push('recurrence_parent_not_found');
        return;
      }
      if (event.recurrenceRange && event.recurrenceRange.toUpperCase() === 'THISANDFUTURE') {
        skipped += 1;
        warnings.push('recurrence_range_not_supported');
        return;
      }
      if (event.status === 'CANCELLED') {
        insertException(eventId, event.recurrenceId, 'cancelled');
        return;
      }
      const categoryId = resolveCategory(event);
      const override: Record<string, unknown> = {
        title: event.title,
        description: cleanDescription(event.description, options.allowHtmlDescription),
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        location: event.location,
        url: event.url && isValidHttpUrl(event.url) ? event.url : null
      };
      if (categoryId) override.categoryId = categoryId;
      insertException(eventId, event.recurrenceId, 'modified', override);
    });
  })();

  return {
    imported,
    updated,
    skipped,
    exceptions,
    categoriesMatched,
    unmatchedCategories: [...unmatchedCategories].sort(),
    warnings
  };
}
