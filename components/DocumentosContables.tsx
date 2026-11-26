// ══════════════════════════════════════════════════════════════════
//  Documentos contables de la empresa
//
//  RUT, Cámara de Comercio, declaraciones y estados financieros. Los anexa
//  el contador aprobado desde su portal (la ficha de la empresa, junto a
//  "Actualizar") y la empresa los descarga en Mi perfil. Los guarda la
//  función `contador` en un bucket privado: cada descarga es un enlace
//  firmado que vence en minutos, nunca una URL pública.
//
//  modo 'contador' → lista, anexa y retira (con empresaId).
//  modo 'empresa'  → lista y descarga (sin empresaId: la del que llama).
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';
import { ConfirmarModal } from './ConfirmarModal';

const FONT = 'Archivo, system-ui, sans-serif';
const C = {
  tarjeta: '#0C0E0D', elevado: '#121413', borde: 'rgba(255,255,255,0.08)',
  text: '#F4F4F2', sub: '#878E88', tenue: '#6b716c', verde: '#4ADE80', rojo: '#F87171',
};

// Lo mismo que acepta el servidor: el formato lo revisa él por el contenido.
const EXT_OK = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'xlsx', 'xls', 'docx'];
const MAX_MB = 8;
const ORDEN = ['rut', 'camara_comercio', 'declaracion', 'estados_financieros', 'otro'];
const TIPOS_BASE: Record<string, string> = {
  rut: 'RUT', camara_comercio: 'Cámara de Comercio', declaracion: 'Declaración',
  estados_financieros: 'Estados financieros', otro: 'Otro documento',
};
const AYUDA: Record<string, string> = {
  rut: 'Ej.: actualizado en octubre de 2026',
  camara_comercio: 'Ej.: expedido el 15 de octubre de 2026',
  declaracion: 'Ej.: Renta 2025 · IVA bimestre 5 de 2026',
  estados_financieros: 'Ej.: Cierre 2025',
  otro: 'Qué documento es (obligatorio)',
};

type Doc = { id: string; tipo: string; descripcion: string; nombre: string; mime: string; size: number; subidoPor: { id: string; nombre: string }; at: string };

const leerBase64 = (f: File): Promise<string> => new Promise((ok, mal) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result ?? ''));
  r.onerror = () => mal(new Error('No se pudo leer el archivo'));
  r.readAsDataURL(f);
});
const peso = (b: number) => b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const fecha = (iso: string) => { try { return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }); } catch { return ''; } };

export const DocumentosContables: React.FC<{ modo: 'contador' | 'empresa'; empresaId?: string }> = ({ modo, empresaId }) => {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [tipos, setTipos] = useState<Record<string, string>>(TIPOS_BASE);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [descargando, setDescargando] = useState<string | null>(null);
  // Formulario para anexar (solo el contador).
  const [tipo, setTipo] = useState('rut');
  const [descripcion, setDescripcion] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [retirar, setRetirar] = useState<Doc | null>(null);
  const [retirando, setRetirando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const esContador = modo === 'contador';
  const destino = esContador && empresaId ? { empresaId } : {};

  const cargar = async () => {
    setError(null);
    const r = await llamarFuncion('contador', { action: 'docs_listar', ...destino }, 30000);
    if (!r?.ok) { setError(r?.error ?? 'No se pudieron leer los documentos.'); setDocs(d => d ?? []); return; }
    setDocs(r.documentos ?? []);
    if (r.tipos) setTipos({ ...TIPOS_BASE, ...r.tipos });
  };
  useEffect(() => { setDocs(null); cargar(); }, [empresaId, modo]);

  const elegirArchivo = (f: File | null) => {
    setError(null); setAviso(null);
    if (!f) { setArchivo(null); return; }
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    if (!EXT_OK.includes(ext)) { setError('Tiene que ser un PDF, una foto (JPG, PNG, WEBP), un Excel o un Word.'); setArchivo(null); if (inputRef.current) inputRef.current.value = ''; return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(`Puede pesar hasta ${MAX_MB} MB. Este pesa ${peso(f.size)}.`); setArchivo(null); if (inputRef.current) inputRef.current.value = ''; return; }
    setArchivo(f);
  };

  const anexar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivo || subiendo) return;
    if (tipo === 'otro' && !descripcion.trim()) { setError('Escribe qué documento es.'); return; }
    setSubiendo(true); setError(null); setAviso(null);
    let base64 = '';
    try { base64 = await leerBase64(archivo); } catch { setSubiendo(false); setError('No se pudo leer el archivo.'); return; }
    const r = await llamarFuncion('contador', { action: 'docs_subir', ...destino, tipo, descripcion: descripcion.trim(), nombre: archivo.name, base64 }, 120000);
    setSubiendo(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo anexar el documento.'); return; }
    setDocs(d => [r.documento, ...(d ?? [])]);
    setAviso(`${tipos[tipo] ?? 'Documento'} anexado. La empresa recibió un aviso y ya lo puede descargar en su perfil.`);
    setArchivo(null); setDescripcion('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const descargar = async (d: Doc) => {
    if (descargando) return;
    setDescargando(d.id); setError(null);
    const r = await llamarFuncion('contador', { action: 'docs_url', ...destino, id: d.id }, 30000);
    setDescargando(null);
    if (!r?.ok || !r.url) { setError(r?.error ?? 'No se pudo descargar.'); return; }
    // El enlace trae "descargar como": el navegador baja el archivo y la
    // página se queda donde está.
    const a = document.createElement('a');
    a.href = r.url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  };

  const confirmarRetiro = async () => {
    if (!retirar || retirando) return;
    setRetirando(true);
    const r = await llamarFuncion('contador', { action: 'docs_borrar', ...destino, id: retirar.id }, 30000);
    setRetirando(false);
    if (!r?.ok) { setError(r?.error ?? 'No se pudo retirar el documento.'); setRetirar(null); return; }
    setDocs(ds => (ds ?? []).filter(x => x.id !== retirar.id));
    setAviso(`${tipos[retirar.tipo] ?? 'Documento'} retirado.`);
    setRetirar(null);
  };

  const grupos = ORDEN.map(t => [t, (docs ?? []).filter(d => d.tipo === t)] as [string, Doc[]]).filter(([, ds]) => ds.length > 0);
  const etiqueta: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', color: C.sub, margin: 0 };
  const campo: React.CSSProperties = { fontFamily: FONT, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, color: C.text, borderRadius: 10, padding: '10px 12px', fontSize: 14, outline: 'none', minWidth: 0 };

  return (
    <div style={{ fontFamily: FONT, color: C.text }}>
      <div className="flex items-center" style={{ gap: 8 }}>
        <Paperclip size={15} color={C.verde} />
        <p style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', margin: 0 }}>Documentos contables</p>
      </div>
      <p style={{ fontSize: 12.5, color: C.sub, margin: '4px 0 0', lineHeight: 1.5 }}>
        {esContador
          ? 'RUT, Cámara de Comercio, declaraciones y estados financieros. Lo que anexes aquí, la empresa lo descarga en Mi perfil → Documentos contables.'
          : 'Los anexa tu contador: RUT, Cámara de Comercio, declaraciones y estados financieros. Cuando suba uno nuevo te llega un aviso.'}
      </p>

      {esContador && (
        <form onSubmit={anexar} style={{ background: C.elevado, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14, marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <select aria-label="Qué documento es" value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...campo, cursor: 'pointer' }}>
              {ORDEN.map(t => <option key={t} value={t} style={{ background: C.tarjeta }}>{tipos[t] ?? t}</option>)}
            </select>
            <input aria-label="Descripción o periodo" value={descripcion} onChange={e => setDescripcion(e.target.value.slice(0, 120))} placeholder={AYUDA[tipo]} style={campo} />
          </div>
          <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
            <label style={{ ...campo, flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: archivo ? C.text : C.sub }}>
              <FileText size={15} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {archivo ? `${archivo.name} · ${peso(archivo.size)}` : `Elegir archivo (PDF, foto, Excel o Word · hasta ${MAX_MB} MB)`}
              </span>
              <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx" onChange={e => elegirArchivo(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
            </label>
            <button type="submit" disabled={!archivo || subiendo} className="lincoin-btn-white"
              style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13.5, padding: '11px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: !archivo || subiendo ? 0.6 : 1 }}>
              <Upload size={14} /> {subiendo ? 'Anexando…' : 'Anexar'}
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" style={{ fontSize: 12.5, color: C.rojo, margin: '10px 0 0', lineHeight: 1.5 }}>{error}</p>}
      {aviso && <p style={{ fontSize: 12.5, color: C.verde, margin: '10px 0 0', lineHeight: 1.5 }}>{aviso}</p>}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {docs == null && <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>Cargando…</p>}
        {docs != null && docs.length === 0 && (
          <p style={{ fontSize: 13, color: C.tenue, margin: 0, lineHeight: 1.5 }}>
            {esContador ? 'Todavía no hay documentos anexados.' : 'Tu contador todavía no ha anexado documentos.'}
          </p>
        )}
        {grupos.map(([t, ds]) => (
          <div key={t}>
            <p style={{ ...etiqueta, marginBottom: 6 }}>{String(tipos[t] ?? t).toUpperCase()}</p>
            <div style={{ border: `1px solid ${C.borde}`, borderRadius: 12, overflow: 'hidden' }}>
              {ds.map((d, i) => (
                <div key={d.id} className="flex items-center" style={{ gap: 10, padding: '10px 12px', borderTop: i ? `1px solid ${C.borde}` : 'none', background: C.tarjeta }}>
                  <FileText size={16} color={C.sub} style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.descripcion || d.nombre}</p>
                    <p style={{ fontSize: 11.5, color: C.sub, margin: '2px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[d.descripcion ? d.nombre : '', peso(d.size), fecha(d.at), d.subidoPor?.nombre ? `por ${d.subidoPor.nombre}` : ''].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button onClick={() => descargar(d)} disabled={descargando === d.id} title="Descargar" aria-label={`Descargar ${d.nombre}`}
                    style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.text, background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borde}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, opacity: descargando === d.id ? 0.6 : 1 }}>
                    <Download size={13} /> <span className="hidden sm:inline">{descargando === d.id ? 'Preparando…' : 'Descargar'}</span>
                  </button>
                  {esContador && (
                    <button onClick={() => setRetirar(d)} title="Retirar" aria-label={`Retirar ${d.nombre}`}
                      style={{ color: C.sub, background: 'transparent', border: `1px solid ${C.borde}`, borderRadius: 8, padding: 7, cursor: 'pointer', display: 'inline-flex', flexShrink: 0 }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {retirar && (
        <ConfirmarModal
          titulo={`¿Retirar ${tipos[retirar.tipo] ?? 'el documento'}?`}
          texto={`«${retirar.descripcion || retirar.nombre}» deja de estar en la cuenta de la empresa y se borra el archivo. Si fue un error, lo puedes volver a anexar.`}
          confirmar="Retirar"
          peligro
          ocupado={retirando}
          onConfirmar={confirmarRetiro}
          onCancelar={() => { if (!retirando) setRetirar(null); }}
        />
      )}
    </div>
  );
};
