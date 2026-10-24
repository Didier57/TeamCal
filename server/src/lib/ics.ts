import { isValidTimeZone, zoneOffsetMinutes, zonedParts } from './time';

export interface IcsAttendee {
  name: string;
  email: string;
  role?: 'CHAIR' | 'REQ-PARTICIPANT';
  partStat?: string;
}

export interface IcsInput {
  uid: string;
  sequence: number;
  method: 'REQUEST' | 'CANCEL' | 'PUBLISH';
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  rrule?: string | null;
  organizer?: IcsAttendee;
  attendees: IcsAttendee[];
  cancelled?: boolean;
  stamp?: Date;
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function quoteParam(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks: string[] = [];
  let current = Buffer.alloc(0);
  for (const char of line) {
    const charBuf = Buffer.from(char, 'utf8');
    if (current.length + charBuf.length > 73) {
      chunks.push(current.toString('utf8'));
      current = Buffer.alloc(0);
    }
    current = Buffer.concat([current, charBuf]);
  }
  if (current.length) chunks.push(current.toString('utf8'));
  return chunks.join('\r\n ');
}

function utcStamp(date: Date): string {
  return (
    date.getUTCFullYear().toString().padStart(4, '0') +
    (date.getUTCMonth() + 1).toString().padStart(2, '0') +
    date.getUTCDate().toString().padStart(2, '0') +
    'T' +
    date.getUTCHours().toString().padStart(2, '0') +
    date.getUTCMinutes().toString().padStart(2, '0') +
    date.getUTCSeconds().toString().padStart(2, '0') +
    'Z'
  );
}

function dateValue(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

function nextDay(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  return date.toISOString().slice(0, 10);
}

export function buildIcs(input: IcsInput): string {
  const stamp = utcStamp(input.stamp ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TeamCal//TeamCal//FR',
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method}`
  ];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${input.uid}`);
  lines.push(`DTSTAMP:${stamp}`);
  lines.push(`SEQUENCE:${input.sequence}`);
  if (input.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(input.start)}`);
    lines.push(`DTEND;VALUE=DATE:${dateValue(nextDay(input.end))}`);
  } else {
    lines.push(`DTSTART:${utcStamp(new Date(input.start))}`);
    lines.push(`DTEND:${utcStamp(new Date(input.end))}`);
  }
  if (input.rrule) lines.push(`RRULE:${input.rrule.replace(/^RRULE:/i, '')}`);
  lines.push(`SUMMARY:${escapeText(input.title)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeText(input.location)}`);
  if (input.url) lines.push(`URL:${input.url}`);
  if (input.organizer) {
    lines.push(
      `ORGANIZER;CN=${quoteParam(input.organizer.name)}:mailto:${input.organizer.email}`
    );
  }
  for (const attendee of input.attendees) {
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;CN=${quoteParam(attendee.name)};ROLE=${attendee.role ?? 'REQ-PARTICIPANT'};RSVP=TRUE;PARTSTAT=${attendee.partStat ?? 'NEEDS-ACTION'}:mailto:${attendee.email}`
    );
  }
  lines.push(`STATUS:${input.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push(`TRANSP:${input.allDay ? 'TRANSPARENT' : 'OPAQUE'}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export interface FeedItem {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  categories?: string[];
  sequence?: number;
  stamp?: string | Date;
}

export function buildFeedIcs(calendarName: string, items: FeedItem[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TeamCal//TeamCal//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`
  ];
  for (const item of items) {
    const stamp = utcStamp(item.stamp ? new Date(item.stamp) : new Date());
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${item.uid}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SEQUENCE:${item.sequence ?? 0}`);
    if (item.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(item.start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateValue(nextDay(item.end))}`);
    } else {
      lines.push(`DTSTART:${utcStamp(new Date(item.start))}`);
      lines.push(`DTEND:${utcStamp(new Date(item.end))}`);
    }
    lines.push(`SUMMARY:${escapeText(item.title)}`);
    if (item.description) lines.push(`DESCRIPTION:${escapeText(item.description)}`);
    if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (item.url) lines.push(`URL:${item.url}`);
    if (item.categories?.length) {
      lines.push(`CATEGORIES:${item.categories.map(escapeText).join(',')}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push(`TRANSP:${item.allDay ? 'TRANSPARENT' : 'OPAQUE'}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export interface RawIcsEvent {
  uid: string;
  sequence: number;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  rrule?: string | null;
  exdates?: string[];
  recurrenceId?: string | null;
  categories?: string[];
  stamp?: string | Date;
}

function offsetString(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60).toString().padStart(2, '0');
  const mins = (absolute % 60).toString().padStart(2, '0');
  return `${sign}${hours}${mins}`;
}

interface ZoneTransition {
  at: number;
  from: number;
  to: number;
}

function zoneTransitions(timeZone: string, fromMs: number, toMs: number): ZoneTransition[] {
  const step = 6 * 3600000;
  const transitions: ZoneTransition[] = [];
  let previous = fromMs;
  let previousOffset = zoneOffsetMinutes(new Date(fromMs), timeZone);
  for (let ms = fromMs + step; ms <= toMs; ms += step) {
    const offset = zoneOffsetMinutes(new Date(ms), timeZone);
    if (offset !== previousOffset) {
      let low = previous;
      let high = ms;
      while (high - low > 1000) {
        const mid = low + Math.floor((high - low) / 2000) * 1000;
        if (zoneOffsetMinutes(new Date(mid), timeZone) === previousOffset) low = mid;
        else high = mid;
      }
      transitions.push({ at: high, from: previousOffset, to: offset });
      previousOffset = offset;
    }
    previous = ms;
  }
  return transitions;
}

function buildTimeZone(timeZone: string, fromYear: number, toYear: number): string[] {
  const fromMs = Date.UTC(fromYear, 0, 1);
  const toMs = Date.UTC(toYear, 11, 31, 23, 59, 59);
  const transitions = zoneTransitions(timeZone, fromMs, toMs);
  const lines: string[] = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
  if (transitions.length === 0) {
    const offset = zoneOffsetMinutes(new Date(fromMs), timeZone);
    lines.push(
      'BEGIN:STANDARD',
      `DTSTART:${fromYear}0101T000000`,
      `TZOFFSETFROM:${offsetString(offset)}`,
      `TZOFFSETTO:${offsetString(offset)}`,
      'END:STANDARD'
    );
  } else {
    for (const transition of transitions) {
      const kind = transition.to > transition.from ? 'DAYLIGHT' : 'STANDARD';
      const local = utcStamp(new Date(transition.at + transition.from * 60000)).slice(0, -1);
      lines.push(
        `BEGIN:${kind}`,
        `DTSTART:${local}`,
        `TZOFFSETFROM:${offsetString(transition.from)}`,
        `TZOFFSETTO:${offsetString(transition.to)}`,
        `END:${kind}`
      );
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

function localStamp(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  const pad = (value: number, size = 2) => value.toString().padStart(size, '0');
  return `${pad(parts.year, 4)}${pad(parts.month)}${pad(parts.day)}T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
}

function resolveTimeZone(timeZone: string): string {
  if (!timeZone || timeZone === 'UTC') return 'UTC';
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

function dateProperty(value: string, allDay: boolean, timeZone: string): { params: string; value: string } {
  if (allDay) return { params: ';VALUE=DATE', value: dateValue(value) };
  const zone = resolveTimeZone(timeZone);
  if (zone === 'UTC') return { params: '', value: utcStamp(new Date(value)) };
  return { params: `;TZID=${zone}`, value: localStamp(new Date(value), zone) };
}

function yearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

export function buildRawIcs(calendarName: string, events: RawIcsEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TeamCal//TeamCal//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`
  ];

  const years: number[] = [new Date().getFullYear()];
  const timeZones = new Set<string>();
  for (const event of events) {
    if (!event.allDay) timeZones.add(resolveTimeZone(event.timezone));
    for (const value of [event.start, event.end, event.recurrenceId]) {
      const year = yearOf(value);
      if (year) years.push(year);
    }
    const until = event.rrule ? /UNTIL=(\d{4})/.exec(event.rrule) : null;
    if (until) years.push(Number(until[1]));
  }
  const minYear = Math.max(1970, Math.min(...years) - 1);
  const maxYear = Math.max(...years) + 11;
  for (const timeZone of [...timeZones].sort()) {
    if (timeZone === 'UTC') continue;
    lines.push(...buildTimeZone(timeZone, minYear, maxYear));
  }

  for (const event of events) {
    const timeZone = resolveTimeZone(event.timezone);
    const start = dateProperty(event.start, event.allDay, timeZone);
    const end = dateProperty(event.allDay ? nextDay(event.end) : event.end, event.allDay, timeZone);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${utcStamp(event.stamp ? new Date(event.stamp) : new Date())}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    lines.push(`DTSTART${start.params}:${start.value}`);
    lines.push(`DTEND${end.params}:${end.value}`);
    if (event.recurrenceId) {
      const recurrence = dateProperty(event.recurrenceId, event.allDay, timeZone);
      lines.push(`RECURRENCE-ID${recurrence.params}:${recurrence.value}`);
    }
    if (event.rrule) lines.push(`RRULE:${event.rrule.replace(/^RRULE:/i, '')}`);
    if (event.exdates?.length) {
      const values = event.exdates.map((value) => dateProperty(value, event.allDay, timeZone));
      const params = values[0].params;
      lines.push(`EXDATE${params}:${values.map((value) => value.value).join(',')}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    if (event.categories?.length) {
      lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`);
    }
    lines.push('STATUS:CONFIRMED');
    lines.push(`TRANSP:${event.allDay ? 'TRANSPARENT' : 'OPAQUE'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(input: {
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  allDay: boolean;
}): string {
  const dates = input.allDay
    ? `${dateValue(input.start)}/${dateValue(nextDay(input.end))}`
    : `${utcStamp(new Date(input.start))}/${utcStamp(new Date(input.end))}`;
  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(input.title)}`,
    `dates=${dates}`,
    `details=${encodeURIComponent(input.description ?? '')}`,
    `location=${encodeURIComponent(input.location ?? '')}`
  ];
  return `https://calendar.google.com/calendar/render?${params.join('&')}`;
}
