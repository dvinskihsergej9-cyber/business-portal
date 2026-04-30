"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { resetPassword } from "@/services/api";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await resetPassword(token, password);
      setMessage(result.message);
      setTimeout(() => router.replace("/login"), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить пароль.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <section className="w-full rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Новый пароль</h1>
        <p className="mt-2 text-sm text-slate-500">Установи новый пароль для входа.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Пароль</span>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

          <button
            type="submit"
            disabled={loading || !token}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Сохраняем..." : "Сохранить пароль"}
          </button>
        </form>

        <p className="mt-4 text-sm text-slate-500">
          <Link href="/login" className="text-blue-600 hover:text-blue-700">
            Вернуться ко входу
          </Link>
        </p>
      </section>
    </main>
  );
}

function AuthFallback() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-4 text-sm text-slate-500">
      Загрузка...
    </main>
  );
}
