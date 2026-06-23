import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthSession } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../lib/api';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setJiraAccount: (jiraAccountId: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const { data } = await api.get<AuthSession>('/auth/me');
      setSession(data);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function login(username: string, password: string) {
    try {
      const { data } = await api.post<AuthSession>('/auth/login', { username, password });
      setSession(data);
    } catch (err) {
      throw new Error(getApiErrorMessage(err));
    }
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
    }
  }

  async function setJiraAccount(jiraAccountId: string | null) {
    try {
      const { data } = await api.put<AuthSession>('/auth/me/jira-account', {
        jiraAccountId,
      });
      setSession(data);
    } catch (err) {
      throw new Error(getApiErrorMessage(err));
    }
  }

  const value = useMemo(
    () => ({ session, loading, login, logout, refresh, setJiraAccount }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
