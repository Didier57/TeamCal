import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import type { AuditReportEntry, EventDetail, User } from '../types';

interface Props {
  entry: AuditReportEntry;
  users: User[];
  onClose: () => void;
}

export function AuditEventDialog({ entry, users, onClose }: Props) {
  const { settings } = useAuth();
  const { t, locale, errorMessage } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<EventDetail>(`/events/${entry.event.id}`)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err instanceof ApiError ? err.code : 'common.error'));
      });
    return () => {
      active = false;
    };
  }, [entry.event.id, errorMessage]);

  const event = detail?.event;
  const dateFormat = settings?.dateFormat ?? 'dd/MM/yyyy';
  const timeFormat = settings?.timeFormat ?? '24';

  function formatMoment(iso: string | null, allDay = false): string {
    if (!iso) return '—';
    return formatDate(allDay ? `${iso.slice(0, 10)}T12:00:00.000Z` : iso, {
      locale,
      timeZone: allDay ? 'UTC' : timeZone,
      dateFormat,
      timeFormat,
      allDay,
      withTime: true
    });
  }

  function eventRange(): string {
    if (!event) return '';
    const start = formatMoment(event.start, event.allDay);
    const end = formatMoment(event.end, event.allDay);
    return start === end ? start : `${start} – ${end}`;
  }

  const participants = event
    ? event.participantIds
        .map((id) => users.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is User => Boolean(candidate))
        .map((candidate) => `${candidate.firstName} ${candidate.lastName}`.trim() || candidate.username)
    : [];

  const deletedAt = event?.deletedAt ?? entry.event.deletedAt;
  const isDeleted = Boolean(deletedAt) || Boolean(event?.status === 'cancelled');

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(mouseEvent) => {
        if (mouseEvent.target === mouseEvent.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('reports.eventDetails')}>
        <div className="modal-header">
          <div>
            <h2>{event?.title ?? entry.event.title}</h2>
            {isDeleted && <span className="pill danger">{t('reports.deleted')}</span>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          {!error && !detail && <p className="muted">{t('common.loading')}</p>}
          {event && (
            <div className="event-view">
              {isDeleted && (
                <div className="event-view-notice">
                  <strong>{t('reports.deletedNotice')}</strong>
                  {deletedAt && (
                    <span>
                      {t('reports.deletedOn')} {formatMoment(deletedAt)}
                      {entry.action === 'deleted' && entry.actor.name ? ` · ${entry.actor.name}` : ''}
                    </span>
                  )}
                </div>
              )}
              <dl className="event-view-meta">
                <div>
                  <dt>{t('event.calendar')}</dt>
                  <dd>{entry.agenda?.name ?? entry.agenda?.username ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t('reports.date')}</dt>
                  <dd>{eventRange()}</dd>
                </div>
                {event.categoryName && (
                  <div>
                    <dt>{t('event.category')}</dt>
                    <dd>{event.categoryName}</dd>
                  </div>
                )}
                {event.location && (
                  <div>
                    <dt>{t('event.location')}</dt>
                    <dd>{event.location}</dd>
                  </div>
                )}
              </dl>
              <h3>{t('event.description')}</h3>
              {event.description ? (
                settings?.allowHtmlDescription ? (
                  <div
                    className="event-view-description"
                    dangerouslySetInnerHTML={{ __html: event.description }}
                  />
                ) : (
                  <p className="event-view-description">{event.description}</p>
                )
              ) : (
                <p className="muted">—</p>
              )}
              <h3>{t('event.participants')}</h3>
              <p className="event-view-participants">
                {participants.length > 0 ? participants.join(', ') : <span className="muted">—</span>}
              </p>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
