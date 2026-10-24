import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import 'flag-icons/css/flag-icons.min.css';
import { countryLabel } from '../countries';
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

function CountryFlag({ code }: { code: string }) {
  const lower = code.toLowerCase();
  if (!/^[a-z]{2}$/.test(lower)) return null;
  return <span className={`fi fi-${lower} event-flag`} aria-hidden="true" />;
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

function descriptionText(description: string | null | undefined, html: boolean): string {
  const value = description?.trim();
  if (!value) return '';
  if (!html) return value;
  const parsed = new DOMParser().parseFromString(value, 'text/html');
  return (parsed.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
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
  const isMobile = useMediaQuery('(max-width: 900px)');
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

  const monthWeeks = useMemo(() => {
    const monthStart = `${anchorKey.slice(0, 7)}-01`;
    const monthEnd = `${anchorKey.slice(0, 7)}-${pad(daysInMonth(anchorKey))}`;
    const gridStart = startOfWeekKey(monthStart, settings.firstDay);
    const gridEnd = addDaysToKey(startOfWeekKey(monthEnd, settings.firstDay), 6);
    const weeks: string[][] = [];
    let current = gridStart;
    while (current <= gridEnd) {
      weeks.push(Array.from({ length: 7 }, (_, index) => addDaysToKey(current, index)));
      current = addDaysToKey(current, 7);
    }
    return weeks;
  }, [anchorKey, settings.firstDay]);

  const monthEventsByDay = useMemo(() => {
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
        const list = map.get(key) ?? [];
        list.push(occurrence);
        map.set(key, list);
        key = addDaysToKey(key, 1);
        guard += 1;
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.start.localeCompare(b.start) || a.title.localeCompare(b.title);
      });
    }
    return map;
  }, [events, timeZone]);

  const calendarById = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars]
  );

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

  function hoverTitle(occurrence: Occurrence, description: string): string {
    const heading = occurrence.holidayCountry
      ? `${countryLabel(occurrence.holidayCountry, locale)} \u2014 ${occurrence.title}`
      : occurrence.title;
    return description ? `${heading}\n\n${description}` : heading;
  }

  function displayTitle(occurrence: Occurrence) {
    return (
      <>
        {occurrence.holidayCountry && <CountryFlag code={occurrence.holidayCountry} />}
        {occurrence.title}
      </>
    );
  }

  function chip(occurrence: Occurrence) {
    const color = occurrence.categoryColor ?? occurrence.calendarColor;
    const description = descriptionText(occurrence.description, settings.allowHtmlDescription);
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
        title={hoverTitle(occurrence, description)}
      >
        {!occurrence.allDay && <span className="planning-event-time">{timeLabel(occurrence)}</span>}
        <span className="planning-event-title">{displayTitle(occurrence)}</span>
      </div>
    );
  }

  function monthChip(occurrence: Occurrence) {
    const color = occurrence.calendarColor;
    const owner = calendarById.get(occurrence.calendarId)?.ownerName ?? '';
    const time = occurrence.allDay ? '' : timeLabel(occurrence);
    const description = descriptionText(occurrence.description, settings.allowHtmlDescription);
    return (
      <div
        key={occurrence.id}
        className="month-event"
        style={{
          borderLeftColor: color,
          background: `color-mix(in srgb, ${color} 16%, transparent)`,
          color: 'var(--color-text)'
        }}
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
        title={`${owner ? `${owner} · ` : ''}${time ? `${time} · ` : ''}${hoverTitle(
          occurrence,
          description
        )}`}
      >
        {time && <span className="month-event-time">{time}</span>}
        <span className="month-event-title">{displayTitle(occurrence)}</span>
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

  if (isMobile) {
    const createCalendar = calendars.find((calendar) => calendar.canCreate);
    const visibleDays =
      view === 'month'
        ? dayKeys.filter((key) => (monthEventsByDay.get(key) ?? []).length > 0)
        : dayKeys;

    return (
      <div className="mobile-agenda">
        {visibleDays.length === 0 && (
          <div className="mobile-agenda-empty">{t('calendar.noEvents')}</div>
        )}
        {visibleDays.map((key) => {
          const list = monthEventsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <section key={key} className={`mobile-day ${isToday ? 'today' : ''}`}>
              <div className="mobile-day-head">
                <span className="mobile-day-name">
                  {formatHeader(key, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                </span>
                {isToday && <span className="mobile-today-pill">{t('common.today')}</span>}
                {createCalendar && (
                  <button
                    type="button"
                    className="mobile-day-add"
                    onClick={() => createInCell(createCalendar, key)}
                    aria-label={t('calendar.newEvent')}
                    title={t('calendar.newEvent')}
                  >
                    +
                  </button>
                )}
              </div>
              {list.length === 0 ? (
                <p className="mobile-day-empty">{t('calendar.noEvents')}</p>
              ) : (
                <div className="mobile-day-events">
                  {list.map((occurrence) => {
                    const color = occurrence.categoryColor ?? occurrence.calendarColor;
                    const owner = calendarById.get(occurrence.calendarId)?.ownerName ?? '';
                    const description = descriptionText(
                      occurrence.description,
                      settings.allowHtmlDescription
                    );
                    return (
                      <button
                        key={occurrence.id}
                        type="button"
                        className="mobile-event"
                        style={{
                          borderLeftColor: color,
                          background: `color-mix(in srgb, ${color} 11%, var(--color-surface))`
                        }}
                        onClick={() => onEdit(occurrence)}
                        title={hoverTitle(occurrence, description)}
                      >
                        <span className="mobile-event-time">{timeLabel(occurrence)}</span>
                        <span className="mobile-event-body">
                          <span className="mobile-event-title">{displayTitle(occurrence)}</span>
                          {owner && <span className="mobile-event-owner">{owner}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  const rowStyle = (columns: number) => ({
    gridTemplateColumns: `190px repeat(${columns}, minmax(96px, 1fr))`
  });

  const headerCell = (key: string) => {
    const isToday = key === todayKey;
    const weekday = formatHeader(key, locale, { weekday: 'short' });
    const day = formatHeader(key, locale, { day: '2-digit' });
    const month = formatHeader(key, locale, { month: 'short' });
    return (
      <div key={key} className={`planning-day-head ${isToday ? 'today' : ''}`}>
        <span className="planning-weekday">{weekday}</span>
        <span className="planning-day-number">{day}</span>
        <span className="planning-month">{month}</span>
      </div>
    );
  };

  if (view === 'month') {
    const createCalendar = calendars.find((calendar) => calendar.canCreate);
    const weekdays = monthWeeks[0].map((key) =>
      formatHeader(key, locale, { weekday: 'long' })
    );
    return (
      <div className="planning-scroll month-scroll">
        <div className="month-grid">
          <div className="month-head month-corner">{t('calendar.weekShort')}</div>
          {weekdays.map((label, index) => (
            <div className="month-head" key={`${label}-${index}`}>
              {label}
            </div>
          ))}
          {monthWeeks.map((week) => (
            <Fragment key={week[0]}>
              <div className="month-week-number">{isoWeek(week[0])}</div>
              {week.map((key) => {
                const list = monthEventsByDay.get(key) ?? [];
                const inMonth = key.slice(0, 7) === anchorKey.slice(0, 7);
                const isToday = key === todayKey;
                const weekend = weekdayOfKey(key) === 0 || weekdayOfKey(key) === 6;
                const background = isToday
                  ? 'var(--color-today-bg)'
                  : list.length > 0
                    ? 'var(--color-event-day-bg)'
                    : weekend
                      ? 'var(--color-weekend-bg)'
                      : !inMonth
                        ? 'var(--color-other-month-bg)'
                        : 'var(--color-cell-bg)';
                const className = [
                  'month-day',
                  !inMonth ? 'other-month' : '',
                  weekend ? 'weekend' : '',
                  isToday ? 'today' : '',
                  list.length > 0 ? 'has-events' : '',
                  createCalendar ? 'creatable' : ''
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <div
                    key={key}
                    className={className}
                    style={{ background }}
                    onClick={() => createCalendar && createInCell(createCalendar, key)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) =>
                      dropOnCell(event, dragged.current?.calendarId ?? createCalendar?.id ?? '', key)
                    }
                  >
                    <div className="month-day-head">
                      <span className="month-day-number">
                        {formatHeader(key, locale, { day: 'numeric' })}
                      </span>
                      {!inMonth && (
                        <span className="month-day-month">
                          {formatHeader(key, locale, { month: 'short' })}
                        </span>
                      )}
                    </div>
                    <div className="month-day-events">{list.map(monthChip)}</div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

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
          {dayKeys.map((key) => headerCell(key))}
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
