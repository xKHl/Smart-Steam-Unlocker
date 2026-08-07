/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#09090d',
          900: '#111318',
          800: '#18191f',
          700: '#1e2028',
          600: '#252831',
        },
        accent: {
          purple: '#7c3aed',
          indigo: '#4f46e5',
          blue:   '#3b82f6',
          violet: '#8b5cf6',
        },
        steam: {
          green: '#4ade80',
          red:   '#f87171',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-purple-blue':
          'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
        'gradient-radial-purple':
          'radial-gradient(ellipse at top, rgba(124,58,237,0.15) 0%, transparent 70%)',
      },
    },
  },
  plugins: [],
};
