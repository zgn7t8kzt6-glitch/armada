import type { Config } from "tailwindcss";

// EverTide design system (spec §10): white/light background, navy primary,
// teal accent. Red is reserved for overdue/blocked/critical/missing/failed,
// amber for at-risk, green for on-track.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#1F3864",
          50: "#EEF2F8",
          100: "#D9E1EF",
          200: "#AEC0DC",
          300: "#7D97C2",
          400: "#4F6C9E",
          500: "#2E4C7E",
          600: "#1F3864",
          700: "#182C4F",
          800: "#12213B",
          900: "#0C1628",
        },
        teal: {
          DEFAULT: "#2E7D6B",
          50: "#ECF6F3",
          100: "#D2EAE4",
          200: "#A3D4C8",
          300: "#6FB9A7",
          400: "#459B87",
          500: "#2E7D6B",
          600: "#256557",
          700: "#1C4D42",
          800: "#14362E",
          900: "#0C201C",
        },
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      minHeight: { touch: "44px" },
      minWidth: { touch: "44px" },
    },
  },
  plugins: [],
};
export default config;
