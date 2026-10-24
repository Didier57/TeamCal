import { useMemo, useState, type FormEvent } from 'react';
import { apiDelete, apiPatch, apiPost, ApiError } from '../api';
import { useEffectiveTimeZone } from '../app-context';
import { useI18n } from '../i18n';
import { toDateInput, toDateTimeInput, wallTimeToUtc } from '../format';
import type {
  Calendar,
  Category,
  EventConflict,
  EventConflictDetails,
  Occurrence,
  PublicSettings,
  Recurrence,
  User
} from '../types';
import { parseRrule } from '../recurrence-utils';
import { EventHistory } from './EventHistory';
import { RecurrenceEditor } from './RecurrenceEditor';
import { RichTextEditor } from './RichTextEditor';

export interface EventDraft {
  calendarId: string;
  title: string;
  description: string;
  startInput: string;
  endInput: string;
  allDay: boolean;
  location: string;
  url: string;
  priority: number | null;
  visibility: string;
  categoryId: string | null;
  participantIds: string[];
  recurrence: Recurrence | null;
}

interface Props {
  mode: 'create' | 'edit';
  draft: EventDraft;
  occurrence?: Occurrence;
  calendars: Calendar[];
  categories: Category[];
  users: User[];
  settings: PublicSettings;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function labelFor(t: (key: string, fallback?: string) => string, prefix: string, value: string) {
  const translated = t(`${prefix}.${value}`);
  return translated === `${prefix}.${value}` ? value : translated;
}

export function draftFromOccurrence(occurrence: Occurrence, timeZone: string): EventDraft {
  return {
    calendarId: occurrence.calendarId,
    title: occurrence.title,
    description: occurrence.description ?? '',
    startInput: occurrence.allDay
      ? toDateInput(occurrence.start, timeZone)
      : toDateTimeInput(occurrence.start, timeZone),
    endInput: occurrence.allDay
      ? toDateInput(occurrence.end, timeZone)
      : toDateTimeInput(occurrence.end, timeZone),
    allDay: occurrence.allDay,
    location: occurrence.location ?? '',
    url: occurrence.url ?? '',
    priority: occurrence.priority ?? null,
    visibility: occurrence.visibility ?? 'default',
    categoryId: occurrence.categoryId ?? null,
    participantIds: occurrence.participantIds ?? [],
    recurrence: parseRrule(occurrence.rrule)
  };
}

export function EventDialog({
  mode,
  draft,
  occurrence,
  calendars,
  categories,
  users,
  settings,
  onClose,
  onSaved
}: Props) {
  const { t, locale, errorMessage } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [form, setForm] = useState<EventDraft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [participantFilter, setParticipantFilter] = useState('');
  const [conflicts, setConflicts] = useState<EventConflict[] | null>(null);
  const [conflictTotal, setConflictTotal] = useState(0);
  const [conflictScope, setConflictScope] = useState<'series' | 'occurrence' | null>(null);

  const creating = mode === 'create' || duplicating;
  const isRecurring = Boolean(!creating && occurrence?.recurring);
  const canDelete = Boolean(!creating && occurrence?.deletable);

  const availableCalendars = useMemo(
    () => calendars.filter((calendar) => (creating ? calendar.canCreate : calendar.canEdit)),
    [calendars, creating]
  );

  const filteredUsers = useMemo(() => {
    const query = participantFilter.trim().toLowerCase();
    return users
      .filter((candidate) => candidate.isActive)
      .filter((candidate) =>
        query
          ? `${candidate.firstName} ${candidate.lastName} ${candidate.username}`
              .toLowerCase()
              .includes(query)
          : true
      );
  }, [users, participantFilter]);

  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setConflicts(null);
    setConflictTotal(0);
    setConflictScope(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function clearConflicts() {
    setConflicts(null);
    setConflictTotal(0);
    setConflictScope(null);
  }

  function formatConflict(conflict: EventConflict): string {
    if (conflict.allDay) {
      return new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date(`${conflict.start.slice(0, 10)}T00:00:00Z`));
    }
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(conflict.start));
  }

  function validate(): string | null {
    if (!form.title.trim()) return t('event.requiredTitle');
    if (form.allDay) {
      if (form.endInput < form.startInput) return t('event.endBeforeStart');
    } else if (new Date(form.endInput) <= new Date(form.startInput)) {
      return t('event.endBeforeStart');
    }
    if (form.url && !/^https?:\/\//i.test(form.url)) return t('event.invalidUrl');
    return null;
  }

  function payload() {
    const start = form.allDay
      ? form.startInput.slice(0, 10)
      : wallTimeToUtc(form.startInput, timeZone);
    const end = form.allDay ? form.endInput.slice(0, 10) : wallTimeToUtc(form.endInput, timeZone);
    return {
      calendarId: form.calendarId,
      title: form.title.trim(),
      description: settings.allowHtmlDescription ? form.description : stripHtml(form.description),
      start,
      end,
      allDay: form.allDay,
      timezone: timeZone,
      location: settings.fields.location ? form.location || null : null,
      url: settings.fields.url ? form.url || null : null,
      priority: settings.fields.priority ? form.priority : null,
      visibility: settings.fields.visibility ? form.visibility : 'default',
      categoryId: form.categoryId,
      participantIds: settings.fields.participants ? form.participantIds : [],
      recurrence: settings.fields.recurrence ? form.recurrence : null
    };
  }

  async function doSave(scope: 'series' | 'occurrence', force = false) {
    const issue = validate();
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError(null);
    if (!force) clearConflicts();
    try {
      if (creating) {
        await apiPost('/events', force ? { ...payload(), force: true } : payload());
        onSaved(t('calendar.eventCreated'));
      } else if (occurrence) {
        const body: Record<string, unknown> = payload();
        if (scope === 'occurrence') {
          body.scope = 'occurrence';
          body.occurrenceStart = occurrence.occurrenceStart;
        } else {
          body.scope = 'series';
        }
        if (force) body.force = true;
        await apiPatch(`/events/${occurrence.eventId}`, body);
        onSaved(t('calendar.eventUpdated'));
      }
    } catch (err) {
      setBusy(false);
      setPending(null);
      if (err instanceof ApiError && err.code === 'event_conflict') {
        const details = err.details as EventConflictDetails | undefined;
        setConflicts(details?.conflicts ?? []);
        setConflictTotal(details?.total ?? details?.conflicts?.length ?? 0);
        setConflictScope(scope);
        setError(null);
        return;
      }
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    }
  }

  async function doDelete(scope: 'series' | 'occurrence') {
    if (!occurrence) return;
    setBusy(true);
    setError(null);
    try {
      if (scope === 'occurrence') {
        await apiDelete(
          `/events/${occurrence.eventId}?scope=occurrence&occurrenceStart=${encodeURIComponent(
            occurrence.occurrenceStart
          )}`
        );
      } else {
        await apiDelete(`/events/${occurrence.eventId}`);
      }
      onSaved(t('calendar.eventDeleted'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
      setBusy(false);
      setPending(null);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (isRecurring) {
      setPending('save');
      return;
    }
    void doSave('series');
  }

  function onDeleteClick() {
    if (isRecurring) {
      setPending('delete');
      return;
    }
    void doDelete('series');
  }

  function onDuplicate() {
    const creatable = calendars.filter((calendar) => calendar.canCreate);
    setDuplicating(true);
    setPending(null);
    setError(null);
    clearConflicts();
    setForm((current) => ({
      ...current,
      calendarId: creatable.some((calendar) => calendar.id === current.calendarId)
        ? current.calendarId
        : creatable[0]?.id ?? current.calendarId
    }));
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{creating ? t('event.new') : t('event.edit')}</h2>
          <span className="modal-header-actions">
            {!creating && (
              <button
                type="button"
                className="icon-button"
                onClick={onDuplicate}
                title={t('event.duplicate')}
                aria-label={t('event.duplicate')}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M15 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h.5" />
                </svg>
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
              ×
            </button>
          </span>
        </div>
        <form onSubmit={onSubmit}>
          <div className="modal-body">
            {pending && (
              <div className="scope-panel">
                <p>
                  {pending === 'save'
                    ? t('calendar.editOccurrenceQuestion')
                    : t('calendar.deleteOccurrenceQuestion')}
                </p>
                <div className="scope-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      pending === 'save' ? void doSave('occurrence') : void doDelete('occurrence')
                    }
                  >
                    {pending === 'save' ? t('calendar.editOccurrence') : t('calendar.deleteOccurrence')}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      pending === 'save' ? void doSave('series') : void doDelete('series')
                    }
                  >
                    {pending === 'save' ? t('calendar.editSeries') : t('calendar.deleteSeries')}
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    disabled={busy}
                    onClick={() => setPending(null)}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}
            {conflicts && (
              <div className="conflict-panel">
                <p>
                  {creating ? t('event.conflictQuestion') : t('event.conflictSaveQuestion')}
                </p>
                <ul className="conflict-list">
                  {conflicts.map((conflict) => (
                    <li key={`${conflict.eventId}:${conflict.occurrenceStart}`}>
                      <strong>{conflict.title}</strong>
                      <span>{formatConflict(conflict)}</span>
                    </li>
                  ))}
                </ul>
                {conflictTotal > conflicts.length && (
                  <p className="muted">
                    {t('event.moreConflicts').replace(
                      '{count}',
                      String(conflictTotal - conflicts.length)
                    )}
                  </p>
                )}
                <div className="scope-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy}
                    onClick={() => void doSave(conflictScope ?? 'series', true)}
                  >
                    {creating ? t('event.addAnyway') : t('event.saveAnyway')}
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={clearConflicts}
                  >
                    {t('event.modify')}
                  </button>
                </div>
              </div>
            )}
            <div className="form-grid">
              <label className="span-2">
                <span>{t('event.title')}</span>
                <input
                  value={form.title}
                  onChange={(event) => update('title', event.target.value)}
                  maxLength={200}
                  required
                  autoFocus
                />
              </label>
              <label>
                <span>{t('event.calendar')}</span>
                <select
                  value={form.calendarId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    clearConflicts();
                    setForm((current) => {
                      const previous = calendars.find((calendar) => calendar.id === current.calendarId);
                      const next = calendars.find((calendar) => calendar.id === nextId);
                      const replaceParticipant =
                        current.participantIds.length === 0 ||
                        (current.participantIds.length === 1 &&
                          previous !== undefined &&
                          current.participantIds[0] === previous.ownerId);
                      return {
                        ...current,
                        calendarId: nextId,
                        participantIds:
                          replaceParticipant && next ? [next.ownerId] : current.participantIds
                      };
                    });
                  }}
                >
                  {availableCalendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.ownerName} — {calendar.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t('event.category')}</span>
                <select
                  value={form.categoryId ?? ''}
                  onChange={(event) => update('categoryId', event.target.value || null)}
                >
                  <option value="">{t('common.none')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox span-2">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(event) => {
                    const allDay = event.target.checked;
                    setForm((current) => {
                      if (allDay) {
                        return {
                          ...current,
                          allDay,
                          startInput: current.startInput.slice(0, 10),
                          endInput: current.endInput.slice(0, 10)
                        };
                      }
                      const date = current.startInput.slice(0, 10);
                      return {
                        ...current,
                        allDay,
                        startInput: `${date}T09:00`,
                        endInput: `${date}T10:00`
                      };
                    });
                  }}
                />
                <span>{t('event.allDay')}</span>
              </label>
              <label>
                <span>{t('event.start')}</span>
                <input
                  type={form.allDay ? 'date' : 'datetime-local'}
                  value={form.startInput}
                  onChange={(event) => update('startInput', event.target.value)}
                  required
                />
              </label>
              <label>
                <span>{t('event.end')}</span>
                <input
                  type={form.allDay ? 'date' : 'datetime-local'}
                  value={form.endInput}
                  onChange={(event) => update('endInput', event.target.value)}
                  required
                />
              </label>
              <div className="span-2 timezone-hint">
                <small>
                  {t('event.timezoneHint')} : {timeZone}
                  {browserTimeZone && browserTimeZone !== timeZone ? ` — ${browserTimeZone}` : ''}
                </small>
              </div>
              {settings.fields.location && (
                <label>
                  <span>{t('event.location')}</span>
                  <input
                    value={form.location}
                    onChange={(event) => update('location', event.target.value)}
                    maxLength={300}
                  />
                </label>
              )}
              {settings.fields.url && (
                <label>
                  <span>{t('event.url')}</span>
                  <input
                    type="url"
                    value={form.url}
                    onChange={(event) => update('url', event.target.value)}
                    placeholder="https://"
                    maxLength={1000}
                  />
                </label>
              )}
              {settings.fields.priority && (
                <label>
                  <span>{t('event.priority')}</span>
                  <select
                    value={form.priority ?? 0}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      update('priority', value === 0 ? null : value);
                    }}
                  >
                    <option value={0}>{t('priority.none')}</option>
                    {settings.priorities.map((priority, index) => (
                      <option key={priority} value={index + 1}>
                        {labelFor(t, 'priority', priority)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {settings.fields.visibility && (
                <label>
                  <span>{t('event.visibility')}</span>
                  <select
                    value={form.visibility}
                    onChange={(event) => update('visibility', event.target.value)}
                  >
                    {settings.visibilityOptions.map((option) => (
                      <option key={option} value={option}>
                        {labelFor(t, 'visibility', option)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="span-2 rte-field">
                <span>{t('event.description')}</span>
                {settings.allowHtmlDescription ? (
                  <RichTextEditor
                    value={form.description}
                    onChange={(value) => update('description', value)}
                    placeholder={t('event.descriptionHint')}
                  />
                ) : (
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(event) => update('description', event.target.value)}
                    placeholder={t('event.descriptionHint')}
                  />
                )}
              </div>
              {settings.fields.participants && (
                <div className="span-2 participant-picker">
                  <span>{t('event.participants')}</span>
                  <input
                    className="participant-filter"
                    placeholder={t('common.select')}
                    value={participantFilter}
                    onChange={(event) => setParticipantFilter(event.target.value)}
                  />
                  <div className="participant-list">
                    {filteredUsers.map((candidate) => (
                      <label key={candidate.id} className="checkbox">
                        <input
                          type="checkbox"
                          checked={form.participantIds.includes(candidate.id)}
                          onChange={(event) => {
                            const ids = new Set(form.participantIds);
                            if (event.target.checked) ids.add(candidate.id);
                            else ids.delete(candidate.id);
                            update('participantIds', Array.from(ids));
                          }}
                        />
                        <span>
                          {`${candidate.firstName} ${candidate.lastName}`.trim() || candidate.username}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {settings.fields.recurrence && (
                <div className="span-2">
                  <span className="field-label">{t('event.recurrence')}</span>
                  <RecurrenceEditor
                    value={form.recurrence}
                    onChange={(value) => update('recurrence', value)}
                    startDate={form.startInput.slice(0, 10)}
                  />
                </div>
              )}
              {!creating && occurrence && (
                <div className="span-2">
                  <EventHistory eventId={occurrence.eventId} />
                </div>
              )}
            </div>
            {error && <div className="alert error">{error}</div>}
          </div>
          <div className="modal-footer">
            {!creating && canDelete && (
              <button
                type="button"
                className="button danger"
                onClick={onDeleteClick}
                disabled={busy}
              >
                {t('event.delete')}
              </button>
            )}
            <div className="spacer" />
            <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? t('event.saving') : t('event.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function stripHtml(value: string): string {
  const div = document.createElement('div');
  div.innerHTML = value;
  return div.textContent ?? '';
}
