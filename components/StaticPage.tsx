import React, { useEffect, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import { Logo } from './Logo';
import { useSystemConfig } from '../context/SystemConfigContext';
import { supabasePersonas } from '../lib/supabaseClient';
import { paginaLegal } from './legal/PaginasLegales';
import { paginaDeRuta } from '../lib/datosLegales';

interface StaticPageProps {
  pageKey: string;
  onBack: () => void;
  // Para que un enlace a otro documento (/terminos, /sarlaft…) cambie de
  // página sin recargar el sitio.
  onNavigate?: (pageKey: string) => void;
}

// Mapeo pageKey → key de app_settings donde el admin puede sobrescribir
// el contenido (Soporte → Documentación de páginas). Si hay texto guardado,
// gana sobre el contenido hardcodeado de abajo.
// Los documentos LEGALES (términos, datos personales, SARLAFT) ya no se
// sobrescriben desde ahí: cada empresa acepta una VERSIÓN al registrarse
// (lib/datosLegales.ts) y lo publicado tiene que ser exactamente esa versión.
// Un texto viejo guardado en ese panel (del producto anterior) tapaba el
// vigente sin que nadie lo notara.
const OVERRIDE_KEYS: Record<string, string> = {
  shipping:   'page_shipping_request',
  collection: 'page_collection_request',
};

// Render de texto plano con markdown-lite: líneas '## ' = subtítulo,
// líneas '- ' = viñetas, bloques separados por línea en blanco = párrafos.
function renderPlainText(txt: string): React.ReactNode {
  const blocks = txt.split(/\n{2,}/);
  return (
    <div className="space-y-6 text-slate-600">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (/^##\s+/.test(block.trim())) {
          return <h3 key={i} className="text-lg font-bold text-[#0C0E0D]">{block.trim().replace(/^##\s+/, '')}</h3>;
        }
        if (lines.every(l => /^-\s+/.test(l.trim()) || l.trim() === '')) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-2">
              {lines.filter(l => l.trim()).map((l, j) => <li key={j}>{l.trim().replace(/^-\s+/, '')}</li>)}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}{l}</React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export const StaticPage: React.FC<StaticPageProps> = ({ pageKey, onBack, onNavigate }) => {
  const { config } = useSystemConfig();
  const [override, setOverride] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pageKey]);

  // Cargar override editable desde app_settings (si el admin escribió algo)
  useEffect(() => {
    setOverride(null);
    const key = OVERRIDE_KEYS[pageKey];
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabasePersonas
          .from('app_settings').select('value').eq('key', key).maybeSingle();
        if (cancelled) return;
        const v = (data as any)?.value;
        const txt = typeof v === 'string' ? v : (v?.content ?? '');
        if (txt && txt.trim()) setOverride(txt);
      } catch { /* fallback al contenido hardcodeado */ }
    })();
    return () => { cancelled = true; };
  }, [pageKey]);

  // ── Analítica de visitas: registra la vista y el tiempo en página.
  // Inserta un evento al entrar y actualiza duration_seconds al salir
  // (visibilitychange/unmount). Best-effort — si la tabla no existe o la
  // RLS bloquea, la página funciona igual.
  useEffect(() => {
    let eventId: string | null = null;
    const start = Date.now();
    (async () => {
      try {
        const { data } = await supabasePersonas
          .from('site_events')
          .insert({ page: pageKey, referrer: document.referrer || null })
          .select('id')
          .single();
        eventId = (data as any)?.id ?? null;
      } catch { /* sin tracking */ }
    })();
    const flush = () => {
      if (!eventId) return;
      const secs = Math.round((Date.now() - start) / 1000);
      // fire-and-forget
      void supabasePersonas.from('site_events')
        .update({ duration_seconds: secs })
        .eq('id', eventId);
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      flush();
    };
  }, [pageKey]);

  const getContent = () => {
    // Los documentos legales y de confianza viven en legal/PaginasLegales:
    // la versión anterior describía el producto viejo (dólares digitales,
    // custodia), nombraba aliados y tenía cifras y un teléfono de ejemplo.
    const legal = paginaLegal(pageKey);
    if (legal) return legal;
    switch (pageKey) {
      case 'shipping':
        return {
          title: 'Solicitud de Envíos',
          icon: FileText,
          content: <p className="text-center py-10">Estamos trabajando en este contenido. Vuelve pronto.</p>
        };
      case 'collection':
        return {
          title: 'Solicitud de Cobro',
          icon: FileText,
          content: <p className="text-center py-10">Estamos trabajando en este contenido. Vuelve pronto.</p>
        };
      default:
        return {
          title: 'Página en Construcción',
          icon: FileText,
          content: <p className="text-center py-10">Estamos trabajando en este contenido. Vuelve pronto.</p>
        };
    }
  };

  const { title, content: hardcoded, icon: Icon } = getContent();
  // Si el admin guardó texto en Soporte → Documentación de páginas, gana.
  const content = override ? renderPlainText(override) : hardcoded;

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col">
      {/* Navbar Simple */}
      <nav className="bg-[#0C0E0D] h-20 sticky top-0 z-50 px-4 md:px-8 flex items-center justify-between shadow-md" style={{ backgroundColor: config.themeColor }}>
        <div className="scale-90 origin-left cursor-pointer" onClick={onBack}>
          <Logo variant="white" />
        </div>
        <button onClick={onBack} className="text-white flex items-center gap-2 hover:text-[#4ADE80] transition-colors font-medium text-sm">
          <ArrowLeft size={18} /> Volver al inicio
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-6 md:p-12">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden min-h-[600px]">
          {/* Header */}
          <div className="bg-[#F8FAFC] border-b border-slate-100 p-8 md:p-12 text-center">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mx-auto mb-6 text-[#0C0E0D]">
              <Icon size={32} />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#0C0E0D]">{title}</h1>
          </div>
          
          {/* Body */}
          <div className="p-8 md:p-12" onClick={(e) => {
            if (!onNavigate) return;
            const a = (e.target as HTMLElement).closest('a');
            const href = a?.getAttribute('href') ?? '';
            const destino = href.startsWith('/') ? paginaDeRuta(href) : null;
            if (destino) { e.preventDefault(); onNavigate(destino); }
          }}>
            {content}
          </div>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="bg-[#0C0E0D] text-white py-8 px-4 text-center text-sm text-slate-400" style={{ backgroundColor: config.themeColor }}>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mb-3">
          {[['terms', 'Términos'], ['privacy', 'Datos personales'], ['sagrilaft', 'SARLAFT'], ['complaints', 'Reclamaciones'], ['licenses', 'Marco legal']].map(([k, t]) => (
            <button key={k} onClick={() => onNavigate?.(k)} className="hover:text-white transition-colors">{t}</button>
          ))}
        </div>
        <p className="m-0 text-xs text-slate-500">© 2026 Lincoin. Lincoin no es un banco ni una entidad vigilada por la Superintendencia Financiera de Colombia.</p>
      </footer>
    </div>
  );
};