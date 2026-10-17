import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
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
        // esa variable en Vercel, la llave quedaría publicada en el JS que
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
              if (!id.includes('node_modules')) return undefined;
              if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
              if (id.includes('@supabase')) return 'vendor-supabase';
              if (/node_modules\/(d3-|topojson)/.test(id)) return 'vendor-mapa';
              if (id.includes('lucide-react')) return 'vendor-iconos';
              return 'vendor';
            },
          },
        },
      },
    };
});
