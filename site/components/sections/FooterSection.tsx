import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { LogoCube } from "@/components/visual/LogoCube";

export function FooterSection() {
  return (
    <footer className="border-t border-brand-200/70 bg-white/60 py-8">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <LogoCube compact />
          <div>
            <p className="font-[var(--font-sora)] text-sm font-semibold text-slate-900">СкладОнлайн</p>
            <p className="text-xs text-slate-500">Платформа складского управления для команд малого и среднего бизнеса</p>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
          <Link href="#features" className="transition hover:text-brand-700">
            Возможности
          </Link>
          <Link href="#workflow" className="transition hover:text-brand-700">
            Как работает
          </Link>
          <Link href="#business" className="transition hover:text-brand-700">
            Кому подойдет
          </Link>
          <Link href="#cases" className="transition hover:text-brand-700">
            Кейсы
          </Link>
          <Link href="#faq" className="transition hover:text-brand-700">
            Вопросы
          </Link>
        </nav>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <Link href="/offer" className="transition hover:text-brand-700">
            Оферта
          </Link>
          <Link href="/privacy" className="transition hover:text-brand-700">
            Политика
          </Link>
          <Link href="/refund" className="transition hover:text-brand-700">
            Возврат
          </Link>
          <Link href="/contacts" className="transition hover:text-brand-700">
            Контакты
          </Link>
          <span>© {new Date().getFullYear()} СкладОнлайн</span>
        </div>
      </Container>
    </footer>
  );
}
