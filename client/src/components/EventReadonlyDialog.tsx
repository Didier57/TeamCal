import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import type { EventDetail } from '../types';
import { EventHistory } from './EventHistory';

interface Props {
  eventId: string;
  title?: string;
  calendarName?: string | null;
  categoryName?: string | null;
  participants?: string[];
  onClose: () => void;
}

function labelFor(t: (key: string, fallback?: string) => string, prefix: string, value: string) {
  const translated = t(`${prefix}.${value}`);
  return translated === `${prefix}.${value}` ? value : translated;
}

export function EventReadonlyDialog({
  eventId,
  title,
  calendarName,
  categoryName,
  participants = [],
  onClose
}: Props) {
  const { settings } = useAuth();
  const { t, locale, errorMessage } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<EventDetail>(`/events/${eventId}`)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err instanceof ApiError ? err.code : 'common.error'));
      });
    return () => {
      active = false;
    };
  }, [eventId, errorMessage]);

  const event = detail?.event;
  const dateFormat = settings?.dateFormat ?? 'dd/MM/yyyy';
  const timeFormat = settings?.timeFormat ?? '24';

  function formatMoment(iso: string | null, allDay = false): string {
    if (!iso) return '\u2014';
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
    return start === end ? start : `${start} \u2013 ${end}`;
  }

  const priority =
    event?.priority && settings?.priorities[event.priority - 1]
      ? labelFor(t, 'priority', settings.priorities[event.priority - 1])
      : null;

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
            <h2>{event?.title ?? title ?? t('reports.eventDetails')}</h2>
            {event && (event.deletedAt || event.status === 'cancelled') && (
              <span className="pill danger">{t('reports.deleted')}</span>
            )}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('common.close')}>
            {'\u00d7'}
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error">{error}</div>}
          {!error && !detail && <p className="muted">{t('common.loading')}</p>}
          {event && (
            <div className="event-view">
              <dl className="event-view-meta">
                <div>
                  <dt>{t('event.calendar')}</dt>
                  <dd>{calendarName ?? '\u2014'}</dd>
                </div>
                <div>
                  <dt>{t('reports.date')}</dt>
                  <dd>{eventRange()}</dd>
                </div>
                <div>
                  <dt>{t('event.category')}</dt>
                  <dd>{event.categoryName ?? categoryName ?? '\u2014'}</dd>
                </div>
                {event.location && (
                  <div>
                    <dt>{t('event.location')}</dt>
                    <dd>{event.location}</dd>
                  </div>
                )}
                {priority && (
                  <div>
                    <dt>{t('event.priority')}</dt>
                    <dd>{priority}</dd>
                  </div>
                )}
                {event.visibility && (
                  <div>
                    <dt>{t('event.visibility')}</dt>
                    <dd>{labelFor(t, 'visibility', event.visibility)}</dd>
                  </div>
                )}
                {event.rrule && (
                  <div>
                    <dt>{t('event.recurrence')}</dt>
                    <dd>
                      <code>{event.rrule}</code>
                    </dd>
                  </div>
                )}
                {event.url && (
                  <div>
                    <dt>{t('event.url')}</dt>
                    <dd>
                      <a href={event.url} target="_blank" rel="noreferrer">
                        {event.url}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
              <EventHistory eventId={event.eventId} detail={detail} />
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
                <p className="muted">{'\u2014'}</p>
              )}
              <h3>{t('event.participants')}</h3>
              <p className="event-view-participants">
                {participants.length > 0 ? participants.join(', ') : <span className="muted">{'\u2014'}</span>}
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
