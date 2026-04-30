"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchMarketingPreferences, fetchMe, updateMarketingPreferences } from "@/services/api";

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["session", "me"], queryFn: fetchMe });
  const marketingQuery = useQuery({
    queryKey: ["profile", "marketing"],
    queryFn: fetchMarketingPreferences,
    enabled: meQuery.data?.role === "ADMIN" && !meQuery.data?.isSystemOwner,
  });

  const toggleMarketingMutation = useMutation({
    mutationFn: (enabled: boolean) => updateMarketingPreferences(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile", "marketing"] }),
  });

  const user = meQuery.data;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Профиль</h1>
        <p className="text-sm text-slate-500">Личные данные и параметры коммуникации.</p>
      </header>

      <SectionCard title="Основные данные">
        {user ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="ID" value={String(user.id)} />
            <Row label="Имя" value={user.name} />
            <Row label="Email" value={user.email} />
            <Row label="Логин" value={user.login} />
            <Row label="Роль" value={user.role} />
            <Row label="Организация" value={user.organization?.name || "-"} />
            <Row label="Подписка" value={user.subscription?.plan || "-"} />
            <Row label="Статус подписки" value={user.subscription?.isActive ? "Активна" : "Не активна"} />
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Загрузка...</p>
        )}
      </SectionCard>

      {marketingQuery.data ? (
        <SectionCard title="Маркетинговые письма" subtitle="Только для владельца компании">
          <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-3">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Рассылка: {marketingQuery.data.enabled ? "включена" : "выключена"}
              </p>
              <p className="text-xs text-slate-500">
                Согласие: {marketingQuery.data.consentAt ? new Date(marketingQuery.data.consentAt).toLocaleString("ru-RU") : "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleMarketingMutation.mutate(!marketingQuery.data?.enabled)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              {marketingQuery.data.enabled ? "Отключить" : "Включить"}
            </button>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white px-3 py-2">
      <dt className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
