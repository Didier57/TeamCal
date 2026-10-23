export interface IcsAttendee {
  name: string;
  email: string;
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
      `ORGANIZER;CN=${escapeText(input.organizer.name)}:mailto:${input.organizer.email}`
    );
  }
  for (const attendee of input.attendees) {
    lines.push(
      `ATTENDEE;CN=${escapeText(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:${attendee.email}`
    );
  }
  lines.push(`STATUS:${input.cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push(`TRANSP:${input.allDay ? 'TRANSPARENT' : 'OPAQUE'}`);
  lines.push('END:VEVENT');
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
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates,
    details: input.description ?? '',
    location: input.location ?? ''
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
