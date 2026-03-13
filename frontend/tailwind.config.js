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
        // StabL dark theme
        surface: {
          DEFAULT: "#0B0F1A",
          raised: "#131825",
          overlay: "#1A2035",
        },
        border: {
          DEFAULT: "#1E2536",
          light: "#2A3348",
        },
        accent: {
          DEFAULT: "#3B82F6",
          hover: "#2563EB",
          muted: "#1E3A5F",
        },
        success: {
          DEFAULT: "#10B981",
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
          secondary: "#64748B",
          muted: "#475569",
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
