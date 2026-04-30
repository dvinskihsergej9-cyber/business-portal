export const API_BASE_FALLBACK = "https://api.skladonline74.ru/api";

function normalizeBase(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return API_BASE_FALLBACK;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const trimmed = withProtocol.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

export const BACKEND_API_BASE = normalizeBase(
  process.env.BACKEND_API_BASE || process.env.NEXT_PUBLIC_BACKEND_API_BASE || ""
);

export const COOKIE_TOKEN_KEY = "bp_access_token";
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
