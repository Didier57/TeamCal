import { RRule } from 'rrule';
import type { DB } from '../db';
import { SettingsStore, type AppSettings, type HolidaySource } from '../settings';
import { logger } from './logger';
import { newId, nowIso } from './util';

export interface HolidayOccurrence {
  date: string;
  title: string;
}

export interface HolidaySyncResult {
  sources: number;
  users: number;
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

interface HolidayEntry extends HolidayOccurrence {
  key: string;
}

let queue: Promise<HolidaySyncResult> = Promise.resolve({
  sources: 0,
  users: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  errors: []
});

function unfoldIcs(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getProperties(block: string): Map<string, string[]> {
  const properties = new Map<string, string[]>();
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const left = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const name = left.split(';')[0].toUpperCase();
    const list = properties.get(name) ?? [];
    list.push(value);
    properties.set(name, list);
  }
  return properties;
}

function propertyValues(properties: Map<string, string[]>, name: string): string[] {
  const values = properties.get(name) ?? [];
  return values.flatMap((value) => value.split(','));
}

export function parseHolidayIcs(
  text: string,
  fromYear = new Date().getUTCFullYear() - 1,
  toYear = new Date().getUTCFullYear() + 5
): HolidayOccurrence[] {
  const rangeStart = new Date(Date.UTC(fromYear, 0, 1));
  const rangeEnd = new Date(Date.UTC(toYear + 1, 0, 1));
  const result = new Map<string, HolidayOccurrence>();
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of unfoldIcs(text).split('\n')) {
    const marker = line.trim().toUpperCase();
    if (marker === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }
    if (marker === 'END:VEVENT') {
      if (current) blocks.push(current.join('\n'));
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  for (const block of blocks) {
    const properties = getProperties(block);
    const rawStart = properties.get('DTSTART')?.[0];
    if (!rawStart) continue;
    const start = parseDate(rawStart);
    const title = unescapeText(properties.get('SUMMARY')?.[0] ?? '');
    if (!start || !title) continue;

    const dates = new Map<number, Date>();
    const rrule = properties.get('RRULE')?.[0];
    if (rrule) {
      try {
        const rule = new RRule({ ...RRule.parseString(rrule), dtstart: start });
        for (const date of rule.between(rangeStart, rangeEnd, true)) {
          dates.set(date.getTime(), date);
        }
      } catch {
        dates.set(start.getTime(), start);
      }
    } else {
      dates.set(start.getTime(), start);
    }

    for (const rawDate of propertyValues(properties, 'RDATE')) {
      const date = parseDate(rawDate);
      if (date) dates.set(date.getTime(), date);
    }
    for (const rawDate of propertyValues(properties, 'EXDATE')) {
      const date = parseDate(rawDate);
      if (date) dates.delete(date.getTime());
    }

    for (const date of dates.values()) {
      if (date < rangeStart || date >= rangeEnd) continue;
      const key = `${dateKey(date)}|${title}`;
      if (!result.has(key)) result.set(key, { date: dateKey(date), title });
    }
  }

  return Array.from(result.values()).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

function holidayKey(country: string, entry: HolidayOccurrence): string {
  const slug = entry.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${country}:${entry.date}:${slug || 'holiday'}`;
}

async function fetchIcs(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.5',
        'User-Agent': 'TeamCal holiday sync'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function groupSources(sources: HolidaySource[]): Map<string, HolidaySource[]> {
  const grouped = new Map<string, HolidaySource[]>();
  for (const source of sources) {
    if (!source.url || !source.country) continue;
    const list = grouped.get(source.country) ?? [];
    list.push(source);
    grouped.set(source.country, list);
  }
  return grouped;
}

function emptyResult(errors: string[] = []): HolidaySyncResult {
  return { sources: 0, users: 0, created: 0, updated: 0, deleted: 0, errors };
}

async function runSync(db: DB, settings: AppSettings, onlyUserId?: string): Promise<HolidaySyncResult> {
  const result = emptyResult();
  const grouped = groupSources(settings.holidaySources);
  result.sources = settings.holidaySources.length;
  const holidaysByCountry = new Map<string, Map<string, HolidayEntry>>();
  const failedCountries = new Set<string>();

  for (const [country, sources] of grouped) {
    const entries = new Map<string, HolidayEntry>();
    let failed = false;
    for (const source of sources) {
      try {
        const ics = await fetchIcs(source.url);
        for (const occurrence of parseHolidayIcs(ics)) {
          const key = holidayKey(country, occurrence);
          if (!entries.has(key)) entries.set(key, { ...occurrence, key });
        }
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${country}: ${source.name || source.url}: ${message}`);
        logger.warn('holiday_source_failed', { country, sourceId: source.id, url: source.url, error: message });
      }
    }
    if (failed) failedCountries.add(country);
    else holidaysByCountry.set(country, entries);
  }

  const users = (
    onlyUserId
      ? db
          .prepare(
            `SELECT u.id, u.country, c.id AS calendar_id
             FROM users u JOIN calendars c ON c.owner_id = u.id
             WHERE u.id = ?`
          )
          .all(onlyUserId)
      : db
          .prepare(
            `SELECT u.id, u.country, c.id AS calendar_id
             FROM users u JOIN calendars c ON c.owner_id = u.id
             WHERE u.is_active = 1`
          )
          .all()
  ) as { id: string; country: string | null; calendar_id: string }[];

  const selectHolidays = db.prepare(
    'SELECT id, holiday_key FROM events WHERE calendar_id = ? AND holiday_key IS NOT NULL'
  );
  const deleteEvent = db.prepare('DELETE FROM events WHERE id = ?');
  const updateEvent = db.prepare(
    `UPDATE events SET title = ?, start_at = ?, end_at = ?, holiday_source_id = ?, updated_at = ?
     WHERE id = ?`
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (id, uid, calendar_id, owner_id, created_by, title, description, start_at, end_at,
       all_day, timezone, location, url, priority, visibility, category_id, rrule, recurrence_until,
       sequence, status, holiday_source_id, holiday_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 1, 'UTC', NULL, NULL, NULL, 'default', NULL, NULL, NULL,
       0, 'confirmed', ?, ?, ?, ?)`
  );

  for (const user of users) {
    result.users += 1;
    const country = user.country;
    if (country && failedCountries.has(country)) continue;
    const desired = country ? holidaysByCountry.get(country) ?? new Map<string, HolidayEntry>() : new Map();

    db.transaction(() => {
      const existing = selectHolidays.all(user.calendar_id) as { id: string; holiday_key: string }[];
      for (const event of existing) {
        if (!desired.has(event.holiday_key)) {
          deleteEvent.run(event.id);
          result.deleted += 1;
        }
      }
      const existingByKey = new Map(existing.map((event) => [event.holiday_key, event.id]));
      for (const entry of desired.values()) {
        const existingId = existingByKey.get(entry.key);
        if (existingId) {
          updateEvent.run(entry.title, entry.date, entry.date, country, nowIso(), existingId);
          result.updated += 1;
        } else {
          const now = nowIso();
          insertEvent.run(
            newId(),
            `holiday:${user.calendar_id}:${entry.key}`,
            user.calendar_id,
            user.id,
            user.id,
            entry.title,
            entry.date,
            entry.date,
            country,
            entry.key,
            now,
            now
          );
          result.created += 1;
        }
      }
    })();
  }

  if (result.created || result.updated || result.deleted || result.errors.length) {
    logger.info('holidays_synced', { ...result });
  }
  return result;
}

export function syncHolidays(
  db: DB,
  settings: AppSettings,
  onlyUserId?: string
): Promise<HolidaySyncResult> {
  const next = queue.then(
    () => runSync(db, settings, onlyUserId),
    () => runSync(db, settings, onlyUserId)
  );
  queue = next.catch((error) => {
    logger.error('holidays_sync_failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    return emptyResult([error instanceof Error ? error.message : String(error)]);
  });
  return next;
}

export function startHolidayScheduler(db: DB) {
  const run = () => {
    const settings = new SettingsStore(db).get();
    void syncHolidays(db, settings).catch(() => undefined);
  };
  const first = setTimeout(run, 5000);
  first.unref();
  const interval = setInterval(run, 24 * 60 * 60 * 1000);
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
