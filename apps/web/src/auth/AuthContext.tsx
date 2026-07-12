import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AdminSummary, AuthenticatedSession, LoginRequest } from '@overvpn/shared/schemas';
import type { AdminRole } from '@overvpn/shared/constants';
import { configureApiClient } from '@/api/client';
import * as authApi from '@/api/auth';
import { ApiError } from '@/api/client';

type AuthState = {
  admin: AdminSummary | null;
  accessToken: string | null;
  bootstrapping: boolean;
  canMutate: boolean;
  login: (input: LoginRequest) => Promise<'AUTHENTICATED' | 'TOTP_REQUIRED'>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminSummary | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const accessTokenRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  const applySession = useCallback((session: AuthenticatedSession) => {
    accessTokenRef.current = session.accessToken;
    setAccessToken(session.accessToken);
    setAdmin(session.admin);
  }, []);

  const clearSession = useCallback(() => {
    accessTokenRef.current = null;
    setAccessToken(null);
    setAdmin(null);
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    refreshPromiseRef.current = (async () => {
      try {
        const session = await authApi.refresh();
        applySession(session);
        return session.accessToken;
      } catch {
        clearSession();
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    return refreshPromiseRef.current;
  }, [applySession, clearSession]);

  useEffect(() => {
    configureApiClient({
      getAccessToken: () => accessTokenRef.current,
      refreshAccessToken,
      clearSession,
    });
  }, [clearSession, refreshAccessToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await authApi.refresh();
        if (!cancelled) {
          applySession(session);
        }
      } catch {
        if (!cancelled) {
          clearSession();
        }
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, clearSession]);

  const login = useCallback(
    async (input: LoginRequest) => {
      const result = await authApi.login(input);
      if (result.status === 'TOTP_REQUIRED') {
        return 'TOTP_REQUIRED' as const;
      }
      applySession(result);
      return 'AUTHENTICATED' as const;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      if (accessTokenRef.current) {
        await authApi.logout();
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        // still clear local session
      }
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshMe = useCallback(async () => {
    const me = await authApi.me();
    setAdmin(me);
  }, []);

  const canMutate = useMemo(() => {
    const role: AdminRole | undefined = admin?.role;
    return role === 'OWNER' || role === 'ADMIN';
  }, [admin?.role]);

  const value = useMemo(
    () => ({
      admin,
      accessToken,
      bootstrapping,
      canMutate,
      login,
      logout,
      refreshMe,
    }),
    [admin, accessToken, bootstrapping, canMutate, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
