"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { resendVerificationCode, verifyEmailCode } from "@/services/api";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = useMemo(() => String(searchParams.get("email") || "").trim(), [searchParams]);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      await verifyEmailCode(email, code.replace(/\s+/g, ""));
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подтвердить код.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <section className="w-full rounded-3xl border border-blue-100 bg-white p-6 shadow-[0_16px_42px_rgba(35,83,176,0.12)]">
        <h1 className="font-[var(--font-sora)] text-2xl font-semibold">Подтверждение email</h1>
        <p className="mt-2 text-sm text-slate-500">Код отправлен на: {email || "указанный адрес"}</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-700">Код из письма</span>
            <input
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="6 цифр"
              maxLength={6}
            />
          </label>

          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Проверяем..." : "Подтвердить"}
          </button>

          <button
            type="button"
            disabled={resending || !email}
            onClick={async () => {
              if (!email) return;
              setResending(true);
              setError("");
              try {
                const result = await resendVerificationCode(email);
                setMessage(result.message);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Не удалось отправить код повторно.");
              } finally {
                setResending(false);
              }
            }}
            className="w-full rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resending ? "Отправляем..." : "Отправить код повторно"}
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
