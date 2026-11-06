"use client";

import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { TRPCProvider } from "@/lib/trpc/react";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { ThemeProvider } from "@/features/theme/ThemeProvider";
import { Toaster } from "@vimax/ui";
import { AppLayout } from "@/features/layout/AppLayout";

interface Props {
  locale: string;
  messages: Record<string, unknown>;
  timeZone: string;
  children: ReactNode;
}

export function AppProviders({ locale, messages, timeZone, children }: Props) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      <TRPCProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppLayout>{children}</AppLayout>
          </AuthProvider>
        </ThemeProvider>
      </TRPCProvider>
      <Toaster />
    </NextIntlClientProvider>
  );
}
