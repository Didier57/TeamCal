import { useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../../api';
import { useAuth } from '../../app-context';
import { languageLabel, useI18n } from '../../i18n';
import { countryLabel, EUROPEAN_COUNTRY_CODES } from '../../countries';
import type { Language, User } from '../../types';

interface FormState {
  id: string | null;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  language: Language;
  timezone: string;
  country: string;
  isAdmin: boolean;
  isActive: boolean;
}

const empty: FormState = {
  id: null,
  username: '',
  firstName: '',
  lastName: '',
  email: '',
  language: 'fr',
  timezone: '',
  country: '',
  isAdmin: false,
  isActive: true
};

type ActionIconName = 'edit' | 'send' | 'userX' | 'userCheck' | 'trash';

function ActionIcon({ name }: { name: ActionIconName }) {
  const paths: Record<ActionIconName, React.ReactNode> = {
    edit: <path d="M4 20h4l10-10-4-4L4 16v4zm12.7-12.7 1.6-1.6a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.6 1.6 3 3z" />,
    send: <path d="M3 11.5 21 3l-8.5 18-2.4-7.1L3 11.5zm7.1 2.4L21 3" />,
    userX: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2M16 8.5l5 5m0-5-5 5" />
      </>
    ),
    userCheck: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2M15.5 10.5l2.2 2.2 4-4.2" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6m4-6v6" />
      </>
    )
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const timezones = [
  '',
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

export function UsersAdmin() {
  const { t, errorMessage, locale } = useI18n();
  const { refresh, user: currentUser } = useAuth();
  const currentUserId = currentUser?.id;
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const list = await apiGet<User[]>('/users/all');
    setUsers(list);
  }

  useEffect(() => {
    void load().catch(() => setError(t('common.error')));
  }, [t]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  function lastSeenLabel(user: User) {
    if (!user.lastSeenAt) return <>—</>;
    const seen = new Date(user.lastSeenAt);
    if (Date.now() - seen.getTime() < 5 * 60 * 1000) {
      return <span className="pill success">{t('admin.online')}</span>;
    }
    return (
      <span title={seen.toISOString()}>
        {new Intl.DateTimeFormat(undefined, {
          dateStyle: 'short',
          timeStyle: 'short'
        }).format(seen)}
      </span>
    );
  }

  function startCreate() {
    setForm({ ...empty });
    setError(null);
  }

  function startEdit(user: User) {
    setForm({
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? '',
      language: user.language,
      timezone: user.timezone ?? '',
      country: user.country ?? '',
      isAdmin: user.isAdmin,
      isActive: user.isActive
    });
    setError(null);
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      if (form.id) {
        await apiPatch(`/users/${form.id}`, {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          language: form.language,
          timezone: form.timezone || null,
          country: form.country || null,
          isAdmin: form.isAdmin,
          isActive: form.isActive
        });
        setFlash(t('admin.userUpdated'));
      } else {
        const created = await apiPost<User & { emailSent?: boolean }>('/users', {
          username: form.username,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          language: form.language,
          timezone: form.timezone || undefined,
          country: form.country || undefined,
          isAdmin: form.isAdmin
        });
        setFlash(created.emailSent ? t('admin.inviteSent') : t('admin.userCreated'));
      }
      setForm(null);
      await load();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: User) {
    if (user.isActive && !window.confirm(t('admin.deactivateConfirm'))) return;
    try {
      await apiPatch(`/users/${user.id}`, { isActive: !user.isActive });
      setFlash(user.isActive ? t('admin.userDisabled') : t('admin.userEnabled'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    }
  }

  async function sendInvite(user: User) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ ok: boolean; emailSent: boolean }>(`/users/${user.id}/invite`, {});
      setFlash(result.emailSent ? t('admin.inviteSent') : t('admin.inviteFailed'));
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(t('admin.deleteConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/users/${user.id}`);
      setFlash(t('admin.userDeleted'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err.code) : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-section">
      <div className="section-header">
        <h2>{t('admin.usersTitle')}</h2>
        <button type="button" className="button primary" onClick={startCreate}>
          + {t('admin.newUser')}
        </button>
      </div>
      {flash && <div className="alert info">{flash}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('common.name')}</th>
              <th>{t('common.username')}</th>
              <th>{t('common.email')}</th>
              <th>{t('common.language')}</th>
              <th>{t('common.country')}</th>
              <th>{t('common.admin')}</th>
              <th>{t('common.active')}</th>
              <th>{t('admin.lastLogin')}</th>
              <th>{t('admin.lastSeen')}</th>
              <th>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.isActive ? '' : 'row-muted'}>
                <td>
                  {`${user.firstName} ${user.lastName}`.trim() || user.username}
                </td>
                <td>{user.username}</td>
                <td>{user.email ?? '—'}</td>
                <td>{languageLabel(user.language)}</td>
                <td>{user.country ? countryLabel(user.country, locale) : '-'}</td>
                <td>{user.isAdmin ? t('common.yes') : t('common.no')}</td>
                <td>
                  <span className={`pill ${user.isActive ? 'success' : 'muted'}`}>
                    {user.isActive ? t('common.active') : t('common.inactive')}
                  </span>
                </td>
                <td>
                  {user.lastLoginAt
                    ? new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short'
                      }).format(new Date(user.lastLoginAt))
                    : '—'}
                </td>
                <td>{lastSeenLabel(user)}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="icon-button action-edit"
                    title={t('common.edit')}
                    aria-label={t('common.edit')}
                    onClick={() => startEdit(user)}
                  >
                    <ActionIcon name="edit" />
                  </button>
                  <button
                    type="button"
                    className="icon-button action-invite"
                    title={t('admin.invite')}
                    aria-label={t('admin.invite')}
                    disabled={busy || !user.isActive}
                    onClick={() => void sendInvite(user)}
                  >
                    <ActionIcon name="send" />
                  </button>
                  <button
                    type="button"
                    className="icon-button action-toggle"
                    title={user.isActive ? t('admin.deactivate') : t('admin.activate')}
                    aria-label={user.isActive ? t('admin.deactivate') : t('admin.activate')}
                    onClick={() => void toggleActive(user)}
                  >
                    <ActionIcon name={user.isActive ? 'userX' : 'userCheck'} />
                  </button>
                  <button
                    type="button"
                    className="icon-button action-delete"
                    title={t('admin.deleteUser')}
                    aria-label={t('admin.deleteUser')}
                    disabled={busy || user.id === currentUserId}
                    onClick={() => void removeUser(user)}
                  >
                    <ActionIcon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="panel">
          <h3>{form.id ? t('admin.editUser') : t('admin.newUser')}</h3>
          <div className="form-grid">
            <label>
              <span>{t('setup.firstName')}</span>
              <input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
            </label>
            <label>
              <span>{t('setup.lastName')}</span>
              <input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            </label>
            <label>
              <span>{t('common.username')}</span>
              <input
                value={form.username}
                onChange={(event) => setForm({ ...form, username: event.target.value })}
                disabled={Boolean(form.id)}
                minLength={3}
              />
            </label>
            <label>
              <span>{t('common.email')}</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                required
              />
            </label>
            {!form.id && (
              <p className="muted form-note">{t('admin.inviteHint')}</p>
            )}
            <label>
              <span>{t('common.language')}</span>
              <select
                value={form.language}
                onChange={(event) => setForm({ ...form, language: event.target.value as Language })}
              >
                <option value="fr">{languageLabel('fr')}</option>
                <option value="en">{languageLabel('en')}</option>
                <option value="de">{languageLabel('de')}</option>
              </select>
            </label>
            <label>
              <span>{t('common.timezone')}</span>
              <select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                {timezones.map((tz) => (
                  <option key={tz || 'default'} value={tz}>
                    {tz || t('admin.defaultTimezone')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t('common.country')}</span>
              <select value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {EUROPEAN_COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryLabel(code, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(event) => setForm({ ...form, isAdmin: event.target.checked })}
              />
              <span>{t('admin.isAdmin')}</span>
            </label>
            {form.id && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                />
                <span>{t('admin.isActive')}</span>
              </label>
            )}
          </div>
          <div className="row-actions">
            <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
              {t('common.save')}
            </button>
            <button type="button" className="button ghost" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
