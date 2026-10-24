import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import type { EventDetail } from '../types';

interface Props {
  eventId: string;
  detail?: EventDetail | null;
}

const FIELD_KEYS: Record<string, string> = {
  allDay: 'event.allDay',
  timezone: 'event.timezoneHint'
};

export function EventHistory({ eventId, detail: provided }: Props) {
  const { settings } = useAuth();
  const { t, locale } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const [loaded, setLoaded] = useState<EventDetail | null>(null);

  useEffect(() => {
    if (provided) return;
    let active = true;
    apiGet<EventDetail>(`/events/${eventId}`)
      .then((data) => {
        if (active) setLoaded(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [eventId, provided]);

  const detail = provided ?? loaded;
  const event = detail?.event;
  if (!event) return null;

  const dateFormat = settings?.dateFormat ?? 'dd/MM/yyyy';
  const timeFormat = settings?.timeFormat ?? '24';

  function formatMoment(iso: string | null | undefined): string {
    if (!iso) return '\u2014';
    return formatDate(iso, { locale, timeZone, dateFormat, timeFormat, withTime: true });
  }

  function fieldLabel(field: string): string {
    return t(FIELD_KEYS[field] ?? `event.${field}`);
  }

  function actionLabel(action: string): string {
    if (action === 'created') return t('event.historyCreated');
    if (action === 'deleted') return t('event.historyDeleted');
    return t('event.historyUpdated');
  }

  const history = detail?.history ?? [];
  const showUpdated =
    Boolean(event.updatedAt) && event.updatedAt !== event.createdAt && history.some((e) => e.action === 'updated');

  return (
    <div className="event-history">
      <dl className="event-view-meta">
        <div>
          <dt>{t('event.createdOn')}</dt>
          <dd>
            {formatMoment(event.createdAt)}
            {event.createdByName ? <span className="muted">{' \u2014 '}{event.createdByName}</span> : null}
          </dd>
        </div>
        {showUpdated && (
          <div>
            <dt>{t('event.updatedOn')}</dt>
            <dd>
              {formatMoment(event.updatedAt)}
              {event.updatedByName ? <span className="muted">{' \u2014 '}{event.updatedByName}</span> : null}
            </dd>
          </div>
        )}
      </dl>
      <h4>{t('event.history')}</h4>
      {history.length === 0 ? (
        <p className="muted">{t('event.noHistory')}</p>
      ) : (
        <ul className="event-history-list">
          {history.map((entry) => (
            <li key={entry.id}>
              <span className="event-history-date">{formatMoment(entry.createdAt)}</span>
              <span className={`pill ${entry.action === 'deleted' ? 'danger' : ''}`}>
                {actionLabel(entry.action)}
              </span>
              <span className="event-history-actor">{entry.actorName || '\u2014'}</span>
              {entry.fields.length > 0 && (
                <span className="event-history-fields">
                  {entry.fields.map((field) => fieldLabel(field)).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
