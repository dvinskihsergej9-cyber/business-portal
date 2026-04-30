import { businessTypes, smbFitChecklist } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function BusinessTypesSection() {
  return (
    <section id="business" className="py-16 sm:py-24">
      <Container>
        <Reveal>
          <SectionHeading
            badge="Кому подойдет"
            title="СкладОнлайн для малого и среднего бизнеса"
            description="Подходит складам и компаниям, которым нужен управляемый операционный контур без дорогой корпоративной WMS."
          />
        </Reveal>

        <div className="mb-8 rounded-2xl border border-brand-200/80 bg-white/80 p-5 shadow-[0_14px_32px_rgba(31,81,177,0.08)]">
          <p className="text-xs uppercase tracking-[0.16em] text-brand-700">Типичный профиль клиента</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {smbFitChecklist.map((item) => (
              <div key={item} className="rounded-xl border border-brand-200/70 bg-brand-50/60 px-3 py-2 text-sm text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {businessTypes.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.05}>
              <article className="h-full rounded-2xl border border-brand-200/75 bg-gradient-to-br from-white via-brand-50/65 to-brand-100/65 p-6 shadow-[0_14px_32px_rgba(31,81,177,0.1)]">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-[var(--font-sora)] text-2xl font-semibold text-slate-900">{item.title}</h3>
                  <span className="rounded-full border border-brand-300/75 bg-white px-3 py-1 text-xs font-semibold text-brand-700">
                    {item.icon}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.description}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.modules.map((moduleName) => (
                    <span
                      key={moduleName}
                      className="rounded-full border border-brand-300/65 bg-brand-100/85 px-3 py-1 text-xs font-medium text-brand-700"
                    >
                      {moduleName}
                    </span>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
