"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PropsWithChildren, useMemo } from "react";
import { logout } from "@/services/api";
import { useSessionStore } from "@/store/session-store";

const navItems = [
  { href: "/dashboard", label: "Дашборд" },
  { href: "/tasks", label: "Задачи" },
  { href: "/notifications", label: "Уведомления" },
  { href: "/documents", label: "Документы" },
  { href: "/history", label: "История" },
  { href: "/statuses", label: "Статусы" },
  { href: "/analytics", label: "Аналитика" },
  { href: "/admin", label: "Админ" },
  { href: "/profile", label: "Профиль" },
  { href: "/settings", label: "Настройки" },
];

export function PortalShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useSessionStore((state) => state.user);

  const visibleItems = useMemo(() => {
    const isAdmin = user?.role === "ADMIN";
    return navItems.filter((item) => {
      if (item.href === "/admin" || item.href === "/analytics" || item.href === "/settings") {
        return isAdmin;
      }
      return true;
    });
  }, [user?.role]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,#e9f2ff_0,#f8fbff_42%,#f2f7ff_100%)] text-slate-900">
      <div className="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[260px_1fr] lg:p-6">
        <aside className="rounded-3xl border border-blue-100 bg-white/90 p-4 shadow-[0_14px_36px_rgba(32,73,146,0.12)] backdrop-blur">
          <Link href="/" className="mb-4 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-3 py-2">
            <Image src="/icon-192.png" alt="СкладОнлайн" width={36} height={36} className="h-9 w-9 rounded-lg" />
            <div>
              <p className="font-[var(--font-sora)] text-sm font-semibold">СкладОнлайн</p>
              <p className="text-xs text-slate-500">Web Console</p>
            </div>
          </Link>

          <nav className="space-y-1">
            {visibleItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-xl px-3 py-2 text-sm transition ${
                    active
                      ? "bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.35)]"
                      : "text-slate-600 hover:bg-blue-50 hover:text-blue-700"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">{user?.name || "Пользователь"}</p>
            <p>{user?.email}</p>
            <p className="mt-1">Роль: {user?.role || "-"}</p>
            <button
              type="button"
              onClick={async () => {
                await logout().catch(() => null);
                router.replace("/login");
              }}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Выйти
            </button>
          </div>
        </aside>

        <main className="rounded-3xl border border-blue-100 bg-white/90 p-4 shadow-[0_16px_42px_rgba(32,73,146,0.12)] backdrop-blur lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
