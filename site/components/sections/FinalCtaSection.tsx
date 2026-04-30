import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";

const APP_URL = String(process.env.NEXT_PUBLIC_APP_URL || "https://skladonline74.ru").replace(/\/+$/, "");

export function FinalCtaSection() {
  return (
    <section id="cta" className="pb-16 pt-10 sm:pb-24">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[30px] border border-brand-300/40 bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 px-6 py-10 shadow-[0_20px_56px_rgba(24,73,173,0.35)] sm:px-10 sm:py-14">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_25%,rgba(255,255,255,0.26),transparent_40%),radial-gradient(circle_at_80%_75%,rgba(145,190,255,0.3),transparent_36%)]" />
            <div className="relative z-10 max-w-3xl">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-100/90">СкладОнлайн</p>
              <h2 className="mt-4 font-[var(--font-sora)] text-3xl font-semibold leading-tight text-white sm:text-4xl">
                Запустите управляемый склад без тяжелого корпоративного проекта
              </h2>
              <p className="mt-4 max-w-2xl text-sm text-brand-100 sm:text-base">
                Зарегистрируйте компанию, настройте роли команды и начните работать в едином операционном контуре:
                приемка, размещение, отбор, отгрузка, журналы и аналитика.
              </p>

              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href={`${APP_URL}/register`}
                  className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
                >
                  Зарегистрировать компанию
                </Link>
                <Link
                  href={`${APP_URL}/login`}
                  className="rounded-xl border border-white/45 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  Войти в приложение
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
