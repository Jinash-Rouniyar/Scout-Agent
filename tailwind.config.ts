import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0e14",
        panel: "#12161f",
        panel2: "#171c28",
        border: "#232a3a",
        muted: "#8b94a7",
        text: "#e6e9f0",
        accent: "#5b9dff",
        good: "#3fb950",
        warn: "#d29922",
        bad: "#f85149",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
