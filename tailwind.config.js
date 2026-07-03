/** @type {import('tailwindcss').Config} */
import colors from 'tailwindcss/colors'

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4ff',
          100: '#fae8ff',
          200: '#f5d0fe',
          300: '#f0abfc',
          400: '#e879f9',
          500: '#d946ef',  // основной — фуксия/маджента
          600: '#c026d3',
          700: '#a21caf',
          800: '#86198f',
          900: '#701a75',
          950: '#4a044e',
        },
        // Семантические токены (Фаза A) — алиасы на полные шкалы Tailwind.
        // Назначены по замеру реального использования в src/ (см. docs/refactor/A-fundament-spec.md).
        success: colors.emerald, // emerald 262 + green 210
        danger: colors.red,      // 230
        warning: colors.amber,   // amber 142 + yellow 25
        info: colors.blue,       // 170
      },
      minWidth: {
        touch: '44px',
      },
      minHeight: {
        touch: '44px',
      },
    },
  },
  plugins: [],
}
