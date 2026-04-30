import Image from "next/image";
import { cn } from "@/lib/cn";

type LogoCubeProps = {
  className?: string;
  compact?: boolean;
};

export function LogoCube({ className, compact = false }: LogoCubeProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-brand-300/60 bg-white shadow-[0_8px_24px_rgba(18,62,163,0.18)]",
        compact ? "h-9 w-9" : "h-12 w-12",
        className,
      )}
      aria-hidden="true"
    >
      <Image
        src="/icon-192.png"
        alt="Логотип СкладОнлайн"
        fill
        sizes={compact ? "36px" : "48px"}
        className="object-cover"
        priority={compact}
      />
    </div>
  );
}