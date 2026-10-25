import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1B1410",
        paper: "#FBF3E6",
        surface: "#FFFFFF",
        sand: "#F2E1C8",
        orange: "#F26A1B",
        "orange-deep": "#C2410C",
        apricot: "#FFB27A",
        peach: "#FFD9B8",
        terracotta: "#B5472E",
        teal: "#0F766E",
        indigo: "#3B3FD9",
        muted: "#6B5E52",
        line: "#E5D3BA",
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        ui: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderWidth: {
        DEFAULT: "2px",
      },
      borderRadius: {
        DEFAULT: "6px",
      },
    },
  },
  plugins: [],
} satisfies Config;