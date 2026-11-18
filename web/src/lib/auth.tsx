import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, tokenStore, attemptRefresh, setUnauthorizedHandler } from './api';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  role: 'admin' | 'accountant';
  status: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await attemptRefresh();
      if (token) {
        try {
          const { data } = await api.get<AuthUser>('/auth/me');
          if (alive) setUser(data);
        } catch {
          tokenStore.set(null);
        }
      }
      if (alive) setLoading(false);
    })();
    setUnauthorizedHandler(() => {
      tokenStore.set(null);
      setUser(null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      async login(email, password) {
        const { data } = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', {
          email,
          password,
        });
        tokenStore.set(data.accessToken);
        setUser(data.user);
        return data.user;
      },
      async logout() {
        try {
          await api.post('/auth/logout');
        } finally {
          tokenStore.set(null);
          setUser(null);
        }
      },
      async refreshMe() {
        const { data } = await api.get<AuthUser>('/auth/me');
        setUser(data);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải dùng trong AuthProvider');
  return ctx;
}
