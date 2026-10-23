import { useMemo, useRef, type DragEvent } from 'react';
import { useI18n } from '../i18n';
import { addDaysToDateKey, toDateInput, toDateTimeInput, wallTimeToUtc } from '../format';
import type { Calendar, Occurrence, PublicSettings, ViewKind } from '../types';

interface Props {
  view: ViewKind;
  date: Date;
  calendars: Calendar[];
  events: Occurrence[];
  settings: PublicSettings;
  timeZone: string;
  onCreate: (calendarId: string, start: Date, end: Date, allDay: boolean) => void;
  onEdit: (occurrence: Occurrence) => void;
  onMove: (occurrence: Occurrence, start: string, end: string, targetCalendarId?: string) => void;
}

function utcDateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToKey(key: string, days: number): string {
  return addDaysToDateKey(key, days);
}

function weekdayOfKey(key: string): number {
  return utcDateFromKey(key).getUTCDay();
}

function startOfWeekKey(key: string, firstDay: number): string {
  const diff = (weekdayOfKey(key) - firstDay + 7) % 7;
  return addDaysToKey(key, -diff);
}

function isoWeek(key: string): number {
  const date = utcDateFromKey(key);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function daysInMonth(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function dateKeyOf(date: Date, timeZone: string): string {
  return toDateInput(date.toISOString(), timeZone);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatHeader(key: string, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(utcDateFromKey(key));
}

export function PlanningGrid({
  view,
  date,
  calendars,
  events,
  settings,
  timeZone,
  onCreate,
  onEdit,
  onMove
}: Props) {
  const { t, locale } = useI18n();
  const dragged = useRef<Occurrence | null>(null);

  const anchorKey = localDateKey(date);
  const todayKey = dateKeyOf(new Date(), timeZone);

  const dayKeys = useMemo(() => {
    if (view === 'day') return [anchorKey];
    if (view === 'week') {
      const start = startOfWeekKey(anchorKey, settings.firstDay);
      return Array.from({ length: 7 }, (_, index) => addDaysToKey(start, index));
    }
    const total = daysInMonth(anchorKey);
    return Array.from({ length: total }, (_, index) => `${anchorKey.slice(0, 7)}-${pad(index + 1)}`);
  }, [view, anchorKey, settings.firstDay]);

  const hours = useMemo(() => {
    const startHour = Number((settings.workHours.start || '08:00').slice(0, 2));
    const endHour = Number((settings.workHours.end || '18:00').slice(0, 2));
    let min = startHour;
    let max = endHour;
    for (const occurrence of events) {
      if (occurrence.allDay) continue;
      if (dateKeyOf(new Date(occurrence.start), timeZone) !== anchorKey) continue;
      const start = Number(toDateTimeInput(occurrence.start, timeZone).slice(11, 13));
      const end = Number(toDateTimeInput(occurrence.end, timeZone).slice(11, 13));
      min = Math.min(min, start);
      max = Math.max(max, end);
    }
    return Array.from({ length: Math.max(1, max - min) }, (_, index) => min + index);
  }, [events, anchorKey, settings.workHours, timeZone]);

  const eventsByCell = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of events) {
      const startKey = occurrence.allDay
        ? occurrence.start.slice(0, 10)
        : dateKeyOf(new Date(occurrence.start), timeZone);
      const endKey = occurrence.allDay
        ? occurrence.end.slice(0, 10)
        : dateKeyOf(new Date(new Date(occurrence.end).getTime() - 1000), timeZone);
      let key = startKey;
      let guard = 0;
      while (key <= endKey && guard < 400) {
        const cellKey = `${occurrence.calendarId}|${key}`;
        const list = map.get(cellKey) ?? [];
        list.push(occurrence);
        map.set(cellKey, list);
        key = addDaysToKey(key, 1);
        guard += 1;
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
    }
    return map;
  }, [events, timeZone]);

  const allDayByCell = useMemo(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of events) {
      if (!occurrence.allDay) continue;
      let key = occurrence.start.slice(0, 10);
      let guard = 0;
      while (key <= occurrence.end.slice(0, 10) && guard < 400) {
        const cellKey = `${occurrence.calendarId}|${key}`;
        const list = map.get(cellKey) ?? [];
        list.push(occurrence);
        map.set(cellKey, list);
        key = addDaysToKey(key, 1);
        guard += 1;
      }
    }
    return map;
  }, [events]);

  function timeLabel(occurrence: Occurrence): string {
    if (occurrence.allDay) return t('event.allDay');
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: settings.timeFormat === '12'
    });
    const start = formatter.format(new Date(occurrence.start));
    const end = formatter.format(new Date(occurrence.end));
    return `${start}–${end}`;
  }

  function chip(occurrence: Occurrence) {
    const color = occurrence.categoryColor ?? occurrence.calendarColor;
    return (
      <div
        key={occurrence.id}
        className={`planning-event ${occurrence.allDay ? 'all-day' : ''}`}
        style={{ background: color, borderColor: color }}
        draggable
        onDragStart={(event) => {
          dragged.current = occurrence;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', occurrence.id);
        }}
        onDragEnd={() => {
          dragged.current = null;
        }}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(occurrence);
        }}
        title={occurrence.title}
      >
        {!occurrence.allDay && <span className="planning-event-time">{timeLabel(occurrence)}</span>}
        <span className="planning-event-title">{occurrence.title}</span>
      </div>
    );
  }

  function dropOnCell(event: DragEvent, calendarId: string, targetKey: string, hour?: number) {
    event.preventDefault();
    const occurrence = dragged.current;
    dragged.current = null;
    if (!occurrence) return;
    let start: string;
    let end: string;
    if (occurrence.allDay) {
      const startKey = occurrence.start.slice(0, 10);
      const endKey = occurrence.end.slice(0, 10);
      const durationDays =
        Math.max(1, Math.round((utcDateFromKey(endKey).getTime() - utcDateFromKey(startKey).getTime()) / 86400000) + 1);
      start = targetKey;
      end = addDaysToKey(targetKey, durationDays - 1);
    } else {
      const duration = new Date(occurrence.end).getTime() - new Date(occurrence.start).getTime();
      const originalTime = toDateTimeInput(occurrence.start, timeZone).slice(11, 16);
      const time = hour === undefined ? originalTime : `${pad(hour)}:00`;
      const startIso = wallTimeToUtc(`${targetKey}T${time}`, timeZone);
      start = startIso;
      end = new Date(new Date(startIso).getTime() + duration).toISOString();
    }
    onMove(occurrence, start, end, calendarId);
  }

  function createInCell(calendar: Calendar, key: string, hour?: number) {
    if (!calendar.canCreate) return;
    const time = hour === undefined ? settings.workHours.start || '09:00' : `${pad(hour)}:00`;
    const startIso = wallTimeToUtc(`${key}T${time}`, timeZone);
    const endIso = new Date(new Date(startIso).getTime() + 3600000).toISOString();
    onCreate(calendar.id, new Date(startIso), new Date(endIso), false);
  }

  function createAllDayInCell(calendar: Calendar, key: string) {
    if (!calendar.canCreate) return;
    const startIso = wallTimeToUtc(`${key}T00:00`, timeZone);
    onCreate(calendar.id, new Date(startIso), new Date(startIso), true);
  }

  const rowStyle = (columns: number) => ({
    gridTemplateColumns: `190px repeat(${columns}, minmax(${view === 'month' ? 118 : 96}px, 1fr))`
  });

  const headerCell = (key: string, compact = false) => {
    const isToday = key === todayKey;
    const weekday = formatHeader(key, locale, { weekday: compact ? 'narrow' : 'short' });
    const day = formatHeader(key, locale, { day: '2-digit' });
    const month = formatHeader(key, locale, { month: 'short' });
    return (
      <div key={key} className={`planning-day-head ${isToday ? 'today' : ''}`}>
        {view === 'month' && (key === dayKeys[0] || weekdayOfKey(key) === settings.firstDay) && (
          <span className="planning-week-tag">
            {t('common.week').slice(0, 1)}
            {isoWeek(key)}
          </span>
        )}
        <span className="planning-weekday">{weekday}</span>
        <span className="planning-day-number">{day}</span>
        {view !== 'month' && <span className="planning-month">{month}</span>}
      </div>
    );
  };

  if (view === 'day') {
    const resourceCalendars = calendars;
    return (
      <div className="planning-scroll">
        <div className="planning-grid">
          <div className="planning-row planning-head-row" style={rowStyle(hours.length + 1)}>
            <div className="planning-corner">
              <span>{formatHeader(anchorKey, locale, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            </div>
            <div className="planning-day-head all-day-head">{t('event.allDay')}</div>
            {hours.map((hour) => (
              <div key={hour} className="planning-hour-head">
                {pad(hour)}:00
              </div>
            ))}
          </div>
          {resourceCalendars.map((calendar) => (
            <div className="planning-row" key={calendar.id} style={rowStyle(hours.length + 1)}>
              <div className="planning-resource">
                <span className="color-dot" style={{ background: calendar.color }} />
                <span className="planning-resource-name">{calendar.ownerName}</span>
              </div>
              <div
                className={`planning-cell all-day-cell ${calendar.canCreate ? 'creatable' : ''}`}
                onClick={() => createAllDayInCell(calendar, anchorKey)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropOnCell(event, calendar.id, anchorKey)}
              >
                {(allDayByCell.get(`${calendar.id}|${anchorKey}`) ?? []).map(chip)}
              </div>
              {hours.map((hour) => (
                <div
                  key={hour}
                  className={`planning-cell ${calendar.canCreate ? 'creatable' : ''}`}
                  onClick={() => createInCell(calendar, anchorKey, hour)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropOnCell(event, calendar.id, anchorKey, hour)}
                >
                  {(eventsByCell.get(`${calendar.id}|${anchorKey}`) ?? [])
                    .filter(
                      (occurrence) =>
                        !occurrence.allDay &&
                        Number(toDateTimeInput(occurrence.start, timeZone).slice(11, 13)) === hour
                    )
                    .map(chip)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const showWeekNumber = view === 'week';
  const headColumns = dayKeys.length;

  return (
    <div className="planning-scroll">
      <div className="planning-grid">
        <div className="planning-row planning-head-row" style={rowStyle(headColumns)}>
          {showWeekNumber ? (
            <div className="planning-corner planning-week-corner">
              {t('common.week')} {isoWeek(dayKeys[0])}
            </div>
          ) : (
            <div className="planning-corner">{t('calendar.resources')}</div>
          )}
          {dayKeys.map((key) => headerCell(key, view === 'month'))}
        </div>
        {calendars.map((calendar) => (
          <div className="planning-row" key={calendar.id} style={rowStyle(headColumns)}>
            <div className="planning-resource">
              <span className="color-dot" style={{ background: calendar.color }} />
              <span className="planning-resource-name">{calendar.ownerName}</span>
            </div>
            {dayKeys.map((key) => (
              <div
                key={key}
                className={`planning-cell ${key === todayKey ? 'today' : ''} ${
                  calendar.canCreate ? 'creatable' : ''
                }`}
                onClick={() => createInCell(calendar, key)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropOnCell(event, calendar.id, key)}
              >
                {(eventsByCell.get(`${calendar.id}|${key}`) ?? []).map(chip)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
