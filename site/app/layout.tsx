import type { Metadata } from "next";
import { IBM_Plex_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/app-providers";

const plex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sora",
  display: "swap",
  weight: ["500", "600", "700"],
});

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "СкладОнлайн - автоматизация склада для малого и среднего бизнеса",
  description:
    "Маркетинговый сайт СкладОнлайн: живые сценарии складской работы, кейсы и переход в рабочее приложение.",
  icons: {
    icon: "/icon-192.png",
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${plex.variable} ${manrope.variable} bg-[#eef4ff] font-[var(--font-manrope)] text-slate-900 antialiased`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
