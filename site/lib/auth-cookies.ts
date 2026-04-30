import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_MAX_AGE_SECONDS, COOKIE_TOKEN_KEY } from "./env";

export async function getAccessTokenFromCookies(): Promise<string> {
  const jar = await cookies();
  return String(jar.get(COOKIE_TOKEN_KEY)?.value || "").trim();
}

export function attachAccessTokenCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: COOKIE_TOKEN_KEY,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearAccessTokenCookie(response: NextResponse) {
  response.cookies.set({
    name: COOKIE_TOKEN_KEY,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
