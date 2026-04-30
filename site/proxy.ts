import { NextRequest, NextResponse } from "next/server";

const APP_ORIGIN = String(
  process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "https://skladonline74.ru"
)
  .trim()
  .replace(/\/+$/, "");

const operationalPrefixes = [
  "/dashboard",
  "/tasks",
  "/notifications",
  "/documents",
  "/history",
  "/statuses",
  "/analytics",
  "/admin",
  "/profile",
  "/settings",
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
];

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isOperationalRoute = operationalPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isOperationalRoute) {
    const target = new URL(`${APP_ORIGIN}${pathname}`);
    request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
    return NextResponse.redirect(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon-192.png|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
