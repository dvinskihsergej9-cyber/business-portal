import { NextRequest, NextResponse } from "next/server";
import { buildBackendUrl } from "@/lib/backend";
import { attachAccessTokenCookie, clearAccessTokenCookie } from "@/lib/auth-cookies";

export async function forwardAuthRequest(request: NextRequest, backendPath: string) {
  const body = await request.json().catch(() => ({}));
  const response = await fetch(buildBackendUrl(backendPath), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  const next = NextResponse.json(payload, { status: response.status });

  if (response.ok && typeof payload?.token === "string" && payload.token) {
    attachAccessTokenCookie(next, payload.token);
  }

  if (response.status === 401) {
    clearAccessTokenCookie(next);
  }

  return next;
}
