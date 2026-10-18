import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, RefreshCw, FileText, Check, X } from 'lucide-react';
import { pedirAdmin } from './adminApi';

// ─────────────────────────────────────────────
// Cumplimiento → Cupos por beneficiario.
//
// Normativa: en el mes, a una persona se le puede enviar hasta 80 M y a una
// empresa hasta 800 M (los generales se ajustan acá). Cuando un cliente
// necesita más para un beneficiario, lo pide desde Beneficiarios con el RUT
// (obligatorio) y, si quiere, cámara de comercio y origen de fondos. La
// solicitud llega aquí EN PROCESO y el oficial de cumplimiento decide el cupo
// nuevo, o la rechaza con un motivo que el cliente ve.
// ─────────────────────────────────────────────

const cop = (n: unknown) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const fecha = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? '—' : d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const conPuntos = (v: string) => v ? Number(v).toLocaleString('es-CO') : '';

const Solicitud: React.FC<{ s: any; onHecho: (m: string, ok: boolean) => void }> = ({ s, onHecho }) => {
  const sugerido = String(Math.round(Number(s.monto_solicitado) || 0) || '');
  const [cupo, setCupo] = useState(sugerido);
  const [nota, setNota] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);
  const resolver = async (aprobar: boolean) => {
    if (enCurso.current) return;
    if (aprobar && !(Number(cupo) > 0)) { onHecho('Escribe el cupo mensual que apruebas.', false); return; }
    if (!aprobar && !nota.trim()) { onHecho('Escribe el motivo del rechazo: es lo que verá el cliente.', false); return; }
    if (aprobar && !window.confirm(`¿Aprobar un cupo mensual de ${cop(cupo)} para ${s.beneficiario_nombre || 'este beneficiario'} de ${s.cliente}?`)) return;
    enCurso.current = true; setOcupado(true);
    const r = await pedirAdmin({ action: 'cupo_resolver', id: s.id, aprobar, cupo: aprobar ? cupo : undefined, nota: nota.trim() || undefined });
    enCurso.current = false; setOcupado(false);
    if (r?.ok) onHecho(aprobar ? `Cupo de ${cop(cupo)} aprobado para ${s.beneficiario_nombre || 'el beneficiario'}.` : 'Solicitud rechazada.', true);
    else onHecho(r?.permisoDenegado ? 'Solo Cumplimiento puede resolver solicitudes de cupo.' : (r?.error ?? 'No se pudo guardar.'), false);
  };
  const usado = s.usadoHoy ?? s.usado_mes;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.cliente}</p>
          <p className="font-bold text-slate-800 text-sm">{s.beneficiario_nombre || 'Beneficiario sin nombre'}</p>
          <p className="text-[11px] text-slate-500">{s.beneficiario_tipo === 'empresa' ? 'Empresa' : 'Persona'}{s.beneficiario_doc ? ` · ${s.beneficiario_doc}` : ''} · pedida el {fecha(s.created_at)}</p>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-300 text-amber-700">EN PROCESO</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Cupo actual</p><p className="font-bold text-slate-800">{cop(s.cupo_actual)}</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Enviado este mes</p><p className="font-bold text-slate-800">{cop(usado)}</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Pide</p><p className="font-bold text-slate-800">{s.monto_solicitado ? cop(s.monto_solicitado) : 'No dijo'}</p></div>
        <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[10px] text-slate-400 font-bold uppercase">Documentos</p><p className="font-bold text-slate-800">{(s.documentos ?? []).length}</p></div>
      </div>
      {s.motivo && <p className="text-xs text-slate-600 leading-relaxed"><b className="text-slate-700">Motivo:</b> {s.motivo}</p>}
      <div className="flex flex-wrap gap-2">
        {(s.documentos ?? []).map((d: any, i: number) => d.url
          ? <a key={i} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><FileText size={13} /> {d.nombreTipo}</a>
          : <span key={i} className="text-xs text-slate-400 px-3 py-1.5">{d.nombreTipo}: no se pudo abrir</span>)}
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Cupo mensual aprobado (COP)</label>
          <input inputMode="numeric" value={conPuntos(cupo)} onChange={e => setCupo(e.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="Ej. 200.000.000" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Nota (obligatoria si rechazas; la ve el cliente)</label>
          <input value={nota} onChange={e => setNota(e.target.value.slice(0, 1000))} placeholder="Ej. Falta el RUT actualizado" className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={ocupado} onClick={() => resolver(true)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg bg-[#16A34A] text-white disabled:opacity-50"><Check size={14} /> Aprobar cupo</button>
        <button disabled={ocupado} onClick={() => resolver(false)} className="flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"><X size={14} /> Rechazar</button>
      </div>
    </div>
  );
};

export const AdminCupos: React.FC = () => {
  const [datos, setDatos] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [persona, setPersona] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await pedirAdmin({ action: 'cupos_admin_get' });
    setCargando(false);
    if (r?.ok) { setDatos(r); setPersona(String(r.general?.persona ?? '')); setEmpresa(String(r.general?.empresa ?? '')); }
    else setAviso({ ok: false, texto: r?.permisoDenegado ? 'Solo Cumplimiento ve los cupos por beneficiario.' : (r?.error ?? 'No se pudieron leer los cupos.') });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  const hecho = (texto: string, ok: boolean) => { setAviso({ ok, texto }); if (ok) cargar(); };

  const guardarGeneral = async () => {
    setGuardando(true);
    const r = await pedirAdmin({ action: 'cupos_config_set', persona, empresa });
    setGuardando(false);
    hecho(r?.ok ? 'Cupos generales guardados.' : (r?.error ?? 'No se pudo guardar.'), !!r?.ok);
  };
  const quitar = async (a: any) => {
    if (!window.confirm(`¿Quitar el cupo aprobado de ${a.beneficiario_nombre || 'este beneficiario'}? Vuelve al cupo general.`)) return;
    const r = await pedirAdmin({ action: 'cupo_quitar', userId: a.user_id, clave: a.beneficiario_clave });
    hecho(r?.ok ? 'Cupo quitado: rige el general.' : (r?.error ?? 'No se pudo quitar.'), !!r?.ok);
  };

  const solicitudes: any[] = datos?.solicitudes ?? [];
  const enProceso = solicitudes.filter(s => s.estado === 'en_proceso');
  const resueltas = solicitudes.filter(s => s.estado !== 'en_proceso');
  const aprobados: any[] = datos?.aprobados ?? [];
  const cambiado = !!datos && (Number(persona) !== Number(datos.general?.persona) || Number(empresa) !== Number(datos.general?.empresa));

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Gauge size={20} /> Cupos mensuales por beneficiario</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Lo máximo que un cliente le puede enviar a UN beneficiario en el mes (Bre-B y ACH suman juntos). Para enviar más, el cliente pide un aumento desde Beneficiarios con el RUT (obligatorio), cámara de comercio y origen de fondos (opcionales). La solicitud queda en proceso hasta que cumplimiento decida el cupo.
          </p>
        </div>
        <button onClick={cargar} disabled={cargando} className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /></button>
      </div>

      {aviso && <div className={`rounded-lg px-3 py-2 text-xs ${aviso.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{aviso.texto}</div>}
      {datos?.falta && <div className="rounded-lg px-3 py-2 text-xs bg-amber-50 text-amber-800 border border-amber-200">Falta correr la migración 2026_zz10_cupos_beneficiario.sql para recibir solicitudes. Mientras tanto ya rigen los cupos generales.</div>}

      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Persona · al mes (COP)</label>
          <input inputMode="numeric" value={conPuntos(persona)} onChange={e => setPersona(e.target.value.replace(/\D/g, '').slice(0, 13))} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Empresa · al mes (COP)</label>
          <input inputMode="numeric" value={conPuntos(empresa)} onChange={e => setEmpresa(e.target.value.replace(/\D/g, '').slice(0, 13))} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm font-mono" />
        </div>
        <button onClick={guardarGeneral} disabled={!cambiado || guardando} className="py-2.5 rounded-lg text-sm font-bold text-white bg-[#0C0E0D] hover:bg-[#161A17] disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar cupos generales'}</button>
      </div>

      <div>
        <h4 className="font-bold text-slate-800 text-sm mb-2">Solicitudes en proceso {enProceso.length ? `(${enProceso.length})` : ''}</h4>
        {!enProceso.length ? <p className="text-xs text-slate-400">No hay solicitudes por revisar.</p> : (
          <div className="space-y-3">{enProceso.map(s => <Solicitud key={s.id} s={s} onHecho={hecho} />)}</div>
        )}
      </div>

      <div>
        <h4 className="font-bold text-slate-800 text-sm mb-2">Cupos aprobados vigentes</h4>
        {!aprobados.length ? <p className="text-xs text-slate-400">Todos los beneficiarios están con el cupo general.</p> : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left px-3 py-2">Cliente</th><th className="text-left px-3 py-2">Beneficiario</th><th className="text-right px-3 py-2">Cupo mensual</th><th className="text-left px-3 py-2">Aprobado</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aprobados.map(a => (
                  <tr key={`${a.user_id}|${a.beneficiario_clave}`}>
                    <td className="px-3 py-2 text-slate-700">{a.cliente}</td>
                    <td className="px-3 py-2"><p className="font-semibold text-slate-800">{a.beneficiario_nombre || '—'}</p><p className="text-[10px] text-slate-400">{a.beneficiario_tipo === 'empresa' ? 'Empresa' : 'Persona'}{a.beneficiario_doc ? ` · ${a.beneficiario_doc}` : ''}</p></td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800">{cop(a.cupo_mensual)}</td>
                    <td className="px-3 py-2 text-slate-500">{fecha(a.aprobado_at)}</td>
                    <td className="px-3 py-2 text-right"><button onClick={() => quitar(a)} className="text-[11px] font-bold text-slate-400 hover:text-red-600 underline">Quitar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resueltas.length > 0 && (
        <div>
          <h4 className="font-bold text-slate-800 text-sm mb-2">Revisadas</h4>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs min-w-[640px]">
              <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <tr><th className="text-left px-3 py-2">Cliente</th><th className="text-left px-3 py-2">Beneficiario</th><th className="text-left px-3 py-2">Decisión</th><th className="text-left px-3 py-2">Nota</th><th className="text-left px-3 py-2">Fecha</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resueltas.map(s => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-slate-700">{s.cliente}</td>
                    <td className="px-3 py-2 text-slate-700">{s.beneficiario_nombre || '—'}</td>
                    <td className="px-3 py-2">{s.estado === 'aprobada' ? <span className="font-bold text-[#16A34A]">Aprobada · {cop(s.cupo_aprobado)}</span> : <span className="font-bold text-red-600">Rechazada</span>}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-[260px] break-words">{s.nota_revision || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{fecha(s.revisado_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
