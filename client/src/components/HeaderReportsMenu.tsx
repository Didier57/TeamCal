import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';

export function HeaderReportsMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = location.pathname.startsWith('/reports');

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function openAudit() {
    setOpen(false);
    navigate('/reports/audit');
  }

  return (
    <div className="toolbar-menu header-reports-menu" ref={menuRef}>
      <button
        type="button"
        className={`button ghost nav-menu-button ${active ? 'active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {t('nav.reports')} ▾
      </button>
      {open && (
        <div className="menu-popover">
          <button
            type="button"
            className={`menu-item ${active ? 'active' : ''}`}
            onClick={openAudit}
          >
            {t('reports.audit')}
          </button>
        </div>
      )}
    </div>
  );
}
