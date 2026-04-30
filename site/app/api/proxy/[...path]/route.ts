import { NextRequest, NextResponse } from "next/server";
import { buildBackendUrl } from "@/lib/backend";
import { clearAccessTokenCookie, getAccessTokenFromCookies } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

function buildTargetUrl(path: string[], request: NextRequest) {
  const search = request.nextUrl.searchParams;
  return buildBackendUrl(path.join("/"), search);
}

async function forward(request: NextRequest, path: string[]) {
  const token = await getAccessTokenFromCookies();
  const targetUrl = buildTargetUrl(path, request);

  const headers = new Headers();
  headers.set("Accept", request.headers.get("accept") || "application/json");
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > 0) {
      body = buffer;
    }
  }

  const upstream = await fetch(targetUrl, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });

  const proxyHeaders = new Headers();
  const passthroughHeaders = [
    "content-type",
    "content-disposition",
    "cache-control",
    "etag",
    "last-modified",
  ];
  passthroughHeaders.forEach((headerName) => {
    const value = upstream.headers.get(headerName);
    if (value) proxyHeaders.set(headerName, value);
  });

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: proxyHeaders,
  });

  if (upstream.status === 401) {
    clearAccessTokenCookie(response);
  }

  return response;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(request, path || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(request, path || []);
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(request, path || []);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(request, path || []);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(request, path || []);
}
