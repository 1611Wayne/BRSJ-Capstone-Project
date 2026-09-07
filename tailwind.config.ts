import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          ink: 'var(--brand-ink)',
          nav: 'var(--brand-nav)',
          'nav-soft': 'var(--brand-nav-soft)',
          primary: 'var(--brand-primary)',
          'primary-hover': 'var(--brand-primary-hover)',
          accent: 'var(--brand-accent)',
          gold: 'var(--brand-gold)',
          'gold-soft': 'var(--brand-gold-soft)',
          soft: 'var(--brand-soft)',
          border: 'var(--brand-border)',
          muted: 'var(--brand-muted)',
        },
        'page-bg': 'var(--page-bg)',
        'surface-muted': 'var(--surface-muted)',
        slate: {
          50: '#fcfaf7',
          100: '#f5f0e9',
          200: '#e8dfd4',
          300: '#d0c2b2',
          400: '#a18e7b',
          500: '#7c6a58',
          600: '#655443',
          700: '#704522',
          800: '#663b17',
          900: '#63320f',
        },
      },
      boxShadow: {
        panel: '0 6px 22px rgba(99, 50, 15, 0.08)',
      },
    },
  },
  plugins: [],
};
export default config;
