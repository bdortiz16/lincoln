import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, FileText, Check, X, Search, Building2, User, ChevronDown, ChevronUp, Ban, SlidersHorizontal, ShieldCheck } from 'lucide-react';
import { pedirAutorizaciones } from './adminApi';

// ─────────────────────────────────────────────
// Cumplimiento → Operadores.
//
// Los operadores son los clientes de nuestros clientes: personas naturales o
// empresas que abren su cuenta en el portal de operadores y piden operar con
// una empresa registrada en Lincoin. La empresa los ACEPTA como sus clientes;
// aquí el oficial de cumplimiento revisa el expediente (foto, documento por
// las dos caras, RUT, cámara de comercio, declaración de renta y origen de
// fondos), les FIJA EL TOPE mensual y los aprueba, o los rechaza con un
// motivo que el operador ve. Después puede cambiarles el tope o suspenderlos.
// Todo lo escribe el servidor (función `autorizaciones`).
// ─────────────────────────────────────────────

const cop = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const fecha = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const conPuntos = (v: string) => v ? Number(v).toLocaleString('es-CO') : '';
const DOCS: Record<string, string> = { CC: 'Cédula', CE: 'Cédula de extranjería', PAS: 'Pasaporte', PPT: 'PPT', NIT: 'NIT' };

type Operador = {
  id: string; email: string; nombre: string; docType: string; docNumber: string; at: string; codigo?: string;
  tipoOperador?: 'persona' | 'empresa'; representante?: { nombre?: string; docType?: string; docNumber?: string };
  origenFondos?: { fuenteTexto?: string; detalle?: string } | null;
  estado?: string; aceptadaAt?: string; topeMensual?: number | null;
  empresa: { id: string; nombre: string };
};
type Modo = 'aprobar' | 'tope' | 'rechazar' | 'revocar';

const esEmpresa = (o: Operador) => o.tipoOperador === 'empresa' || o.docType === 'NIT';
const Tipo: React.FC<{ o: Operador }> = ({ o }) => (
  <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-slate-200 text-slate-500">
    {esEmpresa(o) ? <Building2 size={10} /> : <User size={10} />} {esEmpresa(o) ? 'Empresa' : 'Persona'}
  </span>
);

// ── Ventana para decidir: tope (aprobar / cambiar) o motivo (rechazar / suspender)
const Dialogo: React.FC<{ modo: Modo; o: Operador; onCerrar: () => void; onConfirmar: (d: { tope?: string; motivo?: string }) => Promise<void> }> = ({ modo, o, onCerrar, onConfirmar }) => {
  const [tope, setTope] = useState(o.topeMensual ? String(o.topeMensual) : '');
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const conTope = modo === 'aprobar' || modo === 'tope';
  const valido = conTope ? Number(tope) > 0 : motivo.trim().length >= 5;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !ocupado) onCerrar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [ocupado, onCerrar]);
  const confirmar = async () => {
    if (!valido || ocupado) return;
    setOcupado(true);
    try { await onConfirmar(conTope ? { tope } : { motivo: motivo.trim() }); } finally { setOcupado(false); }
  };
  const titulo = modo === 'aprobar' ? 'Aprobar operador y fijar tope' : modo === 'tope' ? 'Cambiar tope mensual' : modo === 'rechazar' ? 'Rechazar operador' : 'Suspender operador';
  const rojo = modo === 'rechazar' || modo === 'revocar';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => !ocupado && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={titulo} onClick={e => e.stopPropagation()} className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold text-slate-800">{titulo}</p>
            <p className="text-xs text-slate-500 mt-0.5">{o.nombre} · {DOCS[o.docType] ?? o.docType} {o.docNumber} · cliente de {o.empresa.nombre}</p>
          </div>
          <button onClick={onCerrar} disabled={ocupado} aria-label="Cerrar" className="p-1 text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        {conTope ? (
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Tope mensual (COP)</label>
            <input inputMode="numeric" value={conPuntos(tope)} onChange={e => setTope(e.target.value.replace(/\D/g, '').slice(0, 13))} autoFocus
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-lg font-bold font-mono" placeholder="0" />
            <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
              Lo máximo que el operador puede enviar a otros bancos (llaves Bre-B y cuentas) en el mes calendario.
              {modo === 'tope' && o.topeMensual ? ` Hoy: ${cop(o.topeMensual)}.` : ''}
            </p>
          </div>
        ) : (
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Motivo</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value.slice(0, 400))} rows={3} autoFocus
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder={modo === 'rechazar' ? 'Ej.: la cámara de comercio tiene más de 30 días.' : 'Ej.: alerta en la revisión periódica de antecedentes.'} />
            <p className="text-[11px] text-slate-500 mt-1">El operador lo ve en su portal y queda en el registro de auditoría.</p>
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onCerrar} disabled={ocupado} className="text-xs font-bold px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={confirmar} disabled={!valido || ocupado}
            className={`text-xs font-bold px-4 py-2 rounded-lg text-white disabled:opacity-50 ${rojo ? 'bg-red-600 hover:bg-red-700' : 'bg-[#16A34A] hover:bg-[#15803D]'}`}>
            {ocupado ? 'Guardando…' : modo === 'aprobar' ? `Aprobar con ${tope ? cop(tope) : 'tope'}` : modo === 'tope' ? 'Guardar tope' : modo === 'rechazar' ? 'Rechazar' : 'Suspender'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── El expediente: se pide al abrirlo (los enlaces firmados vencen en una hora)
const Expediente: React.FC<{ o: Operador }> = ({ o }) => {
  const [d, setD] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await pedirAutorizaciones({ action: 'admin_expediente', personaId: o.id, empresaId: o.empresa.id });
      if (!vivo) return;
      if (r?.ok) setD(r); else setError(r?.error ?? 'No se pudo abrir el expediente.');
    })();
    return () => { vivo = false; };
  }, [o.id, o.empresa.id]);
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!d) return <p className="text-xs text-slate-400">Abriendo expediente…</p>;
  const of = d.origenFondos ?? o.origenFondos;
  const nombreDoc = DOCS[esEmpresa(o) ? (o.representante?.docType ?? 'CC') : o.docType] ?? 'Documento';
  return (
    <div className="grid md:grid-cols-[200px_1fr] gap-4 rounded-lg bg-slate-50 border border-slate-200 p-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{esEmpresa(o) ? 'Representante con su documento' : 'Foto con su documento'}</p>
        {d.foto ? <a href={d.foto} target="_blank" rel="noreferrer"><img src={d.foto} alt={`Foto de ${o.nombre} con su documento`} className="w-full rounded-lg border border-slate-200" /></a>
          : <p className="text-xs text-slate-400">Sin foto.</p>}
      </div>
      <div className="space-y-3 min-w-0">
        <div className="text-xs text-slate-600 space-y-0.5">
          <p><b className="text-slate-700">ID Lincoin:</b> <span className="font-mono">{d.codigo}</span> · {d.email}</p>
          {o.representante?.nombre && <p><b className="text-slate-700">Representante legal:</b> {o.representante.nombre} · {o.representante.docType ?? 'CC'} {o.representante.docNumber ?? ''}</p>}
          <p><b className="text-slate-700">Pidió:</b> {fecha(o.at)}{o.aceptadaAt ? ` · aceptado por la empresa ${fecha(o.aceptadaAt)}` : ''}</p>
        </div>
        {d.sinExpediente ? (
          <p className="text-xs text-amber-700">Esta solicitud es de antes de que se pidieran los documentos: pídele que la envíe de nuevo desde su portal.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(d.documentos ?? []).map((x: any) => x.url
              ? <a key={x.tipo} href={x.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"><FileText size={13} /> {String(x.nombreTipo).replace(/^Documento/, nombreDoc)}</a>
              : <span key={x.tipo} className="text-xs text-slate-400 px-3 py-1.5">{x.nombreTipo}: no se pudo abrir</span>)}
          </div>
        )}
        {of && (
          <div className="text-xs">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Origen de los fondos</p>
            <p className="font-bold text-slate-800 mt-0.5">{of.fuenteTexto ?? '—'}</p>
            {of.detalle && <p className="text-slate-600">{of.detalle}</p>}
            <p className="text-[11px] text-slate-500 mt-0.5">Declaró que los recursos provienen de actividades lícitas.</p>
          </div>
        )}
        <p className="text-[10.5px] text-slate-400">Los enlaces vencen en una hora; vuelve a abrir el expediente para generarlos de nuevo.</p>
      </div>
    </div>
  );
};

const Pendiente: React.FC<{ o: Operador; onDecidir: (m: Modo, o: Operador) => void }> = ({ o, onDecidir }) => {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cliente de {o.empresa.nombre}</p>
          <p className="font-bold text-slate-800 text-sm flex items-center gap-2 flex-wrap">{o.nombre} <Tipo o={o} /></p>
          <p className="text-[11px] text-slate-500">{DOCS[o.docType] ?? o.docType} {o.docNumber} · {o.email}{o.codigo ? ` · ID ${o.codigo}` : ''}</p>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-300 text-amber-700">POR REVISAR</span>
      </div>
      <button onClick={() => setAbierto(v => !v)} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-900">
        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {abierto ? 'Ocultar expediente' : 'Ver expediente'}
      </button>
      {abierto && <Expediente o={o} />}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onDecidir('aprobar', o)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg bg-[#16A34A] text-white"><Check size={14} /> Aprobar y fijar tope</button>
        <button onClick={() => onDecidir('rechazar', o)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50"><X size={14} /> Rechazar</button>
      </div>
    </div>
  );
};

export const AdminOperadores: React.FC<{ onCambio?: () => void }> = ({ onCambio }) => {
  const [datos, setDatos] = useState<{ pendientes: Operador[]; enEmpresa: Operador[]; autorizados: Operador[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [busca, setBusca] = useState('');
  const [dialogo, setDialogo] = useState<{ modo: Modo; o: Operador } | null>(null);
  const [expAbierto, setExpAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await pedirAutorizaciones({ action: 'admin_operadores' });
    setCargando(false);
    if (r?.ok) setDatos({ pendientes: r.pendientes ?? [], enEmpresa: r.enEmpresa ?? [], autorizados: r.autorizados ?? [] });
    else setAviso({ ok: false, texto: r?.error ?? 'No se pudieron leer los operadores.' });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const decidir = async (modo: Modo, o: Operador, d: { tope?: string; motivo?: string }) => {
    const action = { aprobar: 'admin_aprobar', tope: 'admin_tope', rechazar: 'admin_rechazar', revocar: 'admin_revocar' }[modo];
    const r = await pedirAutorizaciones({ action, personaId: o.id, empresaId: o.empresa.id, topeMensual: d.tope, motivo: d.motivo });
    if (!r?.ok) { setAviso({ ok: false, texto: r?.error ?? 'No se pudo guardar.' }); return; }
    setDialogo(null);
    setAviso({ ok: true, texto: modo === 'aprobar' ? `${o.nombre} quedó aprobado con un tope de ${cop(d.tope)} al mes.` : modo === 'tope' ? `Tope de ${o.nombre}: ${cop(d.tope)} al mes.` : modo === 'rechazar' ? `${o.nombre} fue rechazado. Ve el motivo en su portal.` : `${o.nombre} quedó suspendido.` });
    await cargar();
    onCambio?.();
  };

  const q = busca.trim().toLowerCase();
  const filtra = (l: Operador[]) => !q ? l : l.filter(o => `${o.nombre} ${o.docNumber} ${o.email} ${o.codigo ?? ''} ${o.empresa.nombre} ${o.representante?.nombre ?? ''}`.toLowerCase().includes(q));
  const pendientes = filtra(datos?.pendientes ?? []);
  const enEmpresa = filtra(datos?.enEmpresa ?? []);
  const autorizados = filtra(datos?.autorizados ?? []);

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><ShieldCheck size={20} /> Operadores</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Los clientes de nuestros clientes (personas o empresas). Su empresa los acepta; aquí se revisa el expediente, se fija el tope mensual y se aprueban o rechazan. Solo un operador aprobado puede recibir saldo de su empresa y enviar dinero.
          </p>
        </div>
        <button onClick={cargar} disabled={cargando} aria-label="Actualizar" className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /></button>
      </div>

      {aviso && <div className={`rounded-lg px-3 py-2 text-xs ${aviso.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{aviso.texto}</div>}

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nombre, documento, ID o empresa" className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm" />
      </div>

      <div>
        <h4 className="font-bold text-slate-800 text-sm mb-2">Por revisar {pendientes.length ? `(${pendientes.length})` : ''}</h4>
        {!datos ? <p className="text-xs text-slate-400">{cargando ? 'Consultando…' : ''}</p>
          : !pendientes.length ? <p className="text-xs text-slate-400">No hay operadores aceptados por su empresa esperando revisión.</p>
          : <div className="space-y-3">{pendientes.map(o => <Pendiente key={`${o.empresa.id}|${o.id}`} o={o} onDecidir={(modo, x) => setDialogo({ modo, o: x })} />)}</div>}
      </div>

      <div>
        <h4 className="font-bold text-slate-800 text-sm mb-2">Aprobados {autorizados.length ? `(${autorizados.length})` : ''}</h4>
        {!autorizados.length ? <p className="text-xs text-slate-400">Todavía no hay operadores aprobados.</p> : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[760px]">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left px-3 py-2">Operador</th><th className="text-left px-3 py-2">Cliente de</th><th className="text-right px-3 py-2">Tope mensual</th><th className="text-left px-3 py-2">Aprobado</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {autorizados.map(o => {
                  const k = `${o.empresa.id}|${o.id}`;
                  return (
                    <React.Fragment key={k}>
                      <tr>
                        <td className="px-3 py-2"><p className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">{o.nombre} <Tipo o={o} /></p><p className="text-[10px] text-slate-400">{DOCS[o.docType] ?? o.docType} {o.docNumber}{o.codigo ? ` · ID ${o.codigo}` : ''}</p></td>
                        <td className="px-3 py-2 text-slate-700">{o.empresa.nombre}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-800">{o.topeMensual ? cop(o.topeMensual) : 'Sin tope'}</td>
                        <td className="px-3 py-2 text-slate-500">{fecha(o.at)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setExpAbierto(expAbierto === k ? null : k)} className="text-[11px] font-bold text-slate-600 hover:text-slate-900 underline mr-3">Expediente</button>
                          <button onClick={() => setDialogo({ modo: 'tope', o })} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 mr-3"><SlidersHorizontal size={11} /> Tope</button>
                          <button onClick={() => setDialogo({ modo: 'revocar', o })} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-red-600"><Ban size={11} /> Suspender</button>
                        </td>
                      </tr>
                      {expAbierto === k && <tr><td colSpan={5} className="px-3 py-3"><Expediente o={o} /></td></tr>}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {enEmpresa.length > 0 && (
        <div>
          <h4 className="font-bold text-slate-800 text-sm mb-1">Esperando a su empresa ({enEmpresa.length})</h4>
          <p className="text-[11px] text-slate-500 mb-2">Ya enviaron su solicitud; pasan a "Por revisar" cuando su empresa los acepte.</p>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[600px]">
              <tbody className="divide-y divide-slate-100">
                {enEmpresa.map(o => (
                  <tr key={`${o.empresa.id}|${o.id}`}>
                    <td className="px-3 py-2"><p className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">{o.nombre} <Tipo o={o} /></p><p className="text-[10px] text-slate-400">{DOCS[o.docType] ?? o.docType} {o.docNumber}</p></td>
                    <td className="px-3 py-2 text-slate-700">{o.empresa.nombre}</td>
                    <td className="px-3 py-2 text-slate-500">pidió el {fecha(o.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialogo && <Dialogo modo={dialogo.modo} o={dialogo.o} onCerrar={() => setDialogo(null)} onConfirmar={d => decidir(dialogo.modo, dialogo.o, d)} />}
    </div>
  );
};
