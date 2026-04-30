import { advantages } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GlassCard } from "@/components/ui/GlassCard";

export function BenefitsSection() {
  return (
    <section id="benefits" className="py-16 sm:py-20">
      <Container>
        <Reveal>
          <SectionHeading
            badge="Преимущества"
            title="Система, которая держит склад в управляемом режиме"
            description="СкладОнлайн убирает разрывы между процессами: учет, задачи, роли и операции работают в одном контуре без ручных сверок."
          />
        </Reveal>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {advantages.map((item, index) => (
            <Reveal key={item.title} delay={index * 0.08}>
              <GlassCard className="h-full">
                <p className="text-xs uppercase tracking-[0.16em] text-brand-700">{item.stat}</p>
                <h3 className="mt-3 font-[var(--font-sora)] text-xl font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.description}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
