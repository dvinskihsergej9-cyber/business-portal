import Link from "next/link";
import { BenefitsSection } from "@/components/sections/BenefitsSection";
import { BusinessTypesSection } from "@/components/sections/BusinessTypesSection";
import { DashboardSection } from "@/components/sections/DashboardSection";
import { FaqSection } from "@/components/sections/FaqSection";
import { FeaturesSection } from "@/components/sections/FeaturesSection";
import { FinalCtaSection } from "@/components/sections/FinalCtaSection";
import { FooterSection } from "@/components/sections/FooterSection";
import { HeroSection } from "@/components/sections/HeroSection";
import { HowItWorksSection } from "@/components/sections/HowItWorksSection";
import { TestimonialsSection } from "@/components/sections/TestimonialsSection";

const APP_ORIGIN = String(
  process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "https://skladonline74.ru"
)
  .trim()
  .replace(/\/+$/, "");

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#eef4ff]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_6%,rgba(103,168,255,0.28),transparent_34%),radial-gradient(circle_at_86%_14%,rgba(176,211,255,0.44),transparent_33%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_42%,#e8f0ff_100%)]" />

      <div className="sticky top-0 z-40 border-b border-blue-100/80 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2">
          <div className="text-sm text-slate-600">Маркетинговый сайт СкладОнлайн</div>
          <div className="flex items-center gap-2">
            <Link
              href={`${APP_ORIGIN}/login`}
              className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              Войти
            </Link>
            <Link
              href={`${APP_ORIGIN}/register`}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Регистрация
            </Link>
            <Link
              href={`${APP_ORIGIN}/warehouse`}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Открыть приложение
            </Link>
          </div>
        </div>
      </div>

      <HeroSection />
      <BenefitsSection />
      <FeaturesSection />
      <HowItWorksSection />
      <BusinessTypesSection />
      <DashboardSection />
      <TestimonialsSection />
      <FaqSection />
      <FinalCtaSection />
      <FooterSection />
    </main>
  );
}
