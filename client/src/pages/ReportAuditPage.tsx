import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { AuditEventDialog } from '../components/AuditEventDialog';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import type { AuditReportEntry, AuditReportResponse, User } from '../types';

export function ReportAuditPage() {
  const { settings } = useAuth();
  const { t, locale, errorMessage } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const [entries, setEntries] = useState<AuditReportEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<AuditReportEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([apiGet<AuditReportResponse>('/reports/audit'), apiGet<User[]>('/users/all')])
      .then(([report, userList]) => {
        if (!active) return;
        setEntries(report.entries);
        setUsers(userList);
      })
      .catch((err) => {
        if (active) setError(errorMessage(err instanceof ApiError ? err.code : 'common.error'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [errorMessage]);

  function dateLabel(entry: AuditReportEntry): string {
    return formatDate(entry.createdAt, {
      locale,
      timeZone,
      dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
      timeFormat: settings?.timeFormat ?? '24',
      withTime: true
    });
  }

  return (
    <div className="report-page">
      <div className="page-heading">
        <h1>{t('reports.audit')}</h1>
      </div>
      <section className="panel">
        <p className="muted report-hint">{t('reports.hint')}</p>
        {loading && <p className="muted">{t('common.loading')}</p>}
        {error && <div className="form-error">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <p className="muted report-empty">{t('reports.empty')}</p>
        )}
        {!loading && !error && entries.length > 0 && (
          <div className="table-wrap report-results">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>{t('reports.user')}</th>
                  <th>{t('reports.agenda')}</th>
                  <th>{t('reports.date')}</th>
                  <th>{t('reports.event')}</th>
                  <th>{t('reports.action')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="report-user">
                      <span title={entry.actor.username ?? undefined}>
                        {entry.actor.name || entry.actor.username || t('common.unknown')}
                      </span>
                    </td>
                    <td className="report-agenda">
                      {entry.agenda ? (
                        <span title={entry.agenda.ownerName || undefined}>
                          {entry.agenda.name || entry.agenda.username}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="report-date">{dateLabel(entry)}</td>
                    <td className="report-event">
                      {entry.event.available && entry.event.title ? (
                        <button
                          type="button"
                          className="report-event-link"
                          onClick={() => setSelected(entry)}
                        >
                          {entry.event.title}
                        </button>
                      ) : (
                        <span title={entry.event.available ? undefined : t('reports.unavailable')}>
                          {entry.event.title || t('reports.unavailable')}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`report-action ${entry.action}`}>
                        {t(`reports.action.${entry.action}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <AuditEventDialog entry={selected} users={users} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
