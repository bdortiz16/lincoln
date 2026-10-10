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
      // Archivo en todo — es la tipografía de la marca. Mientras acá decía
      // Inter, TODA clase de Tailwind resolvía a Inter: solo se salvaban los
      // componentes que declaran fontFamily inline.
      fontFamily: {
        sans: ['Archivo', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Los tokens siguen llamándose "cuypay" por la marca anterior; el
        // nombre está regado por el onboarding y renombrarlo es otro cambio.
        // Los VALORES sí son ya los de Lincoin, que es lo que se ve.
        cuypay: {
          dark: '#0A0C0B',
          accent: '#4ADE80',
          light: '#F4F4F2',
        },
      },
    },
  },
  plugins: [],
};
