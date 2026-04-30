"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchPurchaseOrders } from "@/services/api";

export default function DocumentsPage() {
  const ordersQuery = useQuery({
    queryKey: ["documents", "purchase-orders"],
    queryFn: fetchPurchaseOrders,
  });

  const orders = ordersQuery.data || [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Документы</h1>
        <p className="text-sm text-slate-500">Заказы поставщику и печатные формы из единого backend.</p>
      </header>

      <SectionCard title="Заказы поставщику" subtitle="Экспорт в Excel и акты приемки">
        <div className="overflow-auto">
          <table className="table-grid">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Поставщик</th>
                <th>Статус</th>
                <th>Дата</th>
                <th>Позиции</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.number || `#${order.id}`}</td>
                  <td>{order.supplier?.name || "-"}</td>
                  <td>{order.status}</td>
                  <td>{order.date ? new Date(order.date).toLocaleDateString("ru-RU") : "-"}</td>
                  <td>{order.items.length}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/proxy/purchase-orders/${order.id}/excel-file`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        Excel
                      </a>
                      <a
                        href={`/api/proxy/purchase-orders/${order.id}/print-receive-act`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Акт
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {!orders.length ? (
                <tr>
                  <td colSpan={6} className="text-slate-500">
                    Нет документов.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
