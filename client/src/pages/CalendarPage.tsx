import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlanningGrid } from '../components/PlanningGrid';
import { apiGet, apiPatch, apiPut, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { useI18n } from '../i18n';
import { formatDate, toDateInput, toDateTimeInput } from '../format';
import type {
  Calendar,
  Category,
  CustomView,
  EventConflictDetails,
  Occurrence,
  User,
  ViewKind
} from '../types';
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

function parseViewParam(value: string | null, fallback: ViewKind): ViewKind {
  return value === 'day' || value === 'week' || value === 'month' ? value : fallback;
}

function parseDateParam(value: string | null): Date {
  if (value) {
    const [year, month, day] = value.split('-').map(Number);
    if (year && month && day) {
      const parsed = new Date(year, month - 1, day, 12);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month - 1 &&
        parsed.getDate() === day
      ) {
        return parsed;
      }
    }
  }
  return new Date();
}

function localDateKey(date: Date): string {
  return (
    date.getFullYear().toString().padStart(4, '0') +
    '-' +
    (date.getMonth() + 1).toString().padStart(2, '0') +
    '-' +
    date.getDate().toString().padStart(2, '0')
  );
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ViewKind>(() =>
    parseViewParam(
      searchParams.get('kind'),
      user?.defaultView === 'day' || user?.defaultView === 'week' || user?.defaultView === 'month'
        ? user.defaultView
        : 'week'
    )
  );
  const [date, setDate] = useState<Date>(() => parseDateParam(searchParams.get('date')));
  const [events, setEvents] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [timezoneNoticeDismissed, setTimezoneNoticeDismissed] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const knownEventIds = useRef<Set<string> | null>(null);
  const pollInFlight = useRef(false);

  const requestedViewId = searchParams.get('view');

  const currentDateKey = localDateKey(date);

  useEffect(() => {
    if (searchParams.get('kind') === view && searchParams.get('date') === currentDateKey) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('kind', view);
        next.set('date', currentDateKey);
        return next;
      },
      { replace: true }
    );
  }, [view, currentDateKey, searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('manageViews') !== '1') return;
    setViewsOpen(true);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('manageViews');
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!requestedViewId || calendars.length === 0) return;
    if (requestedViewId === 'all') {
      setSelected(calendars.filter((calendar) => calendar.canView).map((calendar) => calendar.id));
      return;
    }
    const requestedView = views.find((customView) => customView.id === requestedViewId);
    if (!requestedView) return;
    setSelected(
      calendars
        .filter(
          (calendar) => requestedView.userIds.includes(calendar.ownerId) && calendar.canView
        )
        .map((calendar) => calendar.id)
    );
  }, [requestedViewId, views, calendars]);

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
    const preferred = user?.defaultView;
    const preferredView = preferred?.startsWith('view:')
      ? viewList.find((customView) => customView.id === preferred.slice('view:'.length))
      : undefined;
    if (preferredView) {
      setSelected(
        calendarList
          .filter(
            (calendar) =>
              preferredView.userIds.includes(calendar.ownerId) && calendar.canView
          )
          .map((calendar) => calendar.id)
      );
    } else {
      setSelected(calendarList.filter((calendar) => calendar.canView).map((calendar) => calendar.id));
    }
  }, [user?.defaultView]);

  useEffect(() => {
    loadReferenceData()
      .catch(() => setError(t('common.error')))
      .finally(() => setLoading(false));
  }, [loadReferenceData, t]);

  const loadEvents = useCallback(
    async (options?: { silent?: boolean; notify?: boolean }) => {
      if (selected.length === 0) {
        setEvents([]);
        knownEventIds.current = new Set();
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
        if (!options?.silent) setError(null);
        if (
          options?.notify &&
          knownEventIds.current &&
          user?.notifyNewEvents &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          const known = knownEventIds.current;
          const added = data.filter(
            (occurrence) => !known.has(occurrence.eventId) && occurrence.ownerId !== user.id
          );
          for (const occurrence of added.slice(0, 3)) {
            try {
              const notification = new Notification(
                t('calendar.newEventNotification').replace('{title}', occurrence.title),
                {
                  body: formatDate(occurrence.start, {
                    locale,
                    timeZone,
                    dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
                    timeFormat: settings?.timeFormat ?? '24',
                    withTime: !occurrence.allDay
                  })
                }
              );
              notification.onclick = () => {
                window.focus();
                notification.close();
              };
            } catch {
              break;
            }
          }
        }
        knownEventIds.current = new Set(data.map((occurrence) => occurrence.eventId));
      } catch {
        if (!options?.silent) setError(t('calendar.error'));
      }
    },
    [date, view, firstDay, selected, user?.id, user?.notifyNewEvents, timeZone, locale, settings?.dateFormat, settings?.timeFormat, t]
  );

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || dialog || viewsOpen) return;
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      void loadEvents({ silent: true, notify: true }).finally(() => {
        pollInFlight.current = false;
      });
    }, 20000);
    const onFocus = () => {
      if (dialog || viewsOpen || pollInFlight.current) return;
      pollInFlight.current = true;
      void loadEvents({ silent: true, notify: true }).finally(() => {
        pollInFlight.current = false;
      });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadEvents, dialog, viewsOpen]);

  const selectedCalendars = useMemo(
    () => calendars.filter((calendar) => selected.includes(calendar.id)),
    [calendars, selected]
  );

  const writableCalendar = useMemo(
    () => selectedCalendars.find((calendar) => calendar.canCreate) ?? calendars.find((c) => c.canCreate),
    [selectedCalendars, calendars]
  );

  useEffect(() => {
    if (searchParams.get('newEvent') !== '1' || !writableCalendar) return;
    const now = new Date();
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours() + 1,
      0
    );
    openCreate(writableCalendar.id, start, new Date(start.getTime() + 3600000), false);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('newEvent');
        return next;
      },
      { replace: true }
    );
  }, [searchParams, setSearchParams, writableCalendar]);

  function shiftDate(direction: number) {
    if (view === 'day') setDate((current) => addDays(current, direction));
    else if (view === 'week') setDate((current) => addDays(current, direction * 7));
    else setDate((current) => addMonths(current, direction));
  }

  function jumpToDate(value: string) {
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return;
    setDate(new Date(year, month - 1, day, 12));
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
    const targetCalendar = calendars.find((calendar) => calendar.id === calendarId);
    const defaultParticipant = targetCalendar?.ownerId ?? user?.id;
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
      participantIds: defaultParticipant ? [defaultParticipant] : [],
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
    const patch = (force = false) =>
      apiPatch(`/events/${occurrence.eventId}`, force ? { ...body, force: true } : body);
    try {
      await patch();
      showFlash(t('calendar.eventUpdated'));
      await loadEvents();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'event_conflict') {
        const details = err.details as EventConflictDetails | undefined;
        const conflicts = details?.conflicts ?? [];
        const total = details?.total ?? conflicts.length;
        const lines = conflicts.map((conflict) => {
          const when = conflict.allDay
            ? new Intl.DateTimeFormat(locale, {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                timeZone: 'UTC'
              }).format(new Date(`${conflict.start.slice(0, 10)}T00:00:00Z`))
            : new Intl.DateTimeFormat(locale, {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              }).format(new Date(conflict.start));
          return `• ${conflict.title} (${when})`;
        });
        const message = `${t('calendar.moveConflict').replace('{count}', String(total))}${
          lines.length ? `\n\n${lines.join('\n')}` : ''
        }`;
        if (!window.confirm(message)) return;
        try {
          await patch(true);
          showFlash(t('calendar.eventUpdated'));
          await loadEvents();
        } catch (retryError) {
          showFlash(
            retryError instanceof ApiError ? errorMessage(retryError.code) : t('calendar.moveError')
          );
        }
        return;
      }
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
          <input
            type="date"
            className="date-jump"
            value={toDateInput(date.toISOString(), timeZone)}
            onChange={(event) => jumpToDate(event.target.value)}
            aria-label={t('calendar.goToDate')}
            title={t('calendar.goToDate')}
          />
          <h2 className="period-label">{periodLabel()}</h2>
          <span className="timezone-badge" title={t('event.timezoneHint')}>
            {timeZone}
          </span>
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
