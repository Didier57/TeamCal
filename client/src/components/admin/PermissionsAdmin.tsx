import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPut, ApiError } from '../../api';
import { useAuth } from '../../app-context';
import { useI18n } from '../../i18n';
import type { Calendar, CalendarAclEntry, User } from '../../types';

interface Entry {
  userId: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function PermissionsAdmin() {
  const { t, errorMessage } = useI18n();
  const { user } = useAuth();
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [calendarId, setCalendarId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newUserId, setNewUserId] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2f6feb');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const manageable = useMemo(
    () => calendars.filter((calendar) => calendar.isOwner || user?.isAdmin),
    [calendars, user?.isAdmin]
  );

  useEffect(() => {
    Promise.all([apiGet<Calendar[]>('/calendars'), apiGet<User[]>('/users')])
      .then(([calendarList, userList]) => {
        setCalendars(calendarList);
        setUsers(userList);
        const first = calendarList.find((calendar) => calendar.isOwner || user?.isAdmin);
        if (first) setCalendarId(first.id);
      })
      .catch(() => setError(t('common.error')));
  }, [t, user?.isAdmin]);

  const selected = manageable.find((calendar) => calendar.id === calendarId);

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setColor(selected.color);
    apiGet<CalendarAclEntry[]>(`/calendars/${selected.id}/acl`)
      .then((list) =>
        setEntries(
          list.map((entry) => ({
            userId: entry.userId,
            canView: entry.canView,
            canCreate: entry.canCreate,
            canEdit: entry.canEdit,
            canDelete: entry.canDelete
          }))
        )
      )
      .catch(() => setError(t('common.error')));
  }, [selected?.id, t]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await apiPut(`/calendars/${selected.id}`, { name, color });
      await apiPut(`/calendars/${selected.id}/acl`, { entries });
      const updated = await apiGet<Calendar[]>('/calendars');
      setCalendars(updated);
      setFlash(t('admin.aclSaved'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  function addEntry() {
    if (!newUserId || entries.some((entry) => entry.userId === newUserId)) return;
    setEntries([...entries, { userId: newUserId, canView: true, canCreate: false, canEdit: false, canDelete: false }]);
    setNewUserId('');
  }

  function updateEntry(userId: string, key: keyof Omit<Entry, 'userId'>, value: boolean) {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.userId !== userId) return entry;
        const next = { ...entry, [key]: value };
        if (value && key !== 'canView') next.canView = true;
        if (!next.canView && key === 'canView') {
          next.canCreate = false;
          next.canEdit = false;
          next.canDelete = false;
        }
        return next;
      })
    );
  }

  const availableUsers = users.filter(
    (candidate) =>
      candidate.id !== selected?.ownerId && !entries.some((entry) => entry.userId === candidate.id)
  );

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.permissionsTitle')}</h2>
        <button type="button" className="button primary" disabled={busy || !selected} onClick={() => void save()}>
          {t('admin.saveAcl')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="panel">
        <label>
          <span>{t('admin.selectCalendar')}</span>
          <select value={calendarId} onChange={(event) => setCalendarId(event.target.value)}>
            {manageable.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.ownerName} — {calendar.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <div className="form-grid">
            <label>
              <span>{t('common.name')}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>{t('admin.categoryColor')}</span>
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
          </div>
        )}
      </div>
      <div className="panel">
        <h3>{t('admin.permissions')}</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('admin.permissionView')}</th>
                <th>{t('admin.permissionCreate')}</th>
                <th>{t('admin.permissionEdit')}</th>
                <th>{t('admin.permissionDelete')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selected && (
                <tr>
                  <td>
                    <strong>{selected.ownerName}</strong> <span className="badge">{t('admin.owner')}</span>
                  </td>
                  <td colSpan={4} className="muted">
                    {t('common.all')}
                  </td>
                  <td />
                </tr>
              )}
              {entries.map((entry) => {
                const target = users.find((candidate) => candidate.id === entry.userId);
                return (
                  <tr key={entry.userId}>
                    <td>
                      {target
                        ? `${target.firstName} ${target.lastName}`.trim() || target.username
                        : entry.userId}
                    </td>
                    {(['canView', 'canCreate', 'canEdit', 'canDelete'] as const).map((key) => (
                      <td key={key}>
                        <input
                          type="checkbox"
                          checked={entry[key]}
                          onChange={(event) => updateEntry(entry.userId, key, event.target.checked)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="button small danger"
                        onClick={() => setEntries(entries.filter((item) => item.userId !== entry.userId))}
                      >
                        {t('common.remove')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="inline-fields">
          <select value={newUserId} onChange={(event) => setNewUserId(event.target.value)}>
            <option value="">{t('admin.selectUser')}</option>
            {availableUsers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {`${candidate.firstName} ${candidate.lastName}`.trim() || candidate.username}
              </option>
            ))}
          </select>
          <button type="button" className="button" disabled={!newUserId} onClick={addEntry}>
            + {t('admin.addPermission')}
          </button>
        </div>
      </div>
    </div>
  );
}
