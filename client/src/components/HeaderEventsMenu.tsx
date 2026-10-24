import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';

export function HeaderEventsMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = location.pathname === '/import' || location.pathname === '/export';

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  function addEvent() {
    setOpen(false);
    const params = new URLSearchParams(location.pathname === '/' ? location.search : '');
    params.set('newEvent', '1');
    navigate({ pathname: '/', search: params.toString() });
  }

  return (
    <div className="toolbar-menu header-events-menu" ref={menuRef}>
      <button
        type="button"
        className={`button ghost nav-menu-button ${active ? 'active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {t('nav.events')} ▾
      </button>
      {open && (
        <div className="menu-popover">
          <button
            type="button"
            className="menu-item"
            onClick={addEvent}
          >
            {t('eventsMenu.add')}
          </button>
          <button
            type="button"
            className={`menu-item ${location.pathname === '/import' ? 'active' : ''}`}
            onClick={() => go('/import')}
          >
            {t('eventsMenu.import')}
          </button>
          <button
            type="button"
            className={`menu-item ${location.pathname === '/export' ? 'active' : ''}`}
            onClick={() => go('/export')}
          >
            {t('eventsMenu.export')}
          </button>
        </div>
      )}
    </div>
  );
}
