import { faq } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function FaqSection() {
  return (
    <section id="faq" className="py-16 sm:py-24">
      <Container>
        <Reveal>
          <SectionHeading
            badge="Вопросы и ответы"
            title="Ответы на ключевые вопросы перед запуском"
            description="Коротко о том, как устроены данные, роли, запуск и операционный контроль в системе."
          />
        </Reveal>

        <div className="space-y-3">
          {faq.map((item, index) => (
            <Reveal key={item.question} delay={index * 0.05}>
              <details className="group rounded-2xl border border-brand-200/75 bg-white/80 p-5 shadow-[0_10px_24px_rgba(31,81,177,0.08)] backdrop-blur-lg">
                <summary className="cursor-pointer list-none font-[var(--font-sora)] text-lg font-medium text-slate-900 marker:content-none">
                  <div className="flex items-center justify-between gap-4">
                    <span>{item.question}</span>
                    <span className="text-brand-700 transition group-open:rotate-45">+</span>
                  </div>
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{item.answer}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
