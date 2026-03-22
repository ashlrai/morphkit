import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#6366F1',
        secondary: '#4F46E5',
        accent: '#10B981',
        background: '#0F0F0F',
        surface: '#1A1A2E',
      },
    },
  },
  plugins: [],
};

export default config;
