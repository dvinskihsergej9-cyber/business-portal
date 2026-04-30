import { features } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function FeaturesSection() {
  return (
    <section id="features" className="relative py-16 sm:py-24">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_22%_20%,rgba(82,148,255,0.16),transparent_36%)]" />
      <Container>
        <Reveal>
          <SectionHeading
            badge="Возможности"
            title="Полный контур складских процессов в одной системе"
            description="От приемки до аналитики: все этапы связаны едиными статусами, ролями и журналом действий."
          />
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 0.05}>
              <article className="group h-full rounded-2xl border border-brand-200/75 bg-gradient-to-b from-white to-brand-50/80 p-5 shadow-[0_14px_32px_rgba(31,81,177,0.1)] transition hover:border-brand-300/80 hover:shadow-[0_22px_40px_rgba(21,63,167,0.16)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-brand-700">{feature.label}</p>
                <h3 className="mt-3 font-[var(--font-sora)] text-xl font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{feature.description}</p>
                <div className="mt-6 h-[2px] w-16 bg-gradient-to-r from-brand-400 to-transparent transition group-hover:w-24" />
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
