import { NextResponse } from "next/server";
import { buildBackendUrl } from "@/lib/backend";
import { getAccessTokenFromCookies } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

async function fetchSnapshot(token: string) {
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  const [notificationsRes, tasksRes, ordersRes] = await Promise.all([
    fetch(buildBackendUrl("notifications/unread-count"), { headers, cache: "no-store" }),
    fetch(buildBackendUrl("warehouse/tasks/my"), { headers, cache: "no-store" }),
    fetch(buildBackendUrl("orders/queue"), { headers, cache: "no-store" }),
  ]);

  if (!notificationsRes.ok || !tasksRes.ok || !ordersRes.ok) {
    throw new Error("SYNC_FETCH_FAILED");
  }

  const notifications = await notificationsRes.json();
  const tasks = await tasksRes.json();
  const orders = await ordersRes.json();

  const openTasks = Array.isArray(tasks)
    ? tasks.filter((task) => !["DONE", "CANCELLED"].includes(String(task?.status || ""))).length
    : 0;

  return {
    at: new Date().toISOString(),
    unreadCount: Number(notifications?.unreadCount || 0),
    openTasks,
    queueCount: Array.isArray(orders?.items) ? orders.items.length : 0,
  };
}

export async function GET(request: Request) {
  const token = await getAccessTokenFromCookies();
  if (!token) {
    return NextResponse.json({ message: "UNAUTHORIZED" }, { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = async () => {
        if (closed) return;
        try {
          const snapshot = await fetchSnapshot(token);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
        } catch {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "SYNC_ERROR" })}\n\n`)
          );
        }
      };

      controller.enqueue(encoder.encode(`retry: 5000\n\n`));
      send();
      const interval = setInterval(send, 8000);

      request.signal.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
