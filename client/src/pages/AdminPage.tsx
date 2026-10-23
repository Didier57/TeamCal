import { useState } from 'react';
import { useI18n } from '../i18n';
import { UsersAdmin } from '../components/admin/UsersAdmin';
import { SettingsAdmin } from '../components/admin/SettingsAdmin';
import { CategoriesAdmin } from '../components/admin/CategoriesAdmin';
import { SmtpAdmin } from '../components/admin/SmtpAdmin';
import { ThemeAdmin } from '../components/admin/ThemeAdmin';
import { PermissionsAdmin } from '../components/admin/PermissionsAdmin';

type Tab = 'users' | 'settings' | 'categories' | 'permissions' | 'smtp' | 'appearance';

export function AdminPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('users');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: t('admin.users') },
    { id: 'settings', label: t('admin.settings') },
    { id: 'categories', label: t('admin.categories') },
    { id: 'permissions', label: t('admin.permissions') },
    { id: 'smtp', label: t('admin.smtp') },
    { id: 'appearance', label: t('admin.appearance') }
  ];

  return (
    <div className="admin-page">
      <div className="page-heading">
        <h1>{t('admin.title')}</h1>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersAdmin />}
      {tab === 'settings' && <SettingsAdmin />}
      {tab === 'categories' && <CategoriesAdmin />}
      {tab === 'permissions' && <PermissionsAdmin />}
      {tab === 'smtp' && <SmtpAdmin />}
      {tab === 'appearance' && <ThemeAdmin />}
    </div>
  );
}
