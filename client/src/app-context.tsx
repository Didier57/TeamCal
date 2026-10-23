import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { apiGet, apiPost, setCsrfToken } from './api';
import { useI18n } from './i18n';
import type { PublicSettings, ThemeColors, ThemeKind, User } from './types';

interface MeResponse {
  user: User | null;
  csrfToken: string | null;
  settings: PublicSettings;
  needsSetup: boolean;
}

interface AuthContextValue {
  user: User | null;
  settings: PublicSettings | null;
  loading: boolean;
  needsSetup: boolean;
  theme: ThemeKind;
  setTheme: (theme: ThemeKind) => void;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  setup: (payload: unknown) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: User) => void;
  setSettings: (settings: PublicSettings) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const fallbackTheme: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    primary: '#2f6feb',
    accent: '#1f9d55',
    background: '#f5f7fb',
    surface: '#ffffff',
    text: '#1c2434',
    muted: '#64748b',
    border: '#dbe2ee'
  },
  dark: {
    primary: '#6ea8ff',
    accent: '#4ade80',
    background: '#0f1622',
    surface: '#182132',
    text: '#e6edf7',
    muted: '#93a3b8',
    border: '#2a3648'
  }
};

function applyThemeColors(theme: ThemeKind, colors: ThemeColors) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-bg', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-muted', colors.muted);
  root.style.setProperty('--color-border', colors.border);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLanguage } = useI18n();
  const [user, setUserState] = useState<User | null>(null);
  const [settings, setSettingsState] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [theme, setThemeState] = useState<ThemeKind>(
    (localStorage.getItem('teamcal_theme') as ThemeKind) === 'dark' ? 'dark' : 'light'
  );

  const apply = useCallback(
    (response: MeResponse) => {
      setCsrfToken(response.csrfToken);
      setUserState(response.user);
      setSettingsState(response.settings);
      setNeedsSetup(response.needsSetup);
      if (response.user) {
        setLanguage(response.user.language);
      } else {
        setLanguage(response.settings.defaultLanguage);
      }
    },
    [setLanguage]
  );

  const refresh = useCallback(async () => {
    const response = await apiGet<MeResponse>('/auth/me');
    apply(response);
  }, [apply]);

  useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!settings) return;
    const colors = settings.theme?.[theme] ?? fallbackTheme[theme];
    applyThemeColors(theme, colors);
    document.title = settings.appName || 'TeamCal';
  }, [settings, theme]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean) => {
      const response = await apiPost<MeResponse>('/auth/login', { username, password, remember });
      apply(response);
      setLoading(false);
    },
    [apply]
  );

  const setup = useCallback(
    async (payload: unknown) => {
      const response = await apiPost<MeResponse>('/setup', payload);
      apply(response);
      setLoading(false);
    },
    [apply]
  );

  const logout = useCallback(async () => {
    try {
      await apiPost('/auth/logout');
    } finally {
      setCsrfToken(null);
      setUserState(null);
      await refresh().catch(() => undefined);
    }
  }, [refresh]);

  const setTheme = useCallback((value: ThemeKind) => {
    localStorage.setItem('teamcal_theme', value);
    setThemeState(value);
  }, []);

  const setUser = useCallback((value: User) => setUserState(value), []);
  const setSettings = useCallback((value: PublicSettings) => setSettingsState(value), []);

  const value = useMemo(
    () => ({
      user,
      settings,
      loading,
      needsSetup,
      theme,
      setTheme,
      login,
      setup,
      logout,
      refresh,
      setUser,
      setSettings
    }),
    [user, settings, loading, needsSetup, theme, setTheme, login, setup, logout, refresh, setUser, setSettings]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

export function useEffectiveTimeZone(): string {
  const { user, settings } = useAuth();
  return user?.timezone || settings?.defaultTimezone || 'UTC';
}
