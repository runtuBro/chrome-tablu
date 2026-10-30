/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* 语义色：值全部来自 CSS 变量，浅色/深色只切换变量即可。
           用 <alpha-value> 以保留 bg-xxx/50 这类透明度修饰符的能力。 */
        ink: {
          900: 'rgb(var(--tm-ink-900) / <alpha-value>)',
          700: 'rgb(var(--tm-ink-700) / <alpha-value>)',
          500: 'rgb(var(--tm-ink-500) / <alpha-value>)',
          300: 'rgb(var(--tm-ink-300) / <alpha-value>)',
        },
        surface: 'rgb(var(--tm-surface) / var(--tm-surface-a))',
        hairline: 'rgb(var(--tm-hairline) / var(--tm-hairline-a))',
        hoverbg: 'rgb(var(--tm-hover) / var(--tm-hover-a))',
        hoverstrong: 'rgb(var(--tm-hover) / var(--tm-hover-strong-a))',
        fieldbg: 'rgb(var(--tm-field) / var(--tm-field-a))',
        glassring: 'rgb(var(--tm-ring) / var(--tm-ring-a))',
        accentsoft: 'rgb(var(--tm-accent-soft) / var(--tm-accent-soft-a))',

        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
      },
      keyframes: {
        panelIn: {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.985)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
      animation: {
        panelIn: 'panelIn 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        fadeIn: 'fadeIn 160ms ease-out',
        blink: 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
};
