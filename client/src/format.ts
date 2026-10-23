import type { Language } from './types';

export function localeFor(language: Language): string {
  return language === 'de' ? 'de-DE' : language === 'en' ? 'en-GB' : 'fr-FR';
}

export function effectiveTimeZone(userTimeZone: string | null | undefined, fallback: string): string {
  if (userTimeZone) return userTimeZone;
  return fallback;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
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

export function wallTimeToUtc(value: string, timeZone: string): string {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = offsetMinutes(new Date(guess), timeZone);
  const candidate = new Date(guess - first * 60000);
  const second = offsetMinutes(candidate, timeZone);
  return new Date(second === first ? candidate : guess - second * 60000).toISOString();
}

export function toDateTimeInput(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function toDateInput(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatDate(
  iso: string,
  options: {
    locale: string;
    timeZone: string;
    dateFormat: string;
    timeFormat: '12' | '24';
    allDay?: boolean;
    withTime?: boolean;
  }
): string {
  const date = new Date(iso);
  const parts: string[] = [];
  const day = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    day: '2-digit'
  }).format(date);
  const month = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    month: '2-digit'
  }).format(date);
  const year = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    year: 'numeric'
  }).format(date);
  switch (options.dateFormat) {
    case 'MM/dd/yyyy':
      parts.push(`${month}/${day}/${year}`);
      break;
    case 'dd/MM':
      parts.push(`${day}/${month}`);
      break;
    case 'MM/yyyy':
      parts.push(`${month}/${year}`);
      break;
    default:
      parts.push(`${day}/${month}/${year}`);
  }
  if (options.withTime && !options.allDay) {
    const time = new Intl.DateTimeFormat(options.locale, {
      timeZone: options.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: options.timeFormat === '12'
    }).format(date);
    parts.push(time);
  }
  return parts.join(' ');
}

export function formatDateTimeRange(
  start: string,
  end: string,
  options: {
    locale: string;
    timeZone: string;
    dateFormat: string;
    timeFormat: '12' | '24';
    allDay?: boolean;
  }
): string {
  const startText = formatDate(start, { ...options, withTime: true });
  const sameDay =
    formatDate(start, options) === formatDate(end, options);
  const endText = sameDay
    ? new Intl.DateTimeFormat(options.locale, {
        timeZone: options.timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: options.timeFormat === '12'
      }).format(new Date(end))
    : formatDate(end, { ...options, withTime: true });
  return options.allDay ? startText : `${startText} – ${endText}`;
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}
