import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, '.', '');
    // SIN SUPABASE NO SE PUBLICA (9 nov): una compilación de Cloudflare salió
    // sin VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY y lincoin.me quedó en
    // "Modo offline": nadie podía ingresar. Antes la compilación pasaba igual
    // y se publicaba. Ahora falla, y Cloudflare deja en línea la última
    // versión buena. Para compilar a propósito sin Supabase (pruebas locales):
    // PERMITIR_BUILD_SIN_SUPABASE=1 npm run build.
    if (command === 'build' && mode === 'production' && env.PERMITIR_BUILD_SIN_SUPABASE !== '1') {
      const faltan = [
        !String(env.VITE_SUPABASE_URL ?? '').startsWith('https://') && 'VITE_SUPABASE_URL',
        !String(env.VITE_SUPABASE_ANON_KEY ?? '').trim() && 'VITE_SUPABASE_ANON_KEY',
      ].filter(Boolean);
      if (faltan.length) {
        throw new Error(`Faltan ${faltan.join(' y ')} en las variables de compilación (Cloudflare → Workers & Pages → lincoln → Settings → Build → Variables and secrets). Sin ellas la página sale en "Modo offline" y nadie puede ingresar, así que no se compila.`);
      }
    }
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        // Acá se horneaban GEMINI_API_KEY y API_KEY en el bundle del
        // navegador. Hoy no las lee nadie —quedaron del andamiaje inicial—
        // así que compilaban a undefined; pero el día que alguien definiera
        // esa variable en el hosting, la llave quedaría publicada en el JS que
        // descarga cualquiera. Una llave de servidor no se inyecta al cliente.
        // Sello de versión visible en la UI — para saber al instante si el
        // navegador tiene el bundle nuevo o uno cacheado.
        __BUILD_TS__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // Librerías en archivos propios: varios archivos chicos bajan en
      // paralelo y quedan en caché entre despliegues (su nombre no cambia si
      // la librería no cambia). Un solo archivo grande se cortaba en redes
      // lentas y la página no cargaba.
      build: {
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              // El ayudante de import() dinámico de Vite lo usa la app entera.
              // Sin esto Rollup lo dejaba dentro de 'vendor-pdf' y la página
              // precargaba los 800 kB del PDF en cada visita.
              if (id.includes('vite/preload-helper')) return 'vendor';
              if (!id.includes('node_modules')) return undefined;
              if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (/node_modules\/(d3-|topojson)/.test(id)) return 'vendor-mapa';
              if (id.includes('lucide-react')) return 'vendor-iconos';
              // El PDF de la ficha KYC: se baja solo al tocar "Descargar PDF".
              // Si cayera en 'vendor' lo descargaría todo el que abre la app.
              if (/node_modules\/(jspdf|html-to-image|html2canvas|dompurify|canvg|fflate|fast-png|iobuffer|pako|stackblur-canvas|rgbcolor|raf|svg-pathdata|performance-now|core-js|@babel\/runtime)\//.test(id)) return 'vendor-pdf';
              return 'vendor';
            },
          },
        },
      },
    };
});
