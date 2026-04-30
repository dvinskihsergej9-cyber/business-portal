type SectionHeadingProps = {
  badge: string;
  title: string;
  description: string;
  align?: "left" | "center";
};

export function SectionHeading({ badge, title, description, align = "left" }: SectionHeadingProps) {
  const alignmentClass = align === "center" ? "items-center text-center" : "items-start text-left";

  return (
    <div className={`mb-12 flex max-w-3xl flex-col gap-4 ${alignmentClass}`}>
      <span className="inline-flex rounded-full border border-brand-300/50 bg-brand-100/80 px-4 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">
        {badge}
      </span>
      <h2 className="font-[var(--font-sora)] text-3xl font-semibold leading-tight text-slate-900 sm:text-4xl">{title}</h2>
      <p className="text-sm text-slate-600 sm:text-base">{description}</p>
    </div>
  );
}