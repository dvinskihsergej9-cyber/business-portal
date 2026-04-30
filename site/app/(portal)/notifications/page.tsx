"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "@/services/api";

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => fetchNotifications(100),
  });

  const readMutation = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const payload = notificationsQuery.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Уведомления</h1>
        <p className="text-sm text-slate-500">События системы в реальном времени и история прочтения.</p>
      </header>

      <SectionCard
        title="Лента уведомлений"
        subtitle={`Непрочитано: ${payload?.unreadCount || 0}`}
        actions={
          <button
            type="button"
            onClick={() => readAllMutation.mutate()}
            disabled={readAllMutation.isPending || !payload?.items.length}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
          >
            Отметить всё прочитанным
          </button>
        }
      >
        <div className="space-y-2">
          {(payload?.items || []).map((item) => (
            <article
              key={item.id}
              className={`rounded-xl border p-3 ${
                item.isRead ? "border-slate-200 bg-slate-50" : "border-blue-200 bg-blue-50/50"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm text-slate-700">{item.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.createdAt ? new Date(item.createdAt).toLocaleString("ru-RU") : ""}</p>
                </div>

                {!item.isRead ? (
                  <button
                    type="button"
                    onClick={() => readMutation.mutate(item.id)}
                    disabled={readMutation.isPending}
                    className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                  >
                    Прочитано
                  </button>
                ) : null}
              </div>
            </article>
          ))}

          {!payload?.items.length ? <p className="text-sm text-slate-500">Уведомлений пока нет.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
