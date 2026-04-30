import { BACKEND_API_BASE } from "./env";

type BackendRequestOptions = {
  method?: string;
  token?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export function buildBackendUrl(path: string, searchParams?: URLSearchParams): string {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const base = `${BACKEND_API_BASE}/${normalizedPath}`;
  if (!searchParams || Array.from(searchParams.keys()).length === 0) {
    return base;
  }
  return `${base}?${searchParams.toString()}`;
}

export async function backendRequest(path: string, options: BackendRequestOptions = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  return fetch(buildBackendUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body,
    signal: options.signal,
    cache: "no-store",
  });
}
