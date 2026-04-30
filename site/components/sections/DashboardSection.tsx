"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { dashboardMetrics, liveScreens } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";

const streamEvents = [
  { title: "Приемка поставки #ASN-4201", status: "Подтверждено", time: "только что" },
  { title: "Размещение в A-12", status: "Завершено", time: "2 мин назад" },
  { title: "Отбор заказа #ORD-911", status: "В работе", time: "5 мин назад" },
  { title: "Отгрузка по маршруту N-18", status: "Готово", time: "8 мин назад" },
];

export function DashboardSection() {
  return (
    <section id="dashboard" className="py-16 sm:py-24">
      <Container>
        <Reveal>
          <SectionHeading
            badge="Живые экраны"
            title="Интерфейс, в котором команда ведет склад каждый день"
            description="Скриншоты ниже из рабочего контура приложения: задачи, локации, остатки, история операций и паллетный учет."
          />
        </Reveal>

        <Reveal>
          <div className="overflow-hidden rounded-[28px] border border-brand-200/80 bg-white p-4 shadow-[0_24px_64px_rgba(17,72,176,0.14)] sm:p-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {dashboardMetrics.map((metric, index) => (
                <motion.article
                  key={metric.label}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.45, delay: index * 0.08 }}
                  className="rounded-xl border border-brand-200/70 bg-brand-50/45 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.12em] text-brand-700">{metric.label}</p>
                  <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-slate-900">{metric.value}</p>
                  <p className="mt-1 text-xs text-emerald-600">{metric.trend}</p>
                </motion.article>
              ))}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {liveScreens.map((screen, index) => (
                  <motion.article
                    key={screen.title}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.45, delay: index * 0.06 }}
                    className="overflow-hidden rounded-2xl border border-brand-200/75 bg-white"
                  >
                    <div className="relative h-40 overflow-hidden border-b border-brand-200/70">
                      <Image
                        src={screen.image}
                        alt={screen.title}
                        fill
                        className="object-cover transition duration-500 hover:scale-[1.03]"
                        sizes="(max-width: 640px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    </div>
                    <div className="p-3">
                      <p className="font-[var(--font-sora)] text-sm font-semibold text-slate-900">{screen.title}</p>
                      <p className="mt-1 text-xs text-slate-600">{screen.caption}</p>
                    </div>
                  </motion.article>
                ))}
              </div>

              <aside className="rounded-2xl border border-brand-200/80 bg-brand-50/55 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-[var(--font-sora)] text-lg font-semibold text-slate-900">Поток операций</h3>
                  <span className="rounded-full border border-brand-300/70 bg-white px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-brand-700">
                    онлайн
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {streamEvents.map((item, index) => (
                    <motion.div
                      key={item.title}
                      initial={{ opacity: 0, x: 14 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: index * 0.08 }}
                      className="rounded-xl border border-brand-200/70 bg-white/80 p-3"
                    >
                      <p className="text-sm text-slate-900">{item.title}</p>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="text-brand-700">{item.status}</span>
                        <span className="text-slate-500">{item.time}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
