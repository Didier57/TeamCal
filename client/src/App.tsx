import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './app-context';
import { AppLayout } from './components/AppLayout';
import { CalendarPage } from './pages/CalendarPage';
import { SearchPage } from './pages/SearchPage';
import { AdminPage } from './pages/AdminPage';
import { PreferencesPage } from './pages/PreferencesPage';
import { ReportAuditPage } from './pages/ReportAuditPage';
import { ReportSystemPage } from './pages/ReportSystemPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

export function App() {
  const { user, loading, needsSetup } = useAuth();

  if (loading) {
    return (
      <div className="splash">
        <div className="spinner" />
      </div>
    );
  }
  if (needsSetup) return <SetupPage />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<CalendarPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
        <Route
          path="/reports/audit"
          element={user.isAdmin ? <ReportAuditPage /> : <Navigate to="/" replace />}
        />
        <Route
          path="/reports/system"
          element={user.isAdmin ? <ReportSystemPage /> : <Navigate to="/" replace />}
        />
        <Route path="/admin" element={user.isAdmin ? <AdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
