import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FDFCFC",
        ink: {
          DEFAULT: "#0f172a",
          secondary: "#475569",
          muted: "#64748b",
          faint: "#94a3b8",
        },
        line: "#e2e8f0",
        fill: {
          DEFAULT: "#f1f5f9",
          soft: "#f8fafc",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(15, 23, 42, 0.08)",
        "card-lg": "0 18px 45px rgba(15, 23, 42, 0.08)",
      },
      letterSpacing: {
        eyebrow: "0.18em",
      },
    },
  },
  plugins: [],
};

export default config;
