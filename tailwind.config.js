/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: 'hsl(var(--color-primary) / <alpha-value>)',
        dark: 'hsl(var(--color-dark) / <alpha-value>)',
        surface: 'hsl(var(--color-surface) / <alpha-value>)',
        muted: 'hsl(var(--color-muted) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
