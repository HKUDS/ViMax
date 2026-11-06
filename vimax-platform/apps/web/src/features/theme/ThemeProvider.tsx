"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const STORAGE_KEY = "vimax-theme";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "system";
}

function resolveTheme(t: Theme): ResolvedTheme {
  if (t === "system") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return t;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getStoredTheme()));

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    const r = resolveTheme(t);
    setResolved(r);
    document.documentElement.setAttribute("data-theme", r);
    // Set cookie for SSR flash prevention
    document.cookie = `vimax-theme=${r};path=/;max-age=31536000;samesite=lax`;
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = () => {
      const r = resolveTheme("system");
      setResolved(r);
      document.documentElement.setAttribute("data-theme", r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // Apply on mount
  useEffect(() => {
    const r = resolveTheme(theme);
    setResolved(r);
    document.documentElement.setAttribute("data-theme", r);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
