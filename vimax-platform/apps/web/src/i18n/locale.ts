"use client";

import { useCallback } from "react";
import { useLocale } from "next-intl";

const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Client-side hook to switch locale. Sets the cookie and reloads.
 */
export function useLocaleSwitch() {
  const locale = useLocale();

  const switchLocale = useCallback((newLocale: string) => {
    document.cookie = `${LOCALE_COOKIE}=${newLocale};path=/;max-age=31536000;samesite=lax`;
    window.location.reload();
  }, []);

  return { locale, switchLocale } as const;
}
