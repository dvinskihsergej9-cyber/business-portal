"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Container } from "@/components/ui/Container";
import { LogoCube } from "@/components/visual/LogoCube";

const APP_URL = String(process.env.NEXT_PUBLIC_APP_URL || "https://skladonline74.ru").replace(/\/+$/, "");

const navItems = [
  { label: "Возможности", href: "#features" },
  { label: "Как работает", href: "#workflow" },
  { label: "Кому подойдет", href: "#business" },
  { label: "Кейсы", href: "#cases" },
  { label: "Вопросы", href: "#faq" },
];

const quickShots = [
  { src: "/live-assets/app/tasks.webp", caption: "Задачи смены" },
  { src: "/live-assets/app/locations.webp", caption: "Адресные ячейки" },
  { src: "/live-assets/app/inventory.webp", caption: "Остатки и ревизия" },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-6 sm:pt-8">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_4%,rgba(94,159,255,0.3),transparent_28%),radial-gradient(circle_at_88%_16%,rgba(120,184,255,0.26),transparent_32%)]" />
      <Container>
        <header className="rounded-2xl border border-brand-200/80 bg-white/85 px-5 py-4 shadow-[0_16px_42px_rgba(35,83,176,0.12)] backdrop-blur-xl sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <Link href="#" className="flex items-center gap-3">
              <LogoCube compact />
              <div>
                <p className="font-[var(--font-sora)] text-sm font-semibold text-slate-900">СкладОнлайн</p>
                <p className="text-xs text-slate-500">Живой контроль склада для малого и среднего бизнеса</p>
              </div>
            </Link>

            <nav className="hidden items-center gap-6 lg:flex">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="text-sm text-slate-600 transition hover:text-brand-700">
                  {item.label}
                </Link>
              ))}
            </nav>

            <Link
              href={`${APP_URL}/login`}
              className="rounded-full border border-brand-300/70 bg-brand-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-brand-600"
            >
              Войти в приложение
            </Link>
          </div>
        </header>

        <div className="relative mt-8 grid gap-8 pb-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-20">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            className="relative"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-300/60 bg-brand-100/90 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">
              Живой продукт для склада малого и среднего бизнеса
            </span>
            <h1 className="mt-6 max-w-2xl font-[var(--font-sora)] text-4xl font-semibold leading-[1.05] text-slate-900 sm:text-5xl lg:text-6xl">
              Складской продукт,
              <span className="bg-gradient-to-r from-brand-600 via-brand-500 to-brand-400 bg-clip-text text-transparent">
                {" "}
                который работает в живой операционке
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              СкладОнлайн создан для малого и среднего бизнеса: учет, приемка, размещение, отбор и отгрузка в едином
              рабочем контуре без тяжелой корпоративной WMS.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="#workflow"
                className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_34px_rgba(47,115,255,0.36)] transition hover:bg-brand-600"
              >
                Посмотреть сценарии работы
              </Link>
              <Link
                href={`${APP_URL}/warehouse`}
                className="rounded-xl border border-brand-300/60 bg-white px-6 py-3 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
              >
                Открыть приложение
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                ["МСБ", "фокус на малый и средний бизнес"],
                ["1-3", "склада/зоны под единым контролем"],
                ["24/7", "журналы и статусы в реальном времени"],
              ].map(([value, caption]) => (
                <div key={value} className="rounded-xl border border-brand-200/75 bg-white/80 px-4 py-3 shadow-[0_8px_24px_rgba(56,102,184,0.08)] backdrop-blur-lg">
                  <p className="font-[var(--font-sora)] text-xl font-semibold text-slate-900">{value}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.08em] text-slate-500">{caption}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {["Приемка", "Размещение", "Отбор", "Отгрузка", "Аналитика"].map((stage, index) => (
                <motion.span
                  key={stage}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.22 + index * 0.08 }}
                  className="rounded-full border border-brand-300/70 bg-white px-3 py-1 text-xs font-medium text-brand-700"
                >
                  {stage}
                </motion.span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.08 }}
            className="relative"
          >
            <div className="absolute -right-6 -top-6 h-36 w-36 rounded-full bg-brand-300/35 blur-2xl" />
            <div className="rounded-[28px] border border-brand-200/80 bg-white p-3 shadow-[0_24px_64px_rgba(17,72,176,0.14)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="relative overflow-hidden rounded-2xl border border-brand-200/70 bg-brand-50/60 p-2 sm:row-span-2">
                  <Image
                    src="/live-assets/app/transactions.webp"
                    alt="Живой интерфейс журнала операций"
                    width={840}
                    height={560}
                    className="h-full w-full rounded-xl object-cover"
                    priority
                  />
                </div>
                {quickShots.map((shot) => (
                  <div key={shot.src} className="relative overflow-hidden rounded-2xl border border-brand-200/70 bg-brand-50/60 p-2">
                    <Image
                      src={shot.src}
                      alt={shot.caption}
                      width={640}
                      height={420}
                      className="h-full w-full rounded-xl object-cover"
                    />
                    <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-white/70 bg-white/85 px-2 py-1 text-[10px] font-medium text-slate-700">
                      {shot.caption}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
