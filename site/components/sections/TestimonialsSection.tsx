import Image from "next/image";
import { testimonials } from "@/data/site-content";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function TestimonialsSection() {
  return (
    <section id="cases" className="py-16 sm:py-24">
      <Container>
        <Reveal>
          <SectionHeading
            badge="Кейсы и отзывы"
            title="Результаты, которые видны в складских показателях"
            description="Живые кейсы из сегмента малого и среднего бизнеса: меньше расхождений, быстрее цикл заказа и выше управляемость операций."
          />
        </Reveal>

        <div className="grid gap-4 lg:grid-cols-3">
          {testimonials.map((item, index) => (
            <Reveal key={item.company} delay={index * 0.08}>
              <article className="h-full overflow-hidden rounded-2xl border border-brand-200/75 bg-white/80 shadow-[0_14px_32px_rgba(31,81,177,0.1)] backdrop-blur-lg">
                <div className="relative h-44 overflow-hidden border-b border-brand-200/70">
                  <Image
                    src={item.image}
                    alt={item.company}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 33vw"
                  />
                </div>
                <div className="space-y-3 p-6">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-700">{item.company}</p>
                  <p className="text-sm text-slate-500">
                    {item.role} · {item.manager}
                  </p>
                  <p className="text-base leading-relaxed text-slate-800">{item.quote}</p>
                  <p className="rounded-lg border border-emerald-300/55 bg-emerald-100/80 px-3 py-2 text-sm font-semibold text-emerald-700">
                    {item.effect}
                  </p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
