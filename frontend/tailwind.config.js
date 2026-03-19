/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0B110E",
          raised: "#121D17",
          overlay: "#1A2820",
        },
        border: {
          DEFAULT: "#1E2E25",
          light: "#2A3E32",
        },
        accent: {
          DEFAULT: "#4A7C59",
          hover: "#3D6B4A",
          muted: "#1A3328",
        },
        secondary: {
          DEFAULT: "#8B6F4E",
          muted: "#2E2418",
        },
        success: {
          DEFAULT: "#22C55E",
          muted: "#064E3B",
        },
        warning: {
          DEFAULT: "#F59E0B",
          muted: "#78350F",
        },
        danger: {
          DEFAULT: "#EF4444",
          muted: "#7F1D1D",
        },
        text: {
          primary: "#F1F5F9",
          secondary: "#94A3B8",
          muted: "#64748B",
        },
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
