import type { Config } from "tailwindcss";

// EverTide brand system. The scale keys keep their original names ("navy" =
// primary, "teal" = accent) so every component restyles from here alone:
//  - primary "deep tide": dark sea-green drawn from the logo's world
//  - accent "sea glass": the logo's soft green (#AFD8C2 family)
// Red stays reserved for overdue/blocked/critical/missing, amber for at-risk,
// green for on-track (§10) — status colors are untouched.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#14544A",
          50: "#EFF7F3",
          100: "#DCEFE6",
          200: "#BCDFD0",
          300: "#8FC7B1",
          400: "#4F977F",
          500: "#1E6B5C",
          600: "#14544A",
          700: "#0F3D34",
          800: "#0A2B25",
          900: "#061C18",
        },
        teal: {
          DEFAULT: "#3FA381",
          50: "#F0F8F4",
          100: "#DFF0E7",
          200: "#AFD8C2",
          300: "#8CC9AC",
          400: "#57B892",
          500: "#3FA381",
          600: "#2F8A6B",
          700: "#256C55",
          800: "#1A4C3C",
          900: "#0F2E24",
        },
      },
      fontFamily: {
        brand: [
          "Century Gothic",
          "Futura",
          "Avenir Next",
          "Avenir",
          "Poppins",
          "ui-rounded",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
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
