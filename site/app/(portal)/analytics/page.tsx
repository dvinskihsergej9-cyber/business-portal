"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchPickingReport } from "@/services/api";

export default function AnalyticsPage() {
  const reportQuery = useQuery({
    queryKey: ["analytics", "picking-report"],
    queryFn: () => fetchPickingReport(7),
  });

  const report = reportQuery.data;
  const users = report?.users || [];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Аналитика</h1>
        <p className="text-sm text-slate-500">Показатели подбора за последние 7 дней.</p>
      </header>

      <SectionCard title="Сводка" subtitle={report ? `${new Date(report.range.from).toLocaleDateString("ru-RU")} - ${new Date(report.range.to).toLocaleDateString("ru-RU")}` : ""}>
        {report ? (
          <div className="grid gap-3 sm:grid-cols-5">
            <Metric label="Сотрудники" value={String(report.totals.workers)} />
            <Metric label="Заказы" value={String(report.totals.orders)} />
            <Metric label="Строки" value={String(report.totals.lines)} />
            <Metric label="Запрошено шт." value={String(report.totals.qtyOrdered)} />
            <Metric label="Отобрано шт." value={String(report.totals.qtyPicked)} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">Загрузка отчёта...</p>
        )}
      </SectionCard>

      <SectionCard title="По сотрудникам" subtitle="Ранжирование по количеству заказов">
        <div className="space-y-3">
          {users.map((row) => {
            const pct = report && report.totals.orders > 0 ? Math.round((row.ordersCount / report.totals.orders) * 100) : 0;
            return (
              <div key={row.userId} className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{row.userName}</p>
                  <p className="text-xs text-slate-500">{row.ordersCount} заказов</p>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Отобрано: {row.qtyPicked} шт. | Линий: {row.linesCount}
                </p>
              </div>
            );
          })}
          {!users.length ? <p className="text-sm text-slate-500">Данных пока нет.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 font-[var(--font-sora)] text-xl font-semibold">{value}</p>
    </div>
  );
}
