import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlanningGrid } from '../components/PlanningGrid';
import { apiGet, apiPatch, apiPut, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { useI18n } from '../i18n';
import { formatDate, toDateInput, toDateTimeInput } from '../format';
import type { Calendar, Category, CustomView, Occurrence, User, ViewKind } from '../types';
import { EventDialog, draftFromOccurrence, type EventDraft } from '../components/EventDialog';
import { ViewsDialog } from '../components/ViewsDialog';

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
  const { user, settings, refresh } = useAuth();
  const { t, locale, errorMessage } = useI18n();
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
  const [timezoneNoticeDismissed, setTimezoneNoticeDismissed] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const viewsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewsMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (!viewsMenuRef.current?.contains(event.target as Node)) setViewsMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [viewsMenuOpen]);

  const firstDay = settings?.firstDay ?? 1;
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
    setSelected(calendarList.filter((calendar) => calendar.canView).map((calendar) => calendar.id));
  }, []);

  useEffect(() => {
    loadReferenceData()
      .catch(() => setError(t('common.error')))
      .finally(() => setLoading(false));
  }, [loadReferenceData, t]);

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
  }, [date, view, firstDay, selected, timeZone, t]);

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

  const allViewableCalendars = useMemo(
    () => calendars.filter((calendar) => calendar.canView).map((calendar) => calendar.id),
    [calendars]
  );

  function applyView(customView: CustomView) {
    const ids = calendars
      .filter((calendar) => customView.userIds.includes(calendar.ownerId) && calendar.canView)
      .map((calendar) => calendar.id);
    setSelected(ids);
    setActiveViewId(customView.id);
    setViewsMenuOpen(false);
  }

  function showAllResources() {
    setSelected(allViewableCalendars);
    setActiveViewId(null);
    setViewsMenuOpen(false);
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
    })} – ${formatDate(end.toISOString(), {
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

  async function handleMove(
    occurrence: Occurrence,
    start: string,
    end: string,
    targetCalendarId?: string
  ) {
    const body: Record<string, unknown> = { start, end };
    if (targetCalendarId && targetCalendarId !== occurrence.calendarId) {
      body.calendarId = targetCalendarId;
    }
    if (occurrence.recurring) {
      const occurrenceOnly = window.confirm(t('calendar.editOccurrenceQuestion'));
      body.scope = occurrenceOnly ? 'occurrence' : 'series';
      if (occurrenceOnly) {
        body.occurrenceStart = occurrence.occurrenceStart;
        delete body.calendarId;
      }
    }
    try {
      await apiPatch(`/events/${occurrence.eventId}`, body);
      showFlash(t('calendar.eventUpdated'));
      await loadEvents();
    } catch (err) {
      showFlash(err instanceof ApiError ? errorMessage(err.code) : t('calendar.moveError'));
    }
  }

  async function applyBrowserTimeZone() {
    try {
      await apiPut('/auth/me/preferences', { timezone: browserTimeZone });
      await refresh();
      showFlash(t('prefs.profileSaved'));
    } catch {
      showFlash(t('common.error'));
    }
  }

  if (!settings) return null;

  return (
    <div className="calendar-page">
      <section className="calendar-main">
        {timeZone !== browserTimeZone && !timezoneNoticeDismissed && (
          <div className="alert info timezone-alert">
            <span>
              {t('calendar.timezoneMismatch')} ({timeZone} / {browserTimeZone})
            </span>
            <button type="button" className="button small" onClick={() => void applyBrowserTimeZone()}>
              {t('prefs.useBrowserTimeZone')}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setTimezoneNoticeDismissed(true)}
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
        )}
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
              ‹
            </button>
            <button type="button" className="button small" onClick={() => setDate(new Date())}>
              {t('common.today')}
            </button>
            <button type="button" className="button small" onClick={() => shiftDate(1)}>
              ›
            </button>
          </div>
          <h2 className="period-label">{periodLabel()}</h2>
          <span className="timezone-badge" title={t('event.timezoneHint')}>
            {timeZone}
          </span>
          <div className="toolbar-menu" ref={viewsMenuRef}>
            <button
              type="button"
              className="button small"
              onClick={() => setViewsMenuOpen((current) => !current)}
            >
              {t('nav.views')} ▾
            </button>
            {viewsMenuOpen && (
              <div className="menu-popover">
                <button
                  type="button"
                  className={`menu-item ${activeViewId === null ? 'active' : ''}`}
                  onClick={showAllResources}
                >
                  {t('calendar.allResources')}
                </button>
                {views.length > 0 && <div className="menu-divider" />}
                {views.map((customView) => (
                  <button
                    key={customView.id}
                    type="button"
                    className={`menu-item ${activeViewId === customView.id ? 'active' : ''}`}
                    onClick={() => applyView(customView)}
                  >
                    <span>{customView.name}</span>
                    <small>{customView.isShared ? t('views.global') : t('views.personal')}</small>
                  </button>
                ))}
                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setViewsMenuOpen(false);
                    setViewsOpen(true);
                  }}
                >
                  {t('calendar.manageViews')}
                </button>
              </div>
            )}
          </div>
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

        {selected.length === 0 ? (
          <div className="empty-state">{t('calendar.emptySelection')}</div>
        ) : (
          <PlanningGrid
            view={view}
            date={date}
            calendars={selectedCalendars}
            events={events}
            settings={settings}
            timeZone={timeZone}
            onCreate={(calendarId, start, end, allDay) => openCreate(calendarId, start, end, allDay)}
            onEdit={openEdit}
            onMove={(occurrence, start, end, targetCalendarId) =>
              void handleMove(occurrence, start, end, targetCalendarId)
            }
          />
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
