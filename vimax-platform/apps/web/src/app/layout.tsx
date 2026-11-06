import type { Metadata } from "next";
import { getLocale, getMessages } from "next-intl/server";
import { AppProviders } from "./AppProviders";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ViMax Studio · AI Video Workbench",
    template: "%s | ViMax Studio",
  },
  description:
    "AI-powered video generation workbench — from idea to video. Script, storyboard, generate, and edit — all on an infinite canvas.",
  keywords: [
    "AI video generation",
    "AI video editor",
    "video workbench",
    "AI filmmaking",
    "storyboard",
    "AI animation",
  ],
  authors: [{ name: "ViMax" }],
  creator: "ViMax",
  applicationName: "ViMax Studio",
  metadataBase: new URL("http://localhost:3000"),
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "ViMax Studio · AI Video Workbench",
    description: "AI-powered video generation workbench — from idea to video",
    type: "website",
    siteName: "ViMax Studio",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "ViMax Studio · AI Video Workbench",
    description: "AI-powered video generation workbench — from idea to video",
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    title: "ViMax",
    statusBarStyle: "black-translucent",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('vimax-theme');
                if (theme === 'light' || theme === 'dark') {
                  document.documentElement.setAttribute('data-theme', theme);
                } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
                  document.documentElement.setAttribute('data-theme', 'light');
                }
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <AppProviders locale={locale} messages={messages} timeZone="Asia/Shanghai">
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
