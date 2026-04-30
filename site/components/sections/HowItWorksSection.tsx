"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { workflowSteps } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/ui/Reveal";

export function HowItWorksSection() {
  return (
    <section id="workflow" className="py-16 sm:py-24">
      <Container>
        <Reveal>
          <SectionHeading
            badge="Как работает система"
            title="Реальный сценарий склада: от приемки до отгрузки"
            description="Каждый шаг подтверждается в приложении и сразу отражается в данных команды: статусы, остатки, история и контроль."
          />
        </Reveal>

        <div className="grid gap-6 lg:grid-cols-2">
          {workflowSteps.map((item, index) => (
            <Reveal key={item.step} delay={index * 0.08}>
              <motion.article
                whileHover={{ y: -4 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden rounded-2xl border border-brand-200/75 bg-white/85 shadow-[0_14px_32px_rgba(31,81,177,0.1)]"
              >
                <div className="relative h-56 overflow-hidden border-b border-brand-200/70 sm:h-64">
                  <Image
                    src={item.image}
                    alt={`${item.title} в СкладОнлайн`}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                  />
                  <div className="absolute left-4 top-4 inline-flex items-center rounded-full border border-brand-300/80 bg-brand-500 px-3 py-1 text-xs font-semibold text-white">
                    Шаг {item.step}
                  </div>
                </div>

                <div className="space-y-4 p-6">
                  <h3 className="font-[var(--font-sora)] text-xl font-semibold text-slate-900">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{item.description}</p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-brand-200/70 bg-brand-50/65 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-brand-700">Сценарий</p>
                      <p className="mt-1 text-sm text-slate-800">{item.scenario}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-700">Результат</p>
                      <p className="mt-1 text-sm text-slate-800">{item.result}</p>
                    </div>
                  </div>
                </div>
              </motion.article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
