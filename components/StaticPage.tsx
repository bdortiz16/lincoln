import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck, FileText, Users, Mail, Phone, Lock } from 'lucide-react';
import { Logo } from './Logo';
import { useSystemConfig } from '../context/SystemConfigContext';
import { supabasePersonas } from '../lib/supabaseClient';

interface StaticPageProps {
  pageKey: string;
  onBack: () => void;
}

// Mapeo pageKey → key de app_settings donde el admin puede sobrescribir
// el contenido (Soporte → Documentación de páginas). Si hay texto guardado,
// gana sobre el contenido hardcodeado de abajo.
const OVERRIDE_KEYS: Record<string, string> = {
  privacy:    'page_data_treatment',
  terms:      'page_terms',
  sagrilaft:  'page_sagrilaft',
  contact:    'page_contact',
  support:    'page_contact',
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
          return <h3 key={i} className="text-lg font-bold text-[#0F172A]">{block.trim().replace(/^##\s+/, '')}</h3>;
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

export const StaticPage: React.FC<StaticPageProps> = ({ pageKey, onBack }) => {
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
    switch (pageKey) {
      case 'privacy':
        return {
          title: 'Política de Tratamiento de Datos',
          icon: Lock,
          content: (
            <div className="space-y-6 text-slate-600">
              <p>En LINCOIN, nos tomamos muy en serio la privacidad de sus datos. Esta política describe cómo recopilamos, usamos y protegemos su información personal.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">1. Recolección de Información</h3>
              <p>Recopilamos información cuando usted se registra en nuestro sitio, realiza una transacción o completa un formulario. La información recopilada incluye su nombre, dirección de correo electrónico, número de teléfono y documentos de identificación para procesos KYC.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">2. Uso de la Información</h3>
              <p>Cualquiera de la información que recopilamos de usted puede usarse para:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>Personalizar su experiencia.</li>
                <li>Mejorar nuestro sitio web y servicio al cliente.</li>
                <li>Procesar transacciones de manera segura.</li>
                <li>Enviar correos electrónicos periódicos con actualizaciones de su cuenta.</li>
              </ul>
              <h3 className="text-lg font-bold text-[#0F172A]">3. Protección de Datos</h3>
              <p>Implementamos una variedad de medidas de seguridad para mantener la seguridad de su información personal. Utilizamos encriptación de grado bancario para proteger la información confidencial transmitida en línea.</p>
            </div>
          )
        };
      case 'terms':
        return {
          title: 'Términos y Condiciones',
          icon: FileText,
          content: (
            <div className="space-y-6 text-slate-600">
              <p>Bienvenido a LINCOIN. Al acceder a nuestro sitio web y utilizar nuestros servicios, usted acepta cumplir con los siguientes términos y condiciones.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">1. Aceptación de los Términos</h3>
              <p>Al registrarse y utilizar los servicios de LINCOIN, usted confirma que tiene la mayoría de edad legal en su jurisdicción y que tiene la capacidad legal para celebrar contratos vinculantes.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">2. Servicios de Pago</h3>
              <p>LINCOIN proporciona servicios de procesamiento de pagos y transferencia de dinero. Nos reservamos el derecho de rechazar cualquier transacción que consideremos sospechosa o que viole nuestras políticas de cumplimiento.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">3. Tarifas y Comisiones</h3>
              <p>Las tarifas por nuestros servicios se muestran claramente antes de confirmar cualquier transacción. Al proceder, usted acepta pagar dichas tarifas.</p>
            </div>
          )
        };
      case 'sagrilaft':
        return {
          title: 'Política SAGRILAFT',
          icon: ShieldCheck,
          content: (
            <div className="space-y-6 text-slate-600">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6">
                <p className="text-sm font-bold text-[#2DD4BF]">Sistema de Autocontrol y Gestión del Riesgo Integral de Lavado de Activos y Financiación del Terrorismo.</p>
              </div>
              <p>LINCOIN está comprometido con la lucha contra el lavado de activos y la financiación del terrorismo. Hemos implementado estrictos controles y procedimientos internos.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">1. Debida Diligencia</h3>
              <p>Realizamos procesos de conocimiento del cliente (KYC) para todos nuestros usuarios, verificando su identidad y el origen de sus fondos.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">2. Monitoreo Transaccional</h3>
              <p>Utilizamos sistemas avanzados para monitorear las transacciones en tiempo real y detectar patrones inusuales o sospechosos.</p>
              <h3 className="text-lg font-bold text-[#0F172A]">3. Reportes</h3>
              <p>Colaboramos con las autoridades competentes (UIAF) reportando cualquier actividad sospechosa conforme a la ley.</p>
            </div>
          )
        };
      case 'about':
        return {
          title: 'Acerca de Nosotros',
          icon: Users,
          content: (
            <div className="space-y-6 text-slate-600">
              <p className="text-lg leading-relaxed">Somos <span className="font-bold text-[#0F172A]">LINCOIN</span>, tu socio financiero en América Latina.</p>
              <p>Nacimos con la misión de eliminar las fronteras financieras para empresas y personas en LATAM. Creemos que mover dinero internacionalmente debería ser tan fácil, rápido y económico como enviar un mensaje de texto.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-8">
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <h4 className="font-bold text-[#0F172A] mb-2">+50,000</h4>
                  <p className="text-sm">Usuarios Felices</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <h4 className="font-bold text-[#0F172A] mb-2">$500M+</h4>
                  <p className="text-sm">Transaccionados</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <h4 className="font-bold text-[#0F172A] mb-2">7 Países</h4>
                  <p className="text-sm">Cobertura Local</p>
                </div>
              </div>
              <p>Nuestro equipo está compuesto por expertos en tecnología y finanzas apasionados por crear la infraestructura de pagos del futuro.</p>
            </div>
          )
        };
      case 'support':
      case 'contact':
        return {
          title: 'Centro de Ayuda y Contacto',
          icon: Mail,
          content: (
            <div className="space-y-8 text-slate-600">
              <p>¿Tienes alguna duda o inconveniente? Nuestro equipo de soporte está disponible 24/7 para ayudarte.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-slate-200 p-6 rounded-xl hover:shadow-md transition-shadow">
                  <Mail className="text-[#0F172A] mb-4" size={32} />
                  <h3 className="font-bold text-slate-800 mb-2">Correo Electrónico</h3>
                  <p className="text-sm text-slate-500 mb-4">Para consultas generales y soporte.</p>
                  <a href="mailto:soporte@cuypay.com" className="text-[#0F172A] font-bold hover:underline">soporte@cuypay.com</a>
                </div>
                
                <div className="border border-slate-200 p-6 rounded-xl hover:shadow-md transition-shadow">
                  <Phone className="text-[#0F172A] mb-4" size={32} />
                  <h3 className="font-bold text-slate-800 mb-2">Línea de Atención</h3>
                  <p className="text-sm text-slate-500 mb-4">Lunes a Viernes, 8am - 6pm EST.</p>
                  <a href="tel:+15551234567" className="text-[#0F172A] font-bold hover:underline">+1 (555) 123-4567</a>
                </div>
              </div>

              <div className="bg-[#F8FAFC] p-6 rounded-xl">
                <h3 className="font-bold text-slate-800 mb-4">Formulario de Contacto Rápido</h3>
                <div className="space-y-4">
                  <input type="text" placeholder="Tu Nombre" className="w-full p-3 rounded-lg border border-slate-300 focus:border-[#0F172A] outline-none" />
                  <input type="email" placeholder="Tu Email" className="w-full p-3 rounded-lg border border-slate-300 focus:border-[#0F172A] outline-none" />
                  <textarea placeholder="¿En qué podemos ayudarte?" className="w-full p-3 rounded-lg border border-slate-300 focus:border-[#0F172A] outline-none h-32"></textarea>
                  <button className="bg-[#0F172A] px-6 py-3 rounded-lg font-bold hover:bg-[#152e52] transition-colors w-full md:w-auto">Enviar Mensaje</button>
                </div>
              </div>
            </div>
          )
        };
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
      <nav className="bg-[#0F172A] h-20 sticky top-0 z-50 px-4 md:px-8 flex items-center justify-between shadow-md" style={{ backgroundColor: config.themeColor }}>
        <div className="scale-90 origin-left cursor-pointer" onClick={onBack}>
          <Logo variant="white" />
        </div>
        <button onClick={onBack} className="text-white flex items-center gap-2 hover:text-[#2DD4BF] transition-colors font-medium text-sm">
          <ArrowLeft size={18} /> Volver al inicio
        </button>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-6 md:p-12">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden min-h-[600px]">
          {/* Header */}
          <div className="bg-[#F8FAFC] border-b border-slate-100 p-8 md:p-12 text-center">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mx-auto mb-6 text-[#0F172A]">
              <Icon size={32} />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#0F172A]">{title}</h1>
          </div>
          
          {/* Body */}
          <div className="p-8 md:p-12">
            {content}
          </div>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="bg-[#0F172A] text-white py-8 text-center text-sm text-slate-400" style={{ backgroundColor: config.themeColor }}>
        © Copyright LINCOIN, All rights reserved.
      </footer>
    </div>
  );
};