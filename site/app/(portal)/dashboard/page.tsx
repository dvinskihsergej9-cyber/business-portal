"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { StatCard } from "@/components/portal/stat-card";
import { fetchNotifications, fetchOrdersQueue, fetchStockSummary, fetchTasksMy } from "@/services/api";

export default function DashboardPage() {
  const stockQuery = useQuery({ queryKey: ["dashboard", "stock-summary"], queryFn: fetchStockSummary });
  const tasksQuery = useQuery({ queryKey: ["tasks", "my"], queryFn: fetchTasksMy });
  const notificationsQuery = useQuery({ queryKey: ["notifications", "list"], queryFn: () => fetchNotifications(20) });
  const queueQuery = useQuery({ queryKey: ["orders", "queue"], queryFn: fetchOrdersQueue });

  const items = stockQuery.data || [];
  const totalStock = items.reduce((sum, item) => sum + Number(item.currentStock || 0), 0);
  const lowStockCount = items.filter((item) => Number(item.availableStock || 0) <= 0).length;
  const myTasks = tasksQuery.data || [];
  const openTasks = myTasks.filter((task) => task.status !== "DONE" && task.status !== "CANCELLED").length;
  const queueItems = queueQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Дашборд</h1>
        <p className="text-sm text-slate-500">Единая операционная панель: те же данные, что и в основном приложении.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="SKU в учете" value={String(items.length)} hint="С учётом tenant-изоляции" />
        <StatCard label="Суммарный остаток" value={String(totalStock)} hint="Без служебной зоны RECEIVING" />
        <StatCard label="Мои открытые задачи" value={String(openTasks)} hint="Статусы NEW/IN_PROGRESS" />
        <StatCard
          label="Непрочитанные уведомления"
          value={String(notificationsQuery.data?.unreadCount || 0)}
          hint="Синхронизируется в realtime"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Заказы в очереди" subtitle="Текущие статусы исполнения">
          <div className="overflow-auto">
            <table className="table-grid">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Клиент</th>
                  <th>Статус</th>
                  <th>Позиций</th>
                </tr>
              </thead>
              <tbody>
                {queueItems.slice(0, 12).map((order) => (
                  <tr key={order.id}>
                    <td>{order.orderNumber}</td>
                    <td>{order.customerName}</td>
                    <td>{order.status}</td>
                    <td>{order.lines.length}</td>
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

        <SectionCard title="Критичные остатки" subtitle="Товары с нулевым доступным остатком">
          <ul className="space-y-2">
            {items
              .filter((item) => Number(item.availableStock || 0) <= 0)
              .slice(0, 12)
              .map((item) => (
                <li key={item.id} className="rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2 text-sm">
                  <div className="font-medium text-slate-900">{item.name}</div>
                  <div className="text-xs text-slate-600">
                    SKU: {item.sku || "-"} | Остаток: {item.currentStock} | Доступно: {item.availableStock}
                  </div>
                </li>
              ))}
            {!lowStockCount ? <li className="text-sm text-slate-500">Критичных позиций нет.</li> : null}
          </ul>
        </SectionCard>
      </section>
    </div>
  );
}
