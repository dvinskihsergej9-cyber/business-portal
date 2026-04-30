import { ReactNode } from "react";

type GlassCardProps = {
  children: ReactNode;
  className?: string;
};

export function GlassCard({ children, className = "" }: GlassCardProps) {
  return (
    <div
      className={`rounded-2xl border border-brand-200/70 bg-gradient-to-b from-white/95 to-brand-50/70 p-6 shadow-[0_14px_36px_rgba(31,81,177,0.12)] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}