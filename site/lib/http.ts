import { z } from "zod";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  headers?: HeadersInit;
};

async function parseBody(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export async function requestJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
    credentials: "include",
    cache: "no-store",
    signal: options.signal,
  });

  const payload = await parseBody(response);
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: string }).message || "")
        : "";
    throw new Error(message || `HTTP ${response.status}`);
  }

  return schema.parse(payload);
}

export async function requestRaw(url: string, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  return fetch(url, {
    method: options.method || "GET",
    headers,
    body,
    credentials: "include",
    cache: "no-store",
    signal: options.signal,
  });
}
