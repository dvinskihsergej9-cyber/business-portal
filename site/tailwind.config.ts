import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./data/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ebf4ff",
          100: "#d9e8ff",
          200: "#b3d1ff",
          300: "#8ab8ff",
          400: "#5d96ff",
          500: "#2f73ff",
          600: "#1754db",
          700: "#123ea3",
          800: "#102f76",
          900: "#0e255b",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(118,166,255,0.25), 0 20px 60px rgba(23,84,219,0.35)",
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(145,190,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(145,190,255,0.08) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
