"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc/client";

// ── Types ────────────────────────────────────────────────────────────

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// ── Token storage ────────────────────────────────────────────────────

const KEY_ACCESS = "vimax-access-token";
const KEY_REFRESH = "vimax-refresh-token";

function getTokens() {
  if (typeof window === "undefined") return { access: null, refresh: null };
  return {
    access: localStorage.getItem(KEY_ACCESS),
    refresh: localStorage.getItem(KEY_REFRESH),
  };
}

function setTokens(access: string | null, refresh: string | null) {
  if (access) localStorage.setItem(KEY_ACCESS, access);
  else localStorage.removeItem(KEY_ACCESS);
  if (refresh) localStorage.setItem(KEY_REFRESH, refresh);
  else localStorage.removeItem(KEY_REFRESH);
}

// ── Provider ─────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(getTokens().access);

  // Mutations
  const loginMut = trpc.auth.login.useMutation();
  const registerMut = trpc.auth.register.useMutation();
  const refreshMut = trpc.auth.refresh.useMutation();
  const logoutMut = trpc.auth.logout.useMutation();

  // Poll /me when we have a token
  const meQuery = trpc.auth.me.useQuery(
    { accessToken: accessToken ?? "" },
    { enabled: !!accessToken, retry: false, staleTime: 5 * 60 * 1000 },
  );

  const doRefresh = useCallback(async (refreshToken: string) => {
    const tokens = await refreshMut.mutateAsync({ refreshToken });
    setAccessToken(tokens.accessToken);
    setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  }, [refreshMut]);

  // Bootstrap: refresh if no access token but have refresh token
  useEffect(() => {
    if (accessToken) return;
    const { refresh } = getTokens();
    if (refresh) {
      doRefresh(refresh).catch(() => {
        setTokens(null, null);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  // Sync /me result
  useEffect(() => {
    if (!accessToken) return;
    if (meQuery.data?.user) {
      setUser(meQuery.data.user);
      setIsLoading(false);
    }
    if (meQuery.isError) {
      const { refresh } = getTokens();
      if (refresh) {
        doRefresh(refresh).catch(() => {
          setUser(null);
          setAccessToken(null);
          setTokens(null, null);
          setIsLoading(false);
        });
      } else {
        setUser(null);
        setAccessToken(null);
        setIsLoading(false);
      }
    }
  }, [accessToken, meQuery.data, meQuery.isError, doRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginMut.mutateAsync({ email, password });
    setAccessToken(result.tokens.accessToken);
    setUser(result.user);
    setTokens(result.tokens.accessToken, result.tokens.refreshToken);
  }, [loginMut]);

  const signup = useCallback(async (email: string, password: string, name: string, inviteCode: string) => {
    const result = await registerMut.mutateAsync({ email, password, name, inviteCode });
    setAccessToken(result.tokens.accessToken);
    setUser(result.user);
    setTokens(result.tokens.accessToken, result.tokens.refreshToken);
  }, [registerMut]);

  const logout = useCallback(async () => {
    const { refresh } = getTokens();
    if (refresh) {
      try { await logoutMut.mutateAsync({ refreshToken: refresh }); } catch { /* ignore */ }
    }
    setUser(null);
    setAccessToken(null);
    setTokens(null, null);
  }, [logoutMut]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
