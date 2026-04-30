import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_12%_0%,#dbeafe_0,#eef4ff_40%,#f8fbff_100%)]">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgba(147,197,253,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(147,197,253,0.12)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2 rounded-full border border-blue-100 bg-white/90 px-3 py-1 text-sm">
          <Image src="/icon-192.png" alt="СкладОнлайн" width={24} height={24} className="h-6 w-6 rounded" />
          <span className="font-medium">СкладОнлайн</span>
        </Link>
      </header>
      {children}
    </div>
  );
}
