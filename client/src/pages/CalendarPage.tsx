import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarInstance } from '../components/CalendarInstance';
import timeGridPlugin from '@fullcalendar/timegrid';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import frLocale from '@fullcalendar/core/locales/fr';
import enLocale from '@fullcalendar/core/locales/en-gb';
import deLocale from '@fullcalendar/core/locales/de';
import type { EventInput } from '@fullcalendar/core';
import { apiGet, apiPatch, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { useI18n } from '../i18n';
import {
  addDaysToDateKey,
  formatDate,
  formatDateTimeRange,
  toDateInput,
  toDateTimeInput
} from '../format';
import type { Calendar, Category, CustomView, Occurrence, User, ViewKind } from '../types';
import { EventDialog, draftFromOccurrence, type EventDraft } from '../components/EventDialog';
import { ViewsDialog } from '../components/ViewsDialog';

const locales = { fr: frLocale, en: enLocale, de: deLocale };

interface DialogState {
  mode: 'create' | 'edit';
  draft: EventDraft;
  occurrence?: Occurrence;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date, firstDay: number): Date {
  const day = date.getDay();
  const diff = (day - firstDay + 7) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - diff);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function rangeFor(date: Date, view: ViewKind, firstDay: number): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfDay(date);
    return { start, end: addDays(start, 1) };
  }
  if (view === 'week') {
    const start = startOfWeek(date, firstDay);
    return { start, end: addDays(start, 7) };
  }
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  return { start: addDays(first, -7), end: addDays(addMonths(first, 1), 7) };
}

export function CalendarPage() {
  const { user, settings } = useAuth();
  const { t, language, locale, errorMessage } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [views, setViews] = useState<CustomView[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<ViewKind>((user?.defaultView as ViewKind) || 'week');
  const [date, setDate] = useState<Date>(new Date());
  const [events, setEvents] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const flashTimer = useRef<number | null>(null);

  const firstDay = settings?.firstDay ?? 1;
  const storageKey = `teamcal_selected_${user?.id ?? 'anon'}`;

  const showFlash = useCallback((message: string) => {
    setFlash(message);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 4000);
  }, []);

  const loadReferenceData = useCallback(async () => {
    const [calendarList, categoryList, userList, viewList] = await Promise.all([
      apiGet<Calendar[]>('/calendars'),
      apiGet<Category[]>('/categories'),
      apiGet<User[]>('/users'),
      apiGet<CustomView[]>('/views')
    ]);
    setCalendars(calendarList);
    setCategories(categoryList);
    setUsers(userList);
    setViews(viewList);
    setSelected((current) => {
      if (current.length > 0) {
        const available = new Set(calendarList.filter((c) => c.canView).map((c) => c.id));
        const kept = current.filter((id) => available.has(id));
        if (kept.length > 0) return kept;
      }
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[];
        const available = new Set(calendarList.filter((c) => c.canView).map((c) => c.id));
        const kept = stored.filter((id) => available.has(id));
        if (kept.length > 0) return kept;
      } catch {
        // ignore
      }
      return calendarList.filter((c) => c.canView).map((c) => c.id);
    });
  }, [storageKey]);

  useEffect(() => {
    loadReferenceData()
      .catch(() => setError(t('common.error')))
      .finally(() => setLoading(false));
  }, [loadReferenceData, t]);

  useEffect(() => {
    if (selected.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(selected));
  }, [selected, storageKey]);

  const loadEvents = useCallback(async () => {
    if (selected.length === 0) {
      setEvents([]);
      return;
    }
    const range = rangeFor(date, view, firstDay);
    try {
      const data = await apiGet<Occurrence[]>(
        `/events?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(
          range.end.toISOString()
        )}&calendarIds=${encodeURIComponent(selected.join(','))}`
      );
      setEvents(data);
      setError(null);
    } catch {
      setError(t('calendar.error'));
    }
  }, [date, view, firstDay, selected, t]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const selectedCalendars = useMemo(
    () => calendars.filter((calendar) => selected.includes(calendar.id)),
    [calendars, selected]
  );

  const writableCalendar = useMemo(
    () => selectedCalendars.find((calendar) => calendar.canCreate) ?? calendars.find((c) => c.canCreate),
    [selectedCalendars, calendars]
  );

  const fcEvents = useMemo(
    () =>
      events.map<EventInput>((occurrence) => ({
        id: occurrence.id,
        title: occurrence.title,
        start: occurrence.start,
        end: occurrence.allDay ? addDaysToDateKey(occurrence.end, 1) : occurrence.end,
        allDay: occurrence.allDay,
        backgroundColor: occurrence.categoryColor ?? occurrence.calendarColor,
        borderColor: occurrence.categoryColor ?? occurrence.calendarColor,
        textColor: '#ffffff',
        extendedProps: { occurrence }
      })),
    [events]
  );

  const calendarEvents = useMemo(() => {
    const map = new Map<string, EventInput[]>();
    for (const item of fcEvents) {
      const occurrence = item.extendedProps?.occurrence as Occurrence;
      const list = map.get(occurrence.calendarId) ?? [];
      list.push(item);
      map.set(occurrence.calendarId, list);
    }
    return map;
  }, [fcEvents]);

  function toggleCalendar(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }

  function shiftDate(direction: number) {
    if (view === 'day') setDate((current) => addDays(current, direction));
    else if (view === 'week') setDate((current) => addDays(current, direction * 7));
    else setDate((current) => addMonths(current, direction));
  }

  function periodLabel(): string {
    if (view === 'day') {
      return new Intl.DateTimeFormat(locale, {
        timeZone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(date);
    }
    if (view === 'month') {
      return new Intl.DateTimeFormat(locale, { timeZone, month: 'long', year: 'numeric' }).format(date);
    }
    const start = startOfWeek(date, firstDay);
    const end = addDays(start, 6);
    return `${formatDate(start.toISOString(), {
      locale,
      timeZone,
      dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
      timeFormat: settings?.timeFormat ?? '24'
    })} â€“ ${formatDate(end.toISOString(), {
      locale,
      timeZone,
      dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
      timeFormat: settings?.timeFormat ?? '24'
    })}`;
  }

  function newDraft(
    calendarId: string,
    start: Date,
    end: Date,
    allDay: boolean,
    startKey?: string,
    endKey?: string
  ): EventDraft {
    return {
      calendarId,
      title: '',
      description: '',
      startInput: allDay
        ? startKey ?? toDateInput(start.toISOString(), timeZone)
        : toDateTimeInput(start.toISOString(), timeZone),
      endInput: allDay
        ? endKey ?? toDateInput(end.toISOString(), timeZone)
        : toDateTimeInput(end.toISOString(), timeZone),
      allDay,
      location: '',
      url: '',
      priority: null,
      visibility: 'default',
      categoryId: null,
      participantIds: user ? [user.id] : [],
      recurrence: null
    };
  }

  function openCreate(calendarId: string, start: Date, end: Date, allDay: boolean, startKey?: string, endKey?: string) {
    setDialog({ mode: 'create', draft: newDraft(calendarId, start, end, allDay, startKey, endKey) });
  }

  function openEdit(occurrence: Occurrence) {
    setDialog({
      mode: 'edit',
      occurrence,
      draft: draftFromOccurrence(occurrence, timeZone)
    });
  }

  async function handleDrop(changeInfo: any) {
    const occurrence = changeInfo.event.extendedProps?.occurrence as Occurrence | undefined;
    if (!occurrence) return;
    const start = changeInfo.event.start;
    const end = changeInfo.event.end ?? new Date((start?.getTime() ?? Date.now()) + 3600000);
    if (!start) return;
    const body: Record<string, unknown> = {
      start: occurrence.allDay ? changeInfo.event.startStr.slice(0, 10) : start.toISOString(),
      end: occurrence.allDay
        ? addDaysToDateKey(changeInfo.event.endStr.slice(0, 10), -1)
        : end.toISOString()
    };
    if (occurrence.recurring) {
      const occurrenceOnly = window.confirm(t('calendar.editOccurrenceQuestion'));
      body.scope = occurrenceOnly ? 'occurrence' : 'series';
      if (occurrenceOnly) body.occurrenceStart = occurrence.occurrenceStart;
    }
    try {
      await apiPatch(`/events/${occurrence.eventId}`, body);
      showFlash(t('calendar.eventUpdated'));
      await loadEvents();
    } catch (err) {
      changeInfo.revert();
      showFlash(err instanceof ApiError ? errorMessage(err.code) : t('calendar.moveError'));
    }
  }

  if (!settings) return null;

  const calendarProps = {
    plugins: [timeGridPlugin, dayGridPlugin, interactionPlugin],
    headerToolbar: false as const,
    locale: locales[language],
    firstDay,
    timeZone,
    nowIndicator: true,
    slotDuration: '00:30:00',
    scrollTime: `${settings.workHours.start}:00`,
    businessHours: {
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6].filter((day) => !settings.weekendDays.includes(day)),
      startTime: settings.workHours.start,
      endTime: settings.workHours.end
    },
    eventTimeFormat: {
      hour: '2-digit' as const,
      minute: '2-digit' as const,
      hour12: settings.timeFormat === '12'
    },
    height: 'auto' as const,
    eventDrop: (info: any) => void handleDrop(info),
    eventResize: (info: any) => void handleDrop(info),
    eventClick: (info: any) => {
      const occurrence = info.event.extendedProps?.occurrence as Occurrence | undefined;
      if (occurrence) openEdit(occurrence);
    }
  };

  return (
    <div className="calendar-page">
      <aside className="calendar-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-heading">
            <h3>{t('calendar.resources')}</h3>
            <div className="mini-actions">
              <button type="button" className="link" onClick={() => setSelected(calendars.filter((c) => c.canView).map((c) => c.id))}>
                {t('calendar.showAll')}
              </button>
              <button type="button" className="link" onClick={() => setSelected([])}>
                {t('calendar.hideAll')}
              </button>
            </div>
          </div>
          <div className="resource-list">
            {calendars.length === 0 && <p className="muted">{t('calendar.noResources')}</p>}
            {calendars.map((calendar) => (
              <label key={calendar.id} className="resource-row">
                <input
                  type="checkbox"
                  checked={selected.includes(calendar.id)}
                  onChange={() => toggleCalendar(calendar.id)}
                />
                <span className="color-dot" style={{ background: calendar.color }} />
                <span className="resource-name">{calendar.ownerName}</span>
                {calendar.isOwner && <span className="badge">{t('calendar.owner')}</span>}
              </label>
            ))}
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-heading">
            <h3>{t('calendar.views')}</h3>
            <button type="button" className="link" onClick={() => setViewsOpen(true)}>
              {t('calendar.manageViews')}
            </button>
          </div>
          <div className="view-list">
            {views.length === 0 && <p className="muted">{t('views.empty')}</p>}
            {views.map((customView) => (
              <button
                key={customView.id}
                type="button"
                className="view-row"
                onClick={() => {
                  const ids = calendars
                    .filter((calendar) => customView.userIds.includes(calendar.ownerId) && calendar.canView)
                    .map((calendar) => calendar.id);
                  setSelected(ids);
                }}
              >
                <span>{customView.name}</span>
                <small>{customView.isShared ? t('views.global') : t('views.personal')}</small>
              </button>
            ))}
          </div>
        </div>
        {categories.length > 0 && (
          <div className="sidebar-section">
            <h3>{t('calendar.legend')}</h3>
            <div className="legend">
              {categories.map((category) => (
                <span key={category.id} className="legend-item">
                  <span className="color-dot" style={{ background: category.color }} />
                  {category.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </aside>

      <section className="calendar-main">
        <div className="calendar-toolbar">
          <div className="view-switch">
            {(['day', 'week', 'month'] as ViewKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`button small ${view === kind ? 'active' : ''}`}
                onClick={() => setView(kind)}
              >
                {t(`common.${kind}`)}
              </button>
            ))}
          </div>
          <div className="period-nav">
            <button type="button" className="button small" onClick={() => shiftDate(-1)}>
              â€¹
            </button>
            <button type="button" className="button small" onClick={() => setDate(new Date())}>
              {t('common.today')}
            </button>
            <button type="button" className="button small" onClick={() => shiftDate(1)}>
              â€º
            </button>
          </div>
          <h2 className="period-label">{periodLabel()}</h2>
          <div className="spacer" />
          <button
            type="button"
            className="button primary"
            disabled={!writableCalendar}
            onClick={() => {
              if (!writableCalendar) return;
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
              openCreate(writableCalendar.id, start, new Date(start.getTime() + 3600000), false);
            }}
          >
            + {t('calendar.newEvent')}
          </button>
        </div>

        {flash && <div className="alert info">{flash}</div>}
        {error && <div className="alert error">{error}</div>}
        {view === 'month' && <p className="hint month-note">{t('calendar.monthNote')}</p>}

        {selected.length === 0 ? (
          <div className="empty-state">{t('calendar.emptySelection')}</div>
        ) : view === 'month' ? (
          <div className="calendar-single">
            <CalendarInstance
              {...calendarProps}
              viewKind="month"
              date={date}
              weekNumbers
              dayMaxEvents={4}
              events={fcEvents}
              selectable
              select={(info: any) => {
                if (!writableCalendar) return;
                openCreate(
                  writableCalendar.id,
                  info.start,
                  info.end,
                  info.allDay,
                  info.startStr,
                  addDaysToDateKey(info.endStr.slice(0, 10), -1)
                );
              }}
              dateClick={(info: any) => {
                if (!writableCalendar) return;
                const start = new Date(info.date);
                openCreate(
                  writableCalendar.id,
                  start,
                  new Date(start.getTime() + 3600000),
                  info.allDay,
                  info.dateStr,
                  info.dateStr
                );
              }}
            />
          </div>
        ) : (
          <div className="resource-columns">
            {selectedCalendars.map((calendar) => (
              <div key={calendar.id} className="resource-column">
                <div className="resource-column-header">
                  <span className="color-dot" style={{ background: calendar.color }} />
                  <strong>{calendar.ownerName}</strong>
                  {calendar.isOwner && <span className="badge">{t('calendar.owner')}</span>}
                </div>
                <CalendarInstance
                  {...calendarProps}
                  viewKind={view}
                  date={date}
                  weekNumbers={view === 'week'}
                  events={calendarEvents.get(calendar.id) ?? []}
                  selectable={calendar.canCreate}
                  select={(info: any) => {
                    if (!calendar.canCreate) return;
                    openCreate(
                      calendar.id,
                      info.start,
                      info.end,
                      info.allDay,
                      info.startStr,
                      info.allDay ? addDaysToDateKey(info.endStr.slice(0, 10), -1) : undefined
                    );
                  }}
                  dateClick={(info: any) => {
                    if (!calendar.canCreate) return;
                    const start = new Date(info.date);
                    openCreate(
                      calendar.id,
                      start,
                      new Date(start.getTime() + 3600000),
                      info.allDay,
                      info.dateStr,
                      info.dateStr
                    );
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {events.length === 0 && !loading && selected.length > 0 && (
          <p className="hint">{t('calendar.noEvents')}</p>
        )}
      </section>

      {dialog && (
        <EventDialog
          mode={dialog.mode}
          draft={dialog.draft}
          occurrence={dialog.occurrence}
          calendars={calendars}
          categories={categories}
          users={users}
          settings={settings}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            showFlash(message);
            void loadEvents();
          }}
        />
      )}

      {viewsOpen && (
        <ViewsDialog
          views={views}
          calendars={calendars}
          users={users}
          onClose={() => setViewsOpen(false)}
          onChanged={async () => {
            const list = await apiGet<CustomView[]>('/views');
            setViews(list);
          }}
        />
      )}
    </div>
  );
}
