/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#F7F2E8",
        surface: "#FFFDF8",
        "surface-muted": "#F3ECE0",
        border: "#E4DAC6",
        ink: "#1C2B24",
        muted: "#6B766E",
        forest: {
          DEFAULT: "#14402F",
          2: "#1F5A43",
          dark: "#0F3325",
          light: "#266B50",
        },
        marigold: {
          DEFAULT: "#E7A11A",
          dark: "#D08F14",
          light: "#FDF5E6",
        },
        terracotta: {
          DEFAULT: "#B5412B",
          dark: "#993320",
          light: "#FDF0ED",
        },
        leaf: {
          DEFAULT: "#2F7D4F",
          dark: "#25663F",
          light: "#EDF7F1",
        },
      },
      fontFamily: {
        serif: ["'Noto Serif Devanagari'", "Georgia", "serif"],
        body: ["'Anek Devanagari'", "Mukta", "-apple-system", "sans-serif"],
      },
      borderRadius: {
        input: "8px",
        panel: "14px",
      },
    },
  },
  plugins: [],
}
