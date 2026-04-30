"use client";

import { motion } from "framer-motion";

const routes = [
  "M 50 70 C 190 70, 180 170, 330 170",
  "M 55 210 C 180 210, 205 105, 380 105",
  "M 125 300 C 250 300, 250 235, 400 235",
];

const zones = [
  { name: "Приемка", load: "82%", className: "left-4 top-4" },
  { name: "Хранение A1", load: "64%", className: "right-4 top-8" },
  { name: "Сборка", load: "71%", className: "left-10 bottom-8" },
  { name: "Отгрузка", load: "93%", className: "right-6 bottom-4" },
];

const movingBoxes = [
  {
    id: "route-1",
    start: { x: 50, y: 70 },
    x: [0, 145, 280],
    y: [0, 65, 100],
    duration: 6,
    delay: 0.2,
  },
  {
    id: "route-2",
    start: { x: 55, y: 210 },
    x: [0, 140, 325],
    y: [0, -85, -105],
    duration: 7,
    delay: 1,
  },
  {
    id: "route-3",
    start: { x: 125, y: 300 },
    x: [0, 150, 275],
    y: [0, -55, -65],
    duration: 5.5,
    delay: 0.8,
  },
];

export function WarehouseMapScene() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="relative h-[430px] overflow-hidden rounded-[30px] border border-brand-200/80 bg-[#f8fbff] shadow-[0_20px_50px_rgba(23,84,219,0.16)]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(114,173,255,0.2),transparent_40%),radial-gradient(circle_at_80%_82%,rgba(38,112,255,0.14),transparent_42%)]" />
      <div className="absolute inset-0 bg-grid-pattern bg-[size:26px_26px] opacity-70" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />

      <svg viewBox="0 0 460 360" className="absolute inset-0 h-full w-full opacity-80">
        <defs>
          <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#98c6ff" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#2f73ff" stopOpacity="1" />
          </linearGradient>
        </defs>
        {routes.map((route) => (
          <path
            key={route}
            d={route}
            fill="none"
            stroke="url(#routeGradient)"
            strokeDasharray="7 6"
            strokeWidth="2"
          />
        ))}
      </svg>

      {movingBoxes.map((box) => (
        <motion.div
          key={box.id}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: box.delay }}
          className="absolute"
          style={{ left: box.start.x, top: box.start.y }}
        >
          <motion.div
            animate={{ x: box.x, y: box.y }}
            transition={{
              duration: box.duration,
              ease: "easeInOut",
              repeat: Number.POSITIVE_INFINITY,
              repeatType: "reverse",
              delay: box.delay,
            }}
            className="h-4 w-4 rounded-[4px] border border-brand-500/90 bg-white shadow-[0_0_14px_rgba(76,145,255,0.85)]"
          />
        </motion.div>
      ))}

      <div className="absolute right-5 top-5 w-[205px] rounded-2xl border border-brand-200/70 bg-white/90 p-4 backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.2em] text-brand-700">Центр управления</p>
        <div className="mt-3 grid grid-cols-2 gap-3 text-slate-900">
          <div>
            <p className="text-[11px] text-slate-500">Активные задачи</p>
            <p className="mt-1 text-xl font-semibold">148</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">Подтверждения</p>
            <p className="mt-1 text-xl font-semibold">99.4%</p>
          </div>
        </div>
      </div>

      {zones.map((zone) => (
        <motion.div
          key={zone.name}
          className={`absolute rounded-xl border border-brand-200/70 bg-white/88 px-4 py-3 backdrop-blur-lg ${zone.className}`}
          animate={{ y: [0, -5, 0] }}
          transition={{
            duration: 4.8,
            ease: "easeInOut",
            repeat: Number.POSITIVE_INFINITY,
            repeatType: "mirror",
          }}
        >
          <p className="text-[11px] uppercase tracking-[0.14em] text-brand-700">Зона</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{zone.name}</p>
          <p className="mt-1 text-xs text-slate-600">Нагрузка: {zone.load}</p>
        </motion.div>
      ))}

      <div className="absolute bottom-5 left-1/2 w-[250px] -translate-x-1/2 rounded-2xl border border-brand-200/70 bg-white/92 p-4 backdrop-blur-xl">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>Маршруты смены</span>
          <span>12 активных</span>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-brand-100/60">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500"
            animate={{ width: ["38%", "74%", "53%"] }}
            transition={{ duration: 7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        </div>
      </div>
    </motion.div>
  );
}