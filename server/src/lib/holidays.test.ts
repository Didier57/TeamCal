import { describe, expect, it } from 'vitest';
import { parseHolidayIcs } from './holidays';

const sample = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:new-year',
  'DTSTART;VALUE=DATE:20250101',
  'DTEND;VALUE=DATE:20250102',
  'SUMMARY:Nouvel An',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:easter',
  'DTSTART;VALUE=DATE:20240401',
  'SUMMARY:Lundi de Pâques',
  'RRULE:FREQ=YEARLY;COUNT=3',
  'EXDATE;VALUE=DATE:20250401',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:old',
  'DTSTART;VALUE=DATE:20150406',
  'SUMMARY:Ancien jour férié',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

describe('parseHolidayIcs', () => {
  it('expands recurring holidays inside the requested range and applies exclusions', () => {
    const holidays = parseHolidayIcs(sample, 2024, 2027);
    expect(holidays).toEqual([
      { date: '2024-04-01', title: 'Lundi de Pâques' },
      { date: '2025-01-01', title: 'Nouvel An' },
      { date: '2026-04-01', title: 'Lundi de Pâques' }
    ]);
  });

  it('unescapes summary text and ignores events outside the range', () => {
    const holidays = parseHolidayIcs(
      [
        'BEGIN:VEVENT',
        'DTSTART;VALUE=DATE:20260501',
        'SUMMARY:Fête du\\, Travail \\; mai',
        'END:VEVENT'
      ].join('\n'),
      2026,
      2026
    );
    expect(holidays).toEqual([{ date: '2026-05-01', title: 'Fête du, Travail ; mai' }]);
  });
});
