import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, ApiError } from '../api';
import { useAuth } from '../app-context';
import { EventReadonlyDialog } from '../components/EventReadonlyDialog';
import { effectiveTimeZone, formatDate } from '../format';
import { useI18n } from '../i18n';
import type { EventSearchResponse, EventSearchResult } from '../types';

export function SearchPage() {
  const { user, settings } = useAuth();
  const { t, errorMessage, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').trim();
  const [input, setInput] = useState(query);
  const [response, setResponse] = useState<EventSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<EventSearchResult | null>(null);

  useEffect(() => {
    setInput(query);
    if (!query) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    apiGet<EventSearchResponse>(`/events/search?q=${encodeURIComponent(query)}`)
      .then((data) => {
        if (active) setResponse(data);
      })
      .catch((err) => {
        if (active) {
          setResponse(null);
          setError(errorMessage(err instanceof ApiError ? err.code : 'common.error'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, errorMessage]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (!next) {
      setParams({});
      return;
    }
    setParams({ q: next });
  }

  const timeZone = settings
    ? effectiveTimeZone(user?.timezone, settings.defaultTimezone)
    : 'UTC';

  function dateLabel(item: EventSearchResponse['results'][number]): string {
    const start = item.allDay ? `${item.start.slice(0, 10)}T12:00:00.000Z` : item.start;
    return formatDate(start, {
      locale,
      timeZone: item.allDay ? 'UTC' : timeZone,
      dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
      timeFormat: settings?.timeFormat ?? '24',
      allDay: item.allDay,
      withTime: true
    });
  }

  return (
    <div className="search-page">
      <div className="page-heading">
        <h1>{t('search.title')}</h1>
      </div>
      <section className="panel search-panel">
        <form className="search-bar" onSubmit={submit}>
          <input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            autoFocus
          />
          <button type="submit" className="button primary" disabled={!input.trim() || loading}>
            {t('search.submit')}
          </button>
        </form>
        <p className="muted search-hint">{t('search.hint')}</p>

        {loading && <p className="muted">{t('common.loading')}</p>}
        {error && <div className="form-error">{error}</div>}
        {!loading && !error && query && response && response.results.length === 0 && (
          <p className="muted search-empty">{t('search.empty')}</p>
        )}
        {!loading && !error && query && response && response.results.length > 0 && (
          <div className="search-results">
            <p className="search-count">
              {response.total} {t('search.results')}
            </p>
            <div className="table-wrap">
              <table className="data-table search-table">
                <thead>
                  <tr>
                    <th>{t('search.eventTitle')}</th>
                    <th>{t('search.description')}</th>
                    <th>{t('search.date')}</th>
                    <th>{t('search.category')}</th>
                    <th>{t('search.participants')}</th>
                  </tr>
                </thead>
                <tbody>
                  {response.results.map((item) => (
                    <tr key={item.id} className="search-row" onClick={() => setSelected(item)}>
                      <td className="search-title">
                        <button
                          type="button"
                          className="report-event-link"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelected(item);
                          }}
                        >
                          {item.title}
                        </button>
                      </td>
                      <td className="search-description" title={item.description || undefined}>
                        {item.description || <span className="muted">—</span>}
                      </td>
                      <td className="search-date">{dateLabel(item)}</td>
                      <td>
                        {item.categoryName ? (
                          <span className="search-category">
                            <span
                              className="search-category-dot"
                              style={{ background: item.categoryColor ?? 'var(--color-muted)' }}
                            />
                            {item.categoryName}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="search-participants">
                        {item.participants.length > 0 ? item.participants.join(', ') : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      {selected && (
        <EventReadonlyDialog
          eventId={selected.id}
          title={selected.title}
          calendarName={selected.calendarName}
          categoryName={selected.categoryName}
          participants={selected.participants}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
