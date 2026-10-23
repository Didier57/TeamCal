import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from '../../api';
import { countryLabel, EUROPEAN_COUNTRY_CODES } from '../../countries';
import { useI18n } from '../../i18n';
import type { AdminHoliday, AdminSettings, HolidaySource, HolidaySyncResult } from '../../types';

function newHolidaySourceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `holiday-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function HolidaysAdmin() {
  const { t, locale, errorMessage } = useI18n();
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [holidays, setHolidays] = useState<AdminHoliday[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [newCountry, setNewCountry] = useState('LU');
  const [newDate, setNewDate] = useState(today);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    Promise.all([apiGet<AdminSettings>('/settings'), apiGet<AdminHoliday[]>('/holidays/admin')])
      .then(([loadedSettings, loadedHolidays]) => {
        setSettings(loadedSettings);
        setHolidays(loadedHolidays);
      })
      .catch(() => setError(t('common.error')));
  }, [t]);

  if (!settings) return <p className="muted">{t('common.loading')}</p>;

  async function reloadHolidays() {
    setHolidays(await apiGet<AdminHoliday[]>('/holidays/admin'));
  }

  async function saveSources() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const updated = await apiPut<AdminSettings>('/settings', {
        holidaySources: settings.holidaySources
      });
      setSettings(updated);
      const result = await apiPost<HolidaySyncResult>('/holidays/sync');
      await reloadHolidays();
      setFlash(
        `${t('admin.holidaysSynced')} ${result.users} ${t('admin.holidaysUsers')} ${
          result.created + result.updated
        } ${t('admin.holidaysEvents')}`
      );
      if (result.errors.length) setError(result.errors.join(' | '));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    setError(null);
    setFlash(null);
    try {
      const result = await apiPost<HolidaySyncResult>('/holidays/sync');
      await reloadHolidays();
      setFlash(
        `${t('admin.holidaysSynced')} ${result.users} ${t('admin.holidaysUsers')} ${
          result.created + result.updated
        } ${t('admin.holidaysEvents')}`
      );
      if (result.errors.length) setError(result.errors.join(' | '));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setSyncing(false);
    }
  }

  function addHolidaySource() {
    if (!settings) return;
    setSettings({
      ...settings,
      holidaySources: [
        ...(settings.holidaySources ?? []),
        { id: newHolidaySourceId(), country: 'LU', url: '', name: '' }
      ]
    });
  }

  function updateHolidaySource(id: string, patch: Partial<HolidaySource>) {
    if (!settings) return;
    setSettings({
      ...settings,
      holidaySources: settings.holidaySources.map((source) =>
        source.id === id ? { ...source, ...patch } : source
      )
    });
  }

  function removeHolidaySource(id: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      holidaySources: settings.holidaySources.filter((source) => source.id !== id)
    });
  }

  async function addManualHoliday() {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiPost('/holidays/admin', {
        country: newCountry,
        date: newDate,
        title: newTitle.trim()
      });
      setNewTitle('');
      await reloadHolidays();
      setFlash(t('admin.holidayAdded'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(holiday: AdminHoliday) {
    setEditingKey(holiday.key);
    setEditTitle(holiday.title);
  }

  async function saveTitle(holiday: AdminHoliday) {
    const title = editTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiPatch(`/holidays/admin/${encodeURIComponent(holiday.key)}`, { title });
      setHolidays((current) =>
        current.map((item) => (item.key === holiday.key ? { ...item, title } : item))
      );
      setEditingKey(null);
      setFlash(t('admin.holidayUpdated'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteHoliday(holiday: AdminHoliday) {
    if (!window.confirm(t('admin.holidayDeleteConfirm'))) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiDelete(`/holidays/admin/${encodeURIComponent(holiday.key)}`);
      setHolidays((current) => current.filter((item) => item.key !== holiday.key));
      setFlash(t('admin.holidayDeleted'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(`${date}T00:00:00Z`));

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.holidaysTitle')}</h2>
        <button type="button" className="button primary" disabled={busy} onClick={() => void saveSources()}>
          {t('common.save')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="panel">
        <h3>{t('admin.holidaySourcesTitle')}</h3>
        <p className="muted">{t('admin.holidaysHelp')}</p>
        <div className="holiday-source-list">
          {settings.holidaySources.map((source) => (
            <div className="holiday-source-row" key={source.id}>
              <select
                value={source.country}
                onChange={(event) => updateHolidaySource(source.id, { country: event.target.value })}
                aria-label={t('admin.holidayCountry')}
              >
                {EUROPEAN_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryLabel(code, locale)}
                  </option>
                ))}
              </select>
              <input
                value={source.url}
                placeholder={t('admin.holidayUrl')}
                onChange={(event) => updateHolidaySource(source.id, { url: event.target.value })}
              />
              <input
                value={source.name}
                placeholder={t('admin.holidayName')}
                onChange={(event) => updateHolidaySource(source.id, { name: event.target.value })}
              />
              <button
                type="button"
                className="button small danger"
                onClick={() => removeHolidaySource(source.id)}
              >
                {t('common.remove')}
              </button>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <button type="button" className="button" onClick={addHolidaySource}>
            + {t('admin.addHolidaySource')}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void syncNow()}
            disabled={syncing || busy}
          >
            {t('admin.syncHolidays')}
          </button>
        </div>
      </div>

      <div className="panel">
        <h3>{t('admin.holidayListTitle')}</h3>
        <p className="muted">{t('admin.holidayListHelp')}</p>
        {holidays.length === 0 ? (
          <p className="muted">{t('admin.noHolidays')}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('admin.holidayDate')}</th>
                  <th>{t('common.country')}</th>
                  <th>{t('admin.holidayLabel')}</th>
                  <th>{t('admin.holidayUsers')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((holiday) => (
                  <tr key={holiday.key}>
                    <td>{formatDate(holiday.date)}</td>
                    <td>{countryLabel(holiday.country, locale)}</td>
                    <td>
                      {editingKey === holiday.key ? (
                        <input
                          className="holiday-title-input"
                          autoFocus
                          value={editTitle}
                          onChange={(event) => setEditTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveTitle(holiday);
                            if (event.key === 'Escape') setEditingKey(null);
                          }}
                        />
                      ) : (
                        holiday.title
                      )}
                    </td>
                    <td>{holiday.users}</td>
                    <td>
                      <div className="row-actions">
                        {editingKey === holiday.key ? (
                          <>
                            <button
                              type="button"
                              className="button small primary"
                              disabled={busy}
                              onClick={() => void saveTitle(holiday)}
                            >
                              {t('common.save')}
                            </button>
                            <button
                              type="button"
                              className="button small"
                              onClick={() => setEditingKey(null)}
                            >
                              {t('common.cancel')}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="button small"
                              onClick={() => startEdit(holiday)}
                            >
                              {t('common.edit')}
                            </button>
                            <button
                              type="button"
                              className="button small danger"
                              disabled={busy}
                              onClick={() => void deleteHoliday(holiday)}
                            >
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="holiday-manual-form">
          <select value={newCountry} onChange={(event) => setNewCountry(event.target.value)}>
            {EUROPEAN_COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {countryLabel(code, locale)}
              </option>
            ))}
          </select>
          <input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} />
          <input
            value={newTitle}
            placeholder={t('admin.holidayTitlePlaceholder')}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addManualHoliday();
            }}
          />
          <button
            type="button"
            className="button primary"
            disabled={busy || !newTitle.trim()}
            onClick={() => void addManualHoliday()}
          >
            {t('admin.addManualHoliday')}
          </button>
        </div>
      </div>
    </div>
  );
}
