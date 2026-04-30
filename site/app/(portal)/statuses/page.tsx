"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchOrderHistory, fetchOrdersQueue } from "@/services/api";

export default function StatusesPage() {
  const queueQuery = useQuery({ queryKey: ["orders", "queue"], queryFn: fetchOrdersQueue });
  const historyQuery = useQuery({ queryKey: ["orders", "history"], queryFn: () => fetchOrderHistory(100) });

  const queueItems = queueQuery.data?.items || [];
  const historyItems = historyQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Статусы</h1>
        <p className="text-sm text-slate-500">Статусы заказов и хронология смен состояний.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Текущая очередь" subtitle="NEW / IN_PICKING / PICKED / PACKED">
          <div className="overflow-auto">
            <table className="table-grid">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Клиент</th>
                  <th>Статус</th>
                  <th>Исполнитель</th>
                </tr>
              </thead>
              <tbody>
                {queueItems.map((order) => (
                  <tr key={order.id}>
                    <td>{order.orderNumber}</td>
                    <td>{order.customerName}</td>
                    <td>{order.status}</td>
                    <td>{order.assignedToUser?.name || "—"}</td>
                  </tr>
                ))}
                {!queueItems.length ? (
                  <tr>
                    <td colSpan={4} className="text-slate-500">
                      Нет активных заказов.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="История статусов" subtitle="Последние события">
          <div className="space-y-2">
            {historyItems.map((event) => (
              <article key={event.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                <p className="text-xs text-slate-500">
                  {event.createdAt ? new Date(event.createdAt).toLocaleString("ru-RU") : ""}
                </p>
                <p className="text-sm font-medium text-slate-900">
                  Заказ {event.order?.orderNumber || `#${event.orderId}`}: {event.fromStatus || "—"} → {event.toStatus}
                </p>
                <p className="text-xs text-slate-600">
                  Событие: {event.eventType} | Исполнитель: {event.actorUser?.name || "Система"}
                </p>
              </article>
            ))}
            {!historyItems.length ? <p className="text-sm text-slate-500">История пуста.</p> : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
