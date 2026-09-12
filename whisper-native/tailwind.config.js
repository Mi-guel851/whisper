/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        brand: {
          cyan: '#22d3ee',
          purple: '#a855f7',
        },
        dark: '#0a0814',
      }
    },
  },
  plugins: [],
}