import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiGet } from '../api';
import { useI18n } from '../i18n';
import type { CustomView } from '../types';

export function HeaderViewsMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [views, setViews] = useState<CustomView[]>([]);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeViewId =
    location.pathname === '/' ? new URLSearchParams(location.search).get('view') : null;

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    apiGet<CustomView[]>('/views')
      .then(setViews)
      .catch(() => setViews([]));
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      try {
        setViews(await apiGet<CustomView[]>('/views'));
      } catch {
        setViews([]);
      }
    }
  }

  function calendarSearch(updates: Record<string, string>): string {
    const params = new URLSearchParams(location.pathname === '/' ? location.search : '');
    for (const [key, value] of Object.entries(updates)) params.set(key, value);
    return params.toString();
  }

  function showAllResources() {
    setOpen(false);
    navigate({ pathname: '/', search: calendarSearch({ view: 'all' }) });
  }

  function applyView(customView: CustomView) {
    setOpen(false);
    navigate({ pathname: '/', search: calendarSearch({ view: customView.id }) });
  }

  function manageViews() {
    setOpen(false);
    navigate({ pathname: '/', search: calendarSearch({ manageViews: '1' }) });
  }

  return (
    <div className="toolbar-menu header-views-menu" ref={menuRef}>
      <button
        type="button"
        className="button ghost nav-menu-button"
        onClick={() => void toggle()}
        aria-expanded={open}
      >
        {t('nav.views')} ▾
      </button>
      {open && (
        <div className="menu-popover">
          <button
            type="button"
            className={`menu-item ${!activeViewId || activeViewId === 'all' ? 'active' : ''}`}
            onClick={showAllResources}
          >
            {t('calendar.allResources')}
          </button>
          {views.length > 0 && <div className="menu-divider" />}
          {views.map((customView) => (
            <button
              key={customView.id}
              type="button"
              className={`menu-item ${activeViewId === customView.id ? 'active' : ''}`}
              onClick={() => applyView(customView)}
            >
              <span>{customView.name}</span>
              <small>{customView.isShared ? t('views.global') : t('views.personal')}</small>
            </button>
          ))}
          <div className="menu-divider" />
          <button type="button" className="menu-item" onClick={manageViews}>
            {t('calendar.manageViews')}
          </button>
        </div>
      )}
    </div>
  );
}
