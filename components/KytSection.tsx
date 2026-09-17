// ══════════════════════════════════════════════════════════════════
//  KYT — consulta el riesgo de una dirección cripto antes de operar con ella.
//
//  Solo informa. No bloquea nada: es una herramienta de consulta, y meterla
//  en el camino de los retiros es una decisión aparte.
//
//  La regla que manda esta pantalla: SIN RESULTADO NO ES LIMPIA. Cuando el
//  proveedor no responde se dice eso mismo, con esas palabras, en vez de un
//  verde tranquilizador. En este proyecto ya nos costó plata confundir "no sé"
//  con "todo bien".
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Search, ShieldCheck, ShieldAlert, ShieldQuestion, ExternalLink, Copy, Check, Loader2 } from 'lucide-react';
import { llamarFuncion } from '../lib/edge';

const FONT = 'Archivo, system-ui, sans-serif';

const C = {
  bg: '#070808',
  card: '#0C0E0D',
  raised: '#121413',
  text: '#F4F4F2',
  sub: '#878E88',
  dim: 'rgba(244,244,242,0.45)',
  border: 'rgba(255,255,255,0.09)',
  border2: 'rgba(255,255,255,0.06)',
  green: '#4ADE80',
};

// Los mismos tonos que usa la lista de beneficiarios para el AML, para que
// "riesgo alto" se vea igual en toda la app y no haya que reaprenderlo.
const ROJO  = { b: 'rgba(248,113,113,0.32)', c: '#F87171' };
const AMBAR = { b: 'rgba(251,191,36,0.32)',  c: '#FBBF24' };
const GRIS  = { b: 'rgba(255,255,255,0.14)', c: '#878E88' };
const VERDE = { b: 'rgba(74,222,128,0.3)',   c: '#4ADE80' };

// Respaldo si el proveedor no contesta la lista de cadenas. No se hardcodea
// como fuente de verdad: la lista real se le pide a MistTrack al abrir, porque
// una lista escrita a mano se desactualiza en silencio.
const CADENAS_RESPALDO = [
  { v: 'ETH', t: 'Ethereum' }, { v: 'TRX', t: 'TRON' }, { v: 'BSC', t: 'BNB Smart Chain' },
  { v: 'BTC', t: 'Bitcoin' }, { v: 'MATIC', t: 'Polygon' }, { v: 'SOL', t: 'Solana' },
  { v: 'ARB', t: 'Arbitrum' }, { v: 'OP', t: 'Optimism' }, { v: 'BASE', t: 'Base' },
  { v: 'AVAX', t: 'Avalanche' }, { v: 'TON', t: 'Toncoin' },
];

type Resultado = {
  ok: boolean;
  error?: string;
  mensaje?: string;
  address?: string;
  coin?: string;
  categoria?: 'alto' | 'medio' | 'bajo' | 'sin_dato';
  puntaje?: number | null;
  nivel?: string | null;
  hallazgos?: any[];
  etiquetas?: any[];
  reporte?: string | null;
  estado?: string;
  delPadron?: boolean;
  consultadoAt?: string;
};

export const KytSection: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const [cadenas, setCadenas] = useState<{ v: string; t: string }[]>(CADENAS_RESPALDO);
  const [coin, setCoin] = useState('ETH');
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Resultado | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Las cadenas las manda el proveedor. Si la llamada falla se queda el
  // respaldo — que el selector no sirva sería peor que una lista algo vieja.
  useEffect(() => {
    let vivo = true;
    llamarFuncion('kyt', { action: 'cadenas' }, 20000)
      .then(r => {
        if (!vivo || !r?.ok || !Array.isArray(r.cadenas) || !r.cadenas.length) return;
        const norm = r.cadenas
          .map((x: any) => {
            if (typeof x === 'string') return { v: x.toUpperCase(), t: x };
            const v = String(x?.coin ?? x?.symbol ?? x?.value ?? '').toUpperCase();
            return v ? { v, t: String(x?.name ?? x?.label ?? v) } : null;
          })
          .filter(Boolean) as { v: string; t: string }[];
        if (norm.length) {
          setCadenas(norm);
          if (!norm.some(n => n.v === coin)) setCoin(norm[0].v);
        }
      })
      .catch(() => { /* se queda el respaldo */ });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const consultar = async () => {
    const a = dir.trim();
    if (a.length < 20) { setRes({ ok: false, error: 'corta', mensaje: 'Esa no parece una dirección válida.' }); return; }
    setBusy(true); setRes(null);
    try {
      const r = await llamarFuncion('kyt', { action: 'consultar', coin, address: a }, 40000);
      setRes(r ?? { ok: false, error: 'sin_respuesta', mensaje: 'No obtuvimos respuesta. Probá de nuevo.' });
    } catch {
      setRes({ ok: false, error: 'red', mensaje: 'No obtuvimos respuesta. Probá de nuevo.' });
    }
    setBusy(false);
  };

  const tono = (cat?: string) =>
    cat === 'alto' ? ROJO : cat === 'medio' ? AMBAR : cat === 'bajo' ? VERDE : GRIS;

  const titulo = (cat?: string) =>
    cat === 'alto' ? 'Dirección señalada' :
    cat === 'medio' ? 'Hallazgos de riesgo medio' :
    cat === 'bajo' ? 'Sin hallazgos relevantes' : 'Sin clasificar';

  const explica = (cat?: string) =>
    cat === 'alto' ? 'Esta dirección tiene hallazgos graves. Antes de recibir o enviar fondos a ella, revisá el reporte.'
    : cat === 'medio' ? 'Hay hallazgos que conviene mirar antes de operar con esta dirección.'
    : cat === 'bajo' ? 'La consulta no encontró hallazgos relevantes. No es una garantía: es el estado de hoy.'
    : 'El proveedor respondió sin una clasificación utilizable.';

  const copiar = () => {
    try {
      navigator.clipboard.writeText(res?.address ?? dir);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1600);
    } catch { /* sin portapapeles */ }
  };

  const lista = (arr: any[] | undefined): string[] =>
    (Array.isArray(arr) ? arr : [])
      .map(x => typeof x === 'string' ? x : (x?.label ?? x?.name ?? x?.type ?? x?.title ?? (() => { try { return JSON.stringify(x); } catch { return ''; } })()))
      .map(s => String(s).trim())
      .filter(Boolean)
      .slice(0, 40);

  return (
    <div style={{ fontFamily: FONT, color: C.text }} className="pt-6 space-y-5 animate-in fade-in duration-300">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-2 font-bold text-sm transition-colors hover:text-[#F4F4F2]" style={{ color: C.sub }}>
          <ArrowLeft size={18} /> Servicios
        </button>
      )}

      <div>
        <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.8px' }}>KYT</h1>
        <p style={{ color: C.sub, fontSize: 14, marginTop: 5, maxWidth: 620, lineHeight: 1.6 }}>
          Consultá una dirección antes de operar con ella. Te decimos si está señalada por
          actividad ilícita, con qué puntaje y por qué. <span style={{ color: C.dim }}>No bloquea
          nada — es información para que decidas.</span>
        </p>
      </div>

      {/* ── Formulario ── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18 }}>
        <div className="flex flex-col md:flex-row" style={{ gap: 10 }}>
          <div style={{ flex: '0 0 auto' }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>RED</label>
            <select
              value={coin}
              onChange={e => setCoin(e.target.value)}
              style={{
                fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.text,
                background: C.raised, border: `1px solid ${C.border}`, borderRadius: 11,
                padding: '11px 12px', minWidth: 170, outline: 'none',
              }}
            >
              {cadenas.map(c2 => <option key={c2.v} value={c2.v} style={{ background: C.raised }}>{c2.t}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>DIRECCIÓN</label>
            <input
              value={dir}
              onChange={e => setDir(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !busy) consultar(); }}
              placeholder="Pegá la dirección de la billetera"
              spellCheck={false}
              style={{
                width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13.5, color: C.text, background: C.raised,
                border: `1px solid ${C.border}`, borderRadius: 11, padding: '11px 12px', outline: 'none',
              }}
            />
          </div>
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end' }}>
            <button
              onClick={consultar}
              disabled={busy || dir.trim().length < 20}
              className="transition-opacity"
              style={{
                fontFamily: FONT, fontSize: 14, fontWeight: 800,
                background: C.green, color: '#0C0E0D',
                border: 'none', borderRadius: 11, padding: '12px 20px',
                cursor: busy || dir.trim().length < 20 ? 'default' : 'pointer',
                opacity: busy || dir.trim().length < 20 ? 0.45 : 1,
                display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
              }}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {busy ? 'Consultando…' : 'Consultar'}
            </button>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
          La dirección tiene que ser de la red que elegiste. La misma cadena de caracteres en
          otra red es otra dirección y otro riesgo.
        </p>
      </div>

      {/* ── Resultado ── */}
      {res && !res.ok && (
        <div style={{ background: C.card, border: `1px solid ${GRIS.b}`, borderRadius: 16, padding: 18 }}>
          <div className="flex items-start" style={{ gap: 12 }}>
            <ShieldQuestion size={20} style={{ color: GRIS.c, flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 15, fontWeight: 800 }}>
                {res.error === 'sin_credencial' ? 'El servicio no está habilitado todavía'
                  : res.error === 'tope_diario' ? 'Llegaste al tope de consultas de hoy'
                  : 'Sin resultado'}
              </p>
              <p style={{ fontSize: 13, color: C.sub, marginTop: 5, lineHeight: 1.6 }}>
                {res.mensaje ?? 'No pudimos obtener un resultado.'}
              </p>
              {res.error === 'sin_resultado' && (
                // Lo más importante de esta pantalla. La ausencia de respuesta
                // no es una respuesta favorable, y decirlo en voz alta evita
                // que alguien opere creyendo que ya verificó.
                <p style={{ fontSize: 12.5, color: ROJO.c, marginTop: 9, fontWeight: 600, lineHeight: 1.55 }}>
                  Que no haya resultado no significa que la dirección esté limpia. Significa que no
                  sabemos. Tratala como no verificada.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {res && res.ok && (
        <div style={{ background: C.card, border: `1px solid ${tono(res.categoria).b}`, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: 18, borderBottom: `1px solid ${C.border2}` }}>
            <div className="flex items-start justify-between flex-wrap" style={{ gap: 12 }}>
              <div className="flex items-start" style={{ gap: 12, minWidth: 0 }}>
                {res.categoria === 'bajo'
                  ? <ShieldCheck size={22} style={{ color: tono(res.categoria).c, flexShrink: 0, marginTop: 1 }} />
                  : <ShieldAlert size={22} style={{ color: tono(res.categoria).c, flexShrink: 0, marginTop: 1 }} />}
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' }}>{titulo(res.categoria)}</p>
                  <p style={{ fontSize: 13, color: C.sub, marginTop: 4, lineHeight: 1.6, maxWidth: 560 }}>{explica(res.categoria)}</p>
                </div>
              </div>
              {res.puntaje != null && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: 26, fontWeight: 800, color: tono(res.categoria).c, lineHeight: 1 }}>{res.puntaje}</p>
                  <p style={{ fontSize: 10.5, color: C.dim, fontWeight: 700, marginTop: 3 }}>PUNTAJE / 100</p>
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: 18, display: 'grid', gap: 14 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 5 }}>DIRECCIÓN CONSULTADA</p>
              <div className="flex items-center" style={{ gap: 8 }}>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, wordBreak: 'break-all' }}>
                  {res.address}
                </span>
                <button onClick={copiar} style={{ color: C.sub, flexShrink: 0 }} className="hover:text-[#F4F4F2] transition-colors">
                  {copiado ? <Check size={15} style={{ color: C.green }} /> : <Copy size={15} />}
                </button>
              </div>
              <p style={{ fontSize: 11.5, color: C.dim, marginTop: 5 }}>
                {res.coin}{res.nivel ? ` · ${res.nivel}` : ''}
              </p>
            </div>

            {lista(res.hallazgos).length > 0 && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 7 }}>HALLAZGOS</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {lista(res.hallazgos).map((h, i) => (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 600, color: tono(res.categoria).c,
                      background: 'rgba(255,255,255,0.04)', border: `1px solid ${tono(res.categoria).b}`,
                      borderRadius: 8, padding: '5px 9px',
                    }}>{h}</span>
                  ))}
                </div>
              </div>
            )}

            {lista(res.etiquetas).length > 0 && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 7 }}>ETIQUETAS DE LA DIRECCIÓN</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {lista(res.etiquetas).map((t, i) => (
                    <span key={i} style={{
                      fontSize: 12, fontWeight: 600, color: C.sub,
                      background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: '5px 9px',
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap" style={{ gap: 10, paddingTop: 4 }}>
              <p style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
                {res.delPadron
                  ? 'Resultado de una consulta reciente sobre esta misma dirección.'
                  : 'Consulta hecha ahora.'}
                {res.consultadoAt ? ` · ${new Date(res.consultadoAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
              </p>
              {res.reporte && (
                <a href={res.reporte} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center transition-colors hover:text-[#F4F4F2]"
                   style={{ gap: 6, fontSize: 12.5, fontWeight: 700, color: C.green }}>
                  Ver reporte completo <ExternalLink size={13} />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.6, maxWidth: 620 }}>
        El resultado refleja la información disponible hoy sobre la dirección y puede cambiar.
        Una dirección sin hallazgos no es una garantía, y esta consulta no reemplaza tus propios
        controles.
      </p>
    </div>
  );
};

export default KytSection;
