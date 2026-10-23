import { describe, expect, it } from 'vitest';
import { parseIcsEvents } from './ics-import';

function ics(lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TeamCal test//EN',
    ...lines,
    'END:VCALENDAR'
  ].join('\r\n');
}

describe('ICS import parser', () => {
  it('parses timezone-aware recurring events and excluded dates', () => {
    const result = parseIcsEvents(
      ics([
        'BEGIN:VEVENT',
        'UID:recurring-1',
        'DTSTART;TZID=Europe/Paris:20270301T090000',
        'DTEND;TZID=Europe/Paris:20270301T100000',
        'RRULE:FREQ=DAILY;COUNT=3',
        'EXDATE;TZID=Europe/Paris:20270302T090000',
        'SUMMARY:Réunion quotidienne',
        'CATEGORIES:Travail',
        'END:VEVENT'
      ])
    );

    expect(result.warnings).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].start).toBe('2027-03-01T08:00:00.000Z');
    expect(result.events[0].end).toBe('2027-03-01T09:00:00.000Z');
    expect(result.events[0].rrule).toBe('FREQ=DAILY;COUNT=3');
    expect(result.events[0].categories).toEqual(['Travail']);
    expect(result.events[0].exdates).toEqual(['2027-03-02T08:00:00.000Z']);
  });

  it('converts all-day end dates from exclusive to inclusive', () => {
    const result = parseIcsEvents(
      ics([
        'BEGIN:VEVENT',
        'UID:all-day-1',
        'DTSTART;VALUE=DATE:20270201',
        'DTEND;VALUE=DATE:20270203',
        'SUMMARY:Deux jours',
        'END:VEVENT'
      ])
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].allDay).toBe(true);
    expect(result.events[0].start).toBe('2027-02-01');
    expect(result.events[0].end).toBe('2027-02-02');
  });
});
