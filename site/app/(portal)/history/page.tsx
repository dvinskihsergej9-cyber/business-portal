"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchWarehouseTransactions } from "@/services/api";

export default function HistoryPage() {
  const historyQuery = useQuery({
    queryKey: ["history", "warehouse-transactions"],
    queryFn: () => fetchWarehouseTransactions(300),
  });

  const items = historyQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">История действий</h1>
        <p className="text-sm text-slate-500">Журнал складских операций и изменений статусов.</p>
      </header>

      <SectionCard title="Журнал операций" subtitle="Единый source of truth из backend">
        <div className="overflow-auto">
          <table className="table-grid">
            <thead>
              <tr>
                <th>Время</th>
                <th>Тип</th>
                <th>Событие</th>
                <th>Детали</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.createdAt ? new Date(item.createdAt).toLocaleString("ru-RU") : "-"}</td>
                  <td>{item.type}{item.result ? ` (${item.result})` : ""}</td>
                  <td>{item.item?.name || "—"}</td>
                  <td>
                    {item.location?.code || item.location?.name || "—"}
                    {item.qty !== null && item.qty !== undefined ? ` | qty: ${item.qty}` : ""}
                    {item.comment ? ` | ${item.comment}` : ""}
                  </td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={4} className="text-slate-500">
                    Пока нет событий.
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
