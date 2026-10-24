import { useEffect, useState } from 'react';
import { apiGet, ApiError } from '../api';
import { useAuth, useEffectiveTimeZone } from '../app-context';
import { formatDate } from '../format';
import { useI18n } from '../i18n';
import type { SettingChange, SystemReportEntry, SystemReportResponse } from '../types';

const SETTING_LABELS: Record<string, string> = {
  appName: 'admin.appName',
  baseUrl: 'admin.baseUrl',
  defaultLanguage: 'admin.defaultLanguage',
  defaultTimezone: 'admin.defaultTimezone',
  dateFormat: 'admin.dateFormat',
  timeFormat: 'admin.timeFormat',
  firstDay: 'admin.firstDay',
  weekendDays: 'admin.weekendDays',
  workHours: 'admin.workHours',
  defaultView: 'admin.defaultView',
  allowHtmlDescription: 'admin.allowHtml',
  allowUserColors: 'theme.allowUserColors',
  priorities: 'admin.priorities',
  visibilityOptions: 'admin.visibilities',
  holidaySources: 'admin.holidaySourcesTitle',
  sessionDurationDays: 'admin.sessionDays',
  'fields.location': 'admin.fieldLocation',
  'fields.url': 'admin.fieldUrl',
  'fields.priority': 'admin.fieldPriority',
  'fields.visibility': 'admin.fieldVisibility',
  'fields.participants': 'admin.fieldParticipants',
  'fields.recurrence': 'admin.fieldRecurrence',
  'smtp.host': 'admin.smtpHost',
  'smtp.port': 'admin.smtpPort',
  'smtp.secure': 'admin.smtpSecure',
  'smtp.user': 'admin.smtpUser',
  'smtp.password': 'admin.smtpPassword',
  'smtp.fromName': 'admin.smtpFromName',
  'smtp.fromEmail': 'admin.smtpFromEmail',
  'backup.enabled': 'admin.backupEnabled',
  'backup.host': 'admin.backupHost',
  'backup.share': 'admin.backupShare',
  'backup.username': 'admin.backupUsername',
  'backup.password': 'admin.backupPassword',
  'backup.domain': 'admin.backupDomain',
  'backup.folder': 'admin.backupFolder',
  'backup.day': 'admin.backupDay',
  'backup.time': 'admin.backupTime',
  'backup.keep': 'admin.backupKeep'
};

const THEME_LABELS: Record<string, string> = {
  background: 'theme.background',
  documentTitle: 'theme.documentTitle',
  text: 'theme.documentText',
  eventText: 'theme.eventText',
  border: 'theme.gridColor',
  headerBackground: 'theme.headerBackground',
  headerText: 'theme.headerText',
  cellBackground: 'theme.cellBackground',
  todayBackground: 'theme.todayBackground',
  eventDayBackground: 'theme.eventDayBackground',
  weekendBackground: 'theme.weekendBackground',
  otherMonthBackground: 'theme.otherMonthBackground',
  weekNumberColor: 'theme.weekNumberColor',
  eventDetailsBackground: 'theme.eventDetailsBackground',
  eventDetailsText: 'theme.eventDetailsText'
};

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

  function settingLabel(path: string): string {
    if (path.startsWith('theme.light.') || path.startsWith('theme.dark.')) {
      const mode = path.startsWith('theme.light.') ? t('common.light') : t('common.dark');
      const key = path.slice(path.lastIndexOf('.') + 1);
      const label = THEME_LABELS[key];
      return `${mode} · ${label ? t(label) : key}`;
    }
    const label = SETTING_LABELS[path];
    return label ? t(label) : path;
  }

  function settingValue(value: string | undefined): string {
    if (value === undefined || value === '') return t('reports.systemDetail.empty');
    if (value === 'true') return t('common.yes');
    if (value === 'false') return t('common.no');
    return value.length > 160 ? `${value.slice(0, 159)}…` : value;
  }

  function settingChangeLines(entry: SystemReportEntry): string[] {
    const raw = entry.details.changes;
    const changes = Array.isArray(raw)
      ? raw.filter(
          (change): change is SettingChange =>
            Boolean(change) &&
            typeof change === 'object' &&
            typeof (change as SettingChange).path === 'string'
        )
      : [];
    if (changes.length > 0) {
      const lines = changes.slice(0, 8).map((change) => {
        const label = settingLabel(change.path);
        if (change.secret) {
          return `${label} : ${t('reports.systemDetail.secretChanged')}`;
        }
        return `${label} : ${settingValue(change.before)} → ${settingValue(change.after)}`;
      });
      if (changes.length > 8) {
        lines.push(
          t('reports.systemDetail.more').replace('{count}', String(changes.length - 8))
        );
      }
      return lines;
    }
    const keys = entry.details.keys;
    if (Array.isArray(keys) && keys.length > 0) {
      return [`${t('reports.systemDetail.keys')} ${keys.slice(0, 12).join(', ')}`];
    }
    return [];
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
    if (entry.action === 'settings.updated') {
      lines.push(...settingChangeLines(entry));
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
                        {lines.map((line, index) => (
                          <small key={`${entry.id}-${index}`} className="system-action-detail">
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
