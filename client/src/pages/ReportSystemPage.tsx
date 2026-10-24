import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import type { SystemReportEntry, SystemReportResponse } from '../types';

function numeric(
  details: SystemReportEntry['details'],
  key: string
): number | null {
  const value = details[key];
  return typeof value === 'number' ? value : null;
}

export function ReportSystemPage() {
  const { settings } = useAuth();
  const { t, locale, errorMessage } = useI18n();
  const timeZone = useEffectiveTimeZone();
  const [entries, setEntries] = useState<SystemReportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiGet<SystemReportResponse>('/reports/system')
      .then((report) => {
        if (active) setEntries(report.entries);
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

  function dateLabel(entry: SystemReportEntry): string {
    return formatDate(entry.createdAt, {
      locale,
      timeZone,
      dateFormat: settings?.dateFormat ?? 'dd/MM/yyyy',
      timeFormat: settings?.timeFormat ?? '24',
      withTime: true
    });
  }

  function actionGroup(action: string): string {
    if (action.startsWith('auth.')) return 'auth';
    if (action.startsWith('user.')) return 'user';
    if (action === 'events.imported') return 'import';
    if (action === 'settings.updated') return 'settings';
    return 'other';
  }

  function detailLines(entry: SystemReportEntry): string[] {
    const lines: string[] = [];
    if (entry.action === 'auth.login_failed') {
      const username = entry.details.username;
      if (typeof username === 'string' && username) {
        lines.push(`${t('reports.systemDetail.username')} "${username}"`);
      }
    }
    if (entry.ip && entry.action.startsWith('auth.')) {
      lines.push(`${t('reports.systemDetail.ip')} "${entry.ip}"`);
    }
    if (entry.action === 'events.imported') {
      const imported = numeric(entry.details, 'imported');
      const updated = numeric(entry.details, 'updated');
      const skipped = numeric(entry.details, 'skipped');
      const exceptions = numeric(entry.details, 'exceptions');
      if (imported !== null) {
        lines.push(`${t('reports.systemDetail.imported')} ${imported}`);
      }
      if (updated !== null) {
        lines.push(`${t('reports.systemDetail.updated')} ${updated}`);
      }
      if (skipped !== null) {
        lines.push(`${t('reports.systemDetail.skipped')} ${skipped}`);
      }
      if (exceptions !== null) {
        lines.push(`${t('reports.systemDetail.exceptions')} ${exceptions}`);
      }
    }
    return lines;
  }

  return (
    <div className="report-page">
      <div className="page-heading">
        <h1>{t('reports.systemLog')}</h1>
      </div>
      <section className="panel">
        <p className="muted report-hint">{t('reports.systemHint')}</p>
        {loading && <p className="muted">{t('common.loading')}</p>}
        {error && <div className="form-error">{error}</div>}
        {!loading && !error && entries.length === 0 && (
          <p className="muted report-empty">{t('reports.systemEmpty')}</p>
        )}
        {!loading && !error && entries.length > 0 && (
          <div className="table-wrap report-results">
            <table className="data-table report-table system-table">
              <thead>
                <tr>
                  <th>{t('reports.user')}</th>
                  <th>{t('reports.target')}</th>
                  <th>{t('reports.date')}</th>
                  <th>{t('reports.action')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const lines = detailLines(entry);
                  return (
                    <tr key={entry.id}>
                      <td className="report-user">
                        <span title={entry.actor.username ?? undefined}>
                          {entry.actor.name || entry.actor.username || t('reports.systemActor')}
                        </span>
                      </td>
                      <td className="report-target">
                        {entry.target ? (
                          <>
                            <span title={entry.target.label}>{entry.target.label}</span>
                            {entry.target.username &&
                              entry.target.username !== entry.target.label && (
                                <small>{entry.target.username}</small>
                              )}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="report-date">{dateLabel(entry)}</td>
                      <td className="system-action-cell">
                        <span className={`system-action-label ${actionGroup(entry.action)}`}>
                          {t(`reports.systemAction.${entry.action}`)}
                        </span>
                        {lines.map((line) => (
                          <small key={line} className="system-action-detail">
                            {line}
                          </small>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
