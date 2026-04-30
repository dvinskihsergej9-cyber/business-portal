"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { register } from "@/services/api";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    phone: "",
    companyName: "",
    privacyAccepted: false,
    marketingAccepted: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await register(form);
      router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось зарегистрироваться.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center p-4">
      <section className="w-full rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Регистрация компании</h1>
        <p className="mt-2 text-sm text-slate-500">После регистрации вы получите роль администратора компании.</p>

        <form className="mt-6 grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <label className="block md:col-span-1">
            <span className="mb-1 block text-sm text-slate-700">ФИО</span>
            <input
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Иванов Иван Иванович"
            />
          </label>

          <label className="block md:col-span-1">
            <span className="mb-1 block text-sm text-slate-700">Телефон</span>
            <input
              required
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              placeholder="+7 900 000-00-00"
            />
          </label>

          <label className="block md:col-span-1">
            <span className="mb-1 block text-sm text-slate-700">Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>

          <label className="block md:col-span-1">
            <span className="mb-1 block text-sm text-slate-700">Пароль</span>
            <input
              required
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm text-slate-700">Название компании</span>
            <input
              required
              value={form.companyName}
              onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))}
              placeholder="ООО / ИП"
            />
          </label>

          <label className="md:col-span-2 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.privacyAccepted}
              onChange={(event) => setForm((prev) => ({ ...prev, privacyAccepted: event.target.checked }))}
              className="mt-1 h-4 w-4"
            />
            Согласен(а) с политикой обработки персональных данных
          </label>

          <label className="md:col-span-2 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.marketingAccepted}
              onChange={(event) => setForm((prev) => ({ ...prev, marketingAccepted: event.target.checked }))}
              className="mt-1 h-4 w-4"
            />
            Согласен(а) получать информационные письма
          </label>

          {error ? <p className="md:col-span-2 text-sm text-rose-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading || !form.privacyAccepted}
            className="md:col-span-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Регистрируем..." : "Создать аккаунт"}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-500">
          Уже есть аккаунт? <Link href="/login" className="text-blue-600 hover:text-blue-700">Войти</Link>
        </p>
      </section>
    </main>
  );
}
