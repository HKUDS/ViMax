import { NextRequest, NextResponse } from "next/server";

const SUPPORTED_LOCALES = ["zh-CN", "en"];
const DEFAULT_LOCALE = "zh-CN";
const COOKIE_NAME = "NEXT_LOCALE";

function getLocale(request: NextRequest): string {
  // 1. Check cookie
  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie?.value && SUPPORTED_LOCALES.includes(cookie.value)) {
    return cookie.value;
  }

  // 2. Check accept-language header
  const acceptLang = request.headers.get("accept-language");
  if (acceptLang) {
    for (const lang of acceptLang.split(",")) {
      const code = lang.split(";")[0].trim();
      if (code.startsWith("zh")) return "zh-CN";
      if (code.startsWith("en")) return "en";
    }
  }

  return DEFAULT_LOCALE;
}

export default function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Set locale cookie and header for next-intl
  const locale = getLocale(request);
  response.cookies.set(COOKIE_NAME, locale, {
    path: "/",
    maxAge: 31536000,
    sameSite: "lax",
  });
  response.headers.set("x-next-intl-locale", locale);

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon).*)"],
};
