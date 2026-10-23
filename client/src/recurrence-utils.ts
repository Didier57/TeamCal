import type { Recurrence } from './types';

const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export function parseRrule(rrule: string | null | undefined): Recurrence | null {
  if (!rrule) return null;
  const parts = new Map<string, string>();
  for (const segment of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [key, value] = segment.split('=');
    if (key && value) parts.set(key.toUpperCase(), value);
  }
  const frequency = (parts.get('FREQ') ?? '').toLowerCase();
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(frequency)) return null;
  const untilRaw = parts.get('UNTIL');
  let until: string | null = null;
  if (untilRaw && /^\d{8}/.test(untilRaw)) {
    until = `${untilRaw.slice(0, 4)}-${untilRaw.slice(4, 6)}-${untilRaw.slice(6, 8)}`;
  }
  const byDay = parts.get('BYDAY');
  const byWeekday = byDay
    ? byDay
        .split(',')
        .map((day) => weekdays.indexOf(day.replace(/[^A-Z]/g, '')))
        .filter((index) => index >= 0)
    : undefined;
  const countRaw = parts.get('COUNT');
  return {
    frequency: frequency as Recurrence['frequency'],
    interval: Number(parts.get('INTERVAL') ?? 1) || 1,
    byWeekday,
    until,
    count: countRaw ? Number(countRaw) : null
  };
}

export function defaultRecurrence(): Recurrence {
  return { frequency: 'weekly', interval: 1, byWeekday: [], until: null, count: null };
}
