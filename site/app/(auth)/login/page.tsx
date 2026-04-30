"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { login } from "@/services/api";

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const next = searchParams.get("next") || "/dashboard";

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(loginValue.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить вход.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <section className="w-full rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Вход в СкладОнлайн</h1>
        <p className="mt-2 text-sm text-slate-500">Единая авторизация для сайта и приложения.</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Логин или email</span>
            <input
              required
              value={loginValue}
              onChange={(event) => setLoginValue(event.target.value)}
              placeholder="Например: manager или user@mail.ru"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Пароль</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Введите пароль"
            />
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-blue-600 hover:text-blue-700">
            Забыли пароль?
          </Link>
          <Link href="/register" className="text-blue-600 hover:text-blue-700">
            Регистрация
          </Link>
        </div>
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
