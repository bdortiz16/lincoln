/** @type {import('tailwindcss').Config} */
// Migrado desde el Play CDN (cdn.tailwindcss.com) que se configuraba
// inline en index.html — mismo theme.extend. El CSS ahora se compila en
// el build de Vite: nada de estilos dependientes de CDNs en runtime.
export default {
  content: [
    './index.html',
    './*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './context/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        cuypay: {
          dark: '#0F172A',
          accent: '#2DD4BF',
          light: '#F8FAFC',
        },
      },
    },
  },
  plugins: [],
};
