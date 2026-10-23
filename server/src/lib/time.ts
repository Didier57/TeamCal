export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second')
  };
}

function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

export function fromZonedParts(parts: ZonedParts, timeZone: string): Date {
  const guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const first = offsetMinutes(new Date(guess), timeZone);
  const candidate = new Date(guess - first * 60000);
  const second = offsetMinutes(candidate, timeZone);
  return second === first ? candidate : new Date(guess - second * 60000);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function parseInstant(value: string, fallbackTimeZone = 'UTC'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fromZonedParts(
      { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)), hour: 0, minute: 0, second: 0 },
      fallbackTimeZone
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date;
}

export function dateKeyInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year.toString().padStart(4, '0')}-${p.month.toString().padStart(2, '0')}-${p.day.toString().padStart(2, '0')}`;
}

export function wallClockAsUtc(date: Date, timeZone: string): Date {
  const p = zonedParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

export function utcAsWallClock(date: Date, timeZone: string): Date {
  return fromZonedParts(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds()
    },
    timeZone
  );
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function differenceInMinutes(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}
