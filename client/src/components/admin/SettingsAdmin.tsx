import { useEffect, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../../api';
import { useAuth } from '../../app-context';
import { languageLabel, useI18n } from '../../i18n';
import type { AdminSettings, Language, ViewKind } from '../../types';

const timezones = [
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Luxembourg',
  'Europe/Geneva',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC'
];

const weekdays = [1, 2, 3, 4, 5, 6, 0];

export function SettingsAdmin() {
  const { t, locale, errorMessage } = useI18n();
  const { refresh } = useAuth();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [priorities, setPriorities] = useState('');
  const [visibilities, setVisibilities] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet<AdminSettings>('/settings')
      .then((data) => {
        setSettings(data);
        setPriorities(data.priorities.join(', '));
        setVisibilities(data.visibilityOptions.join(', '));
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  if (!settings) return <p className="muted">{t('common.loading')}</p>;

  function update<K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const body = {
        appName: settings.appName,
        baseUrl: settings.baseUrl,
        defaultLanguage: settings.defaultLanguage,
        defaultTimezone: settings.defaultTimezone,
        dateFormat: settings.dateFormat,
        timeFormat: settings.timeFormat,
        firstDay: settings.firstDay,
        weekendDays: settings.weekendDays,
        workHours: settings.workHours,
        defaultView: settings.defaultView,
        fields: settings.fields,
        allowHtmlDescription: settings.allowHtmlDescription,
        priorities: priorities
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        visibilityOptions: visibilities
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        sessionDurationDays: settings.sessionDurationDays
      };
      const updated = await apiPut<AdminSettings>('/settings', body);
      setSettings(updated);
      setFlash(t('admin.settingsSaved'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const weekdayName = (day: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(Date.UTC(2024, 0, 7 + day)));

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.generalTitle')}</h2>
        <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="panel">
        <div className="form-grid">
          <label>
            <span>{t('admin.appName')}</span>
            <input value={settings.appName} onChange={(event) => update('appName', event.target.value)} />
          </label>
          <label>
            <span>{t('admin.baseUrl')}</span>
            <input value={settings.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} />
          </label>
          <label>
            <span>{t('admin.defaultLanguage')}</span>
            <select
              value={settings.defaultLanguage}
              onChange={(event) => update('defaultLanguage', event.target.value as Language)}
            >
              <option value="fr">{languageLabel('fr')}</option>
              <option value="en">{languageLabel('en')}</option>
              <option value="de">{languageLabel('de')}</option>
            </select>
          </label>
          <label>
            <span>{t('admin.defaultTimezone')}</span>
            <select
              value={settings.defaultTimezone}
              onChange={(event) => update('defaultTimezone', event.target.value)}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('admin.dateFormat')}</span>
            <select value={settings.dateFormat} onChange={(event) => update('dateFormat', event.target.value)}>
              <option value="dd/MM/yyyy">dd/MM/yyyy</option>
              <option value="MM/dd/yyyy">MM/dd/yyyy</option>
              <option value="dd/MM">dd/MM</option>
              <option value="MM/yyyy">MM/yyyy</option>
            </select>
          </label>
          <label>
            <span>{t('admin.timeFormat')}</span>
            <select
              value={settings.timeFormat}
              onChange={(event) => update('timeFormat', event.target.value as '12' | '24')}
            >
              <option value="24">24 h</option>
              <option value="12">12 h</option>
            </select>
          </label>
          <label>
            <span>{t('admin.firstDay')}</span>
            <select
              value={settings.firstDay}
              onChange={(event) => update('firstDay', Number(event.target.value))}
            >
              {weekdays.map((day) => (
                <option key={day} value={day}>
                  {weekdayName(day)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('admin.defaultView')}</span>
            <select
              value={settings.defaultView}
              onChange={(event) => update('defaultView', event.target.value as ViewKind)}
            >
              <option value="day">{t('common.day')}</option>
              <option value="week">{t('common.week')}</option>
              <option value="month">{t('common.month')}</option>
            </select>
          </label>
          <label>
            <span>{t('admin.workHours')}</span>
            <div className="inline-fields">
              <input
                type="time"
                value={settings.workHours.start}
                onChange={(event) => update('workHours', { ...settings.workHours, start: event.target.value })}
              />
              <input
                type="time"
                value={settings.workHours.end}
                onChange={(event) => update('workHours', { ...settings.workHours, end: event.target.value })}
              />
            </div>
          </label>
          <label>
            <span>{t('admin.sessionDays')}</span>
            <input
              type="number"
              min={1}
              max={90}
              value={settings.sessionDurationDays}
              onChange={(event) => update('sessionDurationDays', Number(event.target.value))}
            />
          </label>
          <div className="span-2">
            <span className="field-label">{t('admin.weekendDays')}</span>
            <div className="weekday-picker">
              {weekdays.map((day) => (
                <label key={day} className="weekday">
                  <input
                    type="checkbox"
                    checked={settings.weekendDays.includes(day)}
                    onChange={(event) => {
                      const next = new Set(settings.weekendDays);
                      if (event.target.checked) next.add(day);
                      else next.delete(day);
                      update('weekendDays', Array.from(next).sort());
                    }}
                  />
                  <span>{weekdayName(day)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>{t('admin.fieldsTitle')}</h3>
        <div className="checkbox-grid">
          {(
            [
              ['location', 'admin.fieldLocation'],
              ['url', 'admin.fieldUrl'],
              ['priority', 'admin.fieldPriority'],
              ['visibility', 'admin.fieldVisibility'],
              ['participants', 'admin.fieldParticipants'],
              ['recurrence', 'admin.fieldRecurrence']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="checkbox">
              <input
                type="checkbox"
                checked={settings.fields[key]}
                onChange={(event) =>
                  update('fields', { ...settings.fields, [key]: event.target.checked })
                }
              />
              <span>{t(label)}</span>
            </label>
          ))}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.allowHtmlDescription}
              onChange={(event) => update('allowHtmlDescription', event.target.checked)}
            />
            <span>{t('admin.allowHtml')}</span>
          </label>
        </div>
        <div className="form-grid">
          <label>
            <span>{t('admin.priorities')}</span>
            <input value={priorities} onChange={(event) => setPriorities(event.target.value)} />
          </label>
          <label>
            <span>{t('admin.visibilities')}</span>
            <input value={visibilities} onChange={(event) => setVisibilities(event.target.value)} />
          </label>
        </div>
      </div>
    </div>
  );
}
