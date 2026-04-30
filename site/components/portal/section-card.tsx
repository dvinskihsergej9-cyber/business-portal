import { PropsWithChildren } from "react";

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}>;

export function SectionCard({ title, subtitle, actions, children }: Props) {
  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_8px_22px_rgba(28,68,150,0.08)]">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-[var(--font-sora)] text-lg font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
