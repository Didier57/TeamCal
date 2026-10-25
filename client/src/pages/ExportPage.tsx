import { useEffect, useState } from 'react';
import { apiGet } from '../api';
import { useAuth } from '../app-context';
import { useI18n } from '../i18n';
import type { User } from '../types';

export function ExportPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [target, setTarget] = useState(user?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.isAdmin) return;
    apiGet<User[]>('/users/all')
      .then((list) => {
        setUsers(list);
        setTarget((current) => current || user.id);
      })
      .catch(() => setError(t('common.error')));
  }, [t, user?.isAdmin, user?.id]);

  const exportUrl = target
    ? `/api/export/ics?userId=${encodeURIComponent(target)}`
    : '/api/export/ics';
  const selected = users.find((entry) => entry.id === target);

  return (
    <div className="admin-section events-page">
      <div className="section-header">
        <h2>{t('events.exportTitle')}</h2>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="panel">
        <p className="hint">{t('events.exportHelp')}</p>
        <div className="form-grid">
          <label className="field">
            <span>{t('events.exportUser')}</span>
            {user?.isAdmin ? (
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                {users.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {`${entry.firstName} ${entry.lastName}`.trim() || entry.username} (
                    {entry.username}){entry.isActive ? '' : ` - ${t('common.inactive')}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                readOnly
                value={`${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || user?.username || ''}
              />
            )}
          </label>
        </div>
        <div className="import-actions">
          <a className="button primary" href={exportUrl}>
            {t('events.exportButton')}
          </a>
        </div>
        {selected && <p className="hint">{t('events.exportHint').replace('{name}', selected.username)}</p>}
      </div>
    </div>
  );
}
