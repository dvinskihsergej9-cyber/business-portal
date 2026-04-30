import { NextResponse } from "next/server";
import { clearAccessTokenCookie } from "@/lib/auth-cookies";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearAccessTokenCookie(response);
  return response;
}
