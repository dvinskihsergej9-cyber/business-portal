"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/portal/section-card";
import { fetchMe, fetchOrgProfile, saveOrgProfile } from "@/services/api";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: ["session", "me"], queryFn: fetchMe });
  const profileQuery = useQuery({
    queryKey: ["settings", "org-profile"],
    queryFn: fetchOrgProfile,
    enabled: meQuery.data?.role === "ADMIN",
  });

  const [form, setForm] = useState<{
    orgName: string;
    legalAddress: string;
    actualAddress: string;
    inn: string;
    kpp: string;
    phone: string;
    purchaseOrderEmailTemplate: string;
  } | null>(null);

  const profile = profileQuery.data?.profile;
  const effectiveForm = form || {
    orgName: profile?.orgName || "",
    legalAddress: profile?.legalAddress || "",
    actualAddress: profile?.actualAddress || "",
    inn: profile?.inn || "",
    kpp: profile?.kpp || "",
    phone: profile?.phone || "",
    purchaseOrderEmailTemplate: profile?.purchaseOrderEmailTemplate || "",
  };

  const savePayload = {
    orgName: effectiveForm.orgName,
    legalAddress: effectiveForm.legalAddress,
    actualAddress: effectiveForm.actualAddress,
    inn: effectiveForm.inn,
    kpp: effectiveForm.kpp,
    phone: effectiveForm.phone,
    purchaseOrderEmailTemplate: effectiveForm.purchaseOrderEmailTemplate,
  };

  const emptyForm = {
    orgName: "",
    legalAddress: "",
    actualAddress: "",
    inn: "",
    kpp: "",
    phone: "",
    purchaseOrderEmailTemplate: "",
  };

  const saveMutation = useMutation({
    mutationFn: () => saveOrgProfile(savePayload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "org-profile"] });
      setForm(null);
    },
  });

  if (meQuery.data?.role !== "ADMIN") {
    return (
      <div className="space-y-3">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-slate-500">Раздел доступен только администраторам.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Настройки</h1>
        <p className="text-sm text-slate-500">Реквизиты организации и шаблоны документов.</p>
      </header>

      <SectionCard title="Реквизиты организации" subtitle="Используются в документах и печатных формах">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <Field
            label="Название организации"
            value={effectiveForm.orgName}
            onChange={(orgName) =>
              setForm((prev) => ({ ...(prev || effectiveForm || emptyForm), orgName }))
            }
          />
          <Field
            label="ИНН"
            value={effectiveForm.inn}
            onChange={(inn) => setForm((prev) => ({ ...(prev || effectiveForm || emptyForm), inn }))}
          />
          <Field
            label="КПП"
            value={effectiveForm.kpp}
            onChange={(kpp) => setForm((prev) => ({ ...(prev || effectiveForm || emptyForm), kpp }))}
          />
          <Field
            label="Телефон"
            value={effectiveForm.phone}
            onChange={(phone) => setForm((prev) => ({ ...(prev || effectiveForm || emptyForm), phone }))}
          />
          <Field
            label="Юридический адрес"
            value={effectiveForm.legalAddress}
            onChange={(legalAddress) =>
              setForm((prev) => ({ ...(prev || effectiveForm || emptyForm), legalAddress }))
            }
            className="md:col-span-2"
          />
          <Field
            label="Фактический адрес"
            value={effectiveForm.actualAddress}
            onChange={(actualAddress) =>
              setForm((prev) => ({ ...(prev || effectiveForm || emptyForm), actualAddress }))
            }
            className="md:col-span-2"
          />

          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-slate-700">Шаблон письма поставщику</span>
            <textarea
              rows={4}
              value={effectiveForm.purchaseOrderEmailTemplate}
              onChange={(event) =>
                setForm((prev) => ({
                  ...(prev || effectiveForm || emptyForm),
                  purchaseOrderEmailTemplate: event.target.value,
                }))
              }
            />
          </label>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="md:col-span-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saveMutation.isPending ? "Сохраняем..." : "Сохранить"}
          </button>

          {saveMutation.isError ? (
            <p className="md:col-span-2 text-sm text-rose-600">
              {saveMutation.error instanceof Error ? saveMutation.error.message : "Ошибка сохранения."}
            </p>
          ) : null}

          {saveMutation.isSuccess ? <p className="md:col-span-2 text-sm text-emerald-700">Изменения сохранены.</p> : null}
        </form>
      </SectionCard>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="mb-1 block text-sm text-slate-700">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} required />
    </label>
  );
}
