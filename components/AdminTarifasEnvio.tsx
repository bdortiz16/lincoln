import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { pedirAdmin } from './adminApi';

// ─────────────────────────────────────────────
// Tarifa por envío (Admin → Configuración).
//
// Un precio fijo para Bre-B y otro para ACH, igual en todas las cuentas:
//   el costo más alto de los proveedores del riel
//   + lo que cuesta la consulta AML del beneficiario (Sarblock)
//   + la utilidad que se quiera ganar.
// Antes cada cuenta cobraba lo suyo y ninguna cubría la consulta AML.
//
// El servidor recalcula la tarifa con estos datos (no confía en el total de
// la pantalla) y pide el código 2FA del dueño en cada cambio: es lo que se le
// cobra a todos los clientes. Apagada, cada cuenta cobra lo de antes.
// ─────────────────────────────────────────────

type Base = { costos: { breb: Record<string, number>; ach: Record<string, number> }; costoAml: number; utilidad: { breb: number; ach: number } };
const RIELES = [['breb', 'Bre-B'], ['ach', 'ACH']] as const;
const cop = (v: unknown) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
const num = (s: string) => Math.max(0, Math.round(Number(String(s).replace(/[^\d]/g, '')) || 0));

export const AdminTarifasEnvio: React.FC = () => {
    const [d, setD] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [base, setBase] = useState<Base | null>(null);
    const [activo, setActivo] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [aviso, setAviso] = useState<{ ok: boolean; t: string } | null>(null);

    const cargar = useCallback(async () => {
        setError(null);
        const r = await pedirAdmin({ action: 'tarifas_envio_get' });
        if (!r?.ok) { setError(r?.permisoDenegado ? 'Solo el dueño puede ver y cambiar la tarifa por envío.' : (r?.error ?? 'No se pudo leer la tarifa.')); return; }
        setD(r);
        // Lo guardado manda; sin nada guardado, la sugerencia (lo que se sabe
        // por contrato o lo más alto que cobró cada proveedor).
        const b: Base = r.tarifas?.base ?? r.sugerida;
        setBase({ ...b, costoAml: Number(r.costoAmlSarblock) || 0 });
        setActivo(!!r.tarifas?.activo);
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const calc = useMemo(() => {
        if (!base) return null;
        const r = (riel: 'breb' | 'ach') => {
            const masAlto = Math.max(0, ...Object.values(base.costos[riel] ?? {}).map(v => Number(v) || 0));
            return { masAlto, total: masAlto + (base.costoAml || 0) + (Number(base.utilidad[riel]) || 0) };
        };
        return { breb: r('breb'), ach: r('ach') };
    }, [base]);

    if (error) return (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Receipt size={20} /> Tarifa por envío</h3>
            <p className="text-xs text-red-600">{error}</p>
        </div>
    );
    if (!d || !base || !calc) return (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Receipt size={20} /> Tarifa por envío</h3>
            <p className="text-xs text-slate-400">Cargando…</p>
        </div>
    );

    const t = d.tarifas;
    const sinAml = !(d.costoAmlSarblock > 0);
    // La guardada se calculó con otro costo de consulta: hay que guardar de
    // nuevo para que los envíos lo incluyan.
    const amlCambio = !!t?.base && Number(t.base.costoAml) !== Number(d.costoAmlSarblock);
    const cambios = !t || !!t.activo !== activo || t.breb !== calc.breb.total || t.ach !== calc.ach.total
        || JSON.stringify(t.base?.costos) !== JSON.stringify(base.costos) || JSON.stringify(t.base?.utilidad) !== JSON.stringify(base.utilidad);
    const setCosto = (riel: 'breb' | 'ach', p: string, v: string) => setBase(b => b && ({ ...b, costos: { ...b.costos, [riel]: { ...b.costos[riel], [p]: num(v) } } }));
    const setUtil = (riel: 'breb' | 'ach', v: string) => setBase(b => b && ({ ...b, utilidad: { ...b.utilidad, [riel]: num(v) } }));

    const guardar = async () => {
        setGuardando(true); setAviso(null);
        const r = await pedirAdmin({ action: 'tarifas_envio_set', base, activo });
        setGuardando(false);
        if (!r?.ok) { setAviso({ ok: false, t: r?.error ?? 'No se pudo guardar.' }); return; }
        setAviso({ ok: true, t: r.tarifas.activo
            ? `Guardado. Desde ahora cada envío cobra ${cop(r.tarifas.breb)} por Bre-B y ${cop(r.tarifas.ach)} por ACH (puede tardar un minuto en verse en todos los envíos).`
            : 'Guardado. La tarifa fija está apagada: cada cuenta cobra lo de antes.' });
        cargar();
    };

    return (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2"><Receipt size={20} /> Tarifa por envío</h3>
            <p className="text-xs text-slate-500 mb-4">
                Un precio fijo para Bre-B y otro para ACH, igual en todas las cuentas. Cubre el costo más alto de los proveedores del riel y la consulta AML del beneficiario. El cliente ve la tarifa antes de confirmar cada envío.
            </p>

            {sinAml && (
                <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-[11.5px] text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>Falta lo que te cuesta cada consulta. Ponlo en <b>Cumplimiento → Sarblock → Ventas → Configuración</b> («Te cuesta cada consulta»): sin eso no se puede activar.</span>
                </div>
            )}
            {amlCambio && !sinAml && (
                <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-[11.5px] text-amber-800">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>El costo de la consulta cambió en Sarblock ({cop(t.base.costoAml)} → {cop(d.costoAmlSarblock)}). Los envíos siguen cobrando la tarifa guardada hasta que guardes de nuevo.</span>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {RIELES.map(([riel, nombre]) => (
                    <div key={riel} className="rounded-xl border border-slate-200 p-4">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">{nombre}</p>
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Lo que cobra cada proveedor por envío</p>
                        <div className="space-y-2">
                            {(d.proveedores?.[riel] ?? []).map(([p, etiqueta]: [string, string]) => {
                                const obs = d.observados?.[`${riel}.${p}`];
                                const conocido = d.conocidos?.[`${riel}.${p}`];
                                const esMax = (Number(base.costos[riel]?.[p]) || 0) === calc[riel].masAlto && calc[riel].masAlto > 0;
                                return (
                                    <div key={p} className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-xs font-semibold text-slate-700">{etiqueta}{esMax && <span className="ml-1.5 text-[9.5px] font-bold uppercase tracking-wider text-[#16A34A]">el más alto</span>}</p>
                                            <p className="text-[10.5px] text-slate-400">
                                                {obs ? `Cobró hasta ${cop(obs.max)} (promedio ${cop(obs.prom)}) en ${obs.n} envío${obs.n === 1 ? '' : 's'} de 60 días` : conocido != null ? `Según contrato: ${cop(conocido)}` : 'No lo informa: escríbelo'}
                                            </p>
                                        </div>
                                        <div className="relative shrink-0">
                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                                            <input inputMode="numeric" value={(Number(base.costos[riel]?.[p]) || 0).toLocaleString('es-CO')} onChange={e => setCosto(riel, p, e.target.value)}
                                                aria-label={`Costo ${etiqueta}`}
                                                className="w-28 pl-5 pr-2 py-1.5 rounded-lg border border-slate-200 text-sm font-bold text-right bg-white" />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-xs">
                            <div className="flex justify-between text-slate-500"><span>El más alto</span><span className="font-semibold text-slate-700 tabular-nums">{cop(calc[riel].masAlto)}</span></div>
                            <div className="flex justify-between text-slate-500"><span>+ Consulta AML (Sarblock)</span><span className={`font-semibold tabular-nums ${sinAml ? 'text-amber-700' : 'text-slate-700'}`}>{cop(base.costoAml)}</span></div>
                            <div className="flex items-center justify-between text-slate-500">
                                <span>+ Tu utilidad por envío</span>
                                <div className="relative">
                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
                                    <input inputMode="numeric" value={(Number(base.utilidad[riel]) || 0).toLocaleString('es-CO')} onChange={e => setUtil(riel, e.target.value)}
                                        aria-label={`Utilidad ${nombre}`}
                                        className="w-24 pl-5 pr-2 py-1 rounded-lg border border-slate-200 text-xs font-bold text-right bg-white" />
                                </div>
                            </div>
                            <div className="flex items-end justify-between pt-2 border-t border-slate-100">
                                <span className="font-bold text-slate-800">Tarifa {nombre}</span>
                                <span className="text-xl font-extrabold text-slate-900 tabular-nums">{cop(calc[riel].total)}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">{t?.activo ? 'Antes de la tarifa fija cada cuenta cobraba' : 'Hoy cobra cada cuenta'}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(d.porCuenta ?? {}).map(([k, v]) => <span key={k} className="text-[11.5px] text-slate-600">{k}: <b className="text-slate-800">{cop(v)}</b></span>)}
                </div>
            </div>

            <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 cursor-pointer">
                <span>
                    <span className="block text-sm font-bold text-slate-800">Cobrar esta tarifa en todos los envíos</span>
                    <span className="block text-[11px] text-slate-500">Apagada, cada cuenta cobra lo de arriba. Encendida, Bre-B {cop(calc.breb.total)} y ACH {cop(calc.ach.total)} en todas las cuentas.</span>
                </span>
                <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} className="w-5 h-5 accent-[#16A34A]" />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button onClick={guardar} disabled={guardando || !cambios || (activo && sinAml)}
                    className="flex items-center gap-1.5 bg-[#16A34A] hover:bg-[#15803D] disabled:opacity-40 text-white text-xs font-bold px-4 py-2.5 rounded-lg">
                    {guardando ? <RefreshCw size={14} className="animate-spin" /> : null} Guardar tarifa
                </button>
                <span className="text-[11px] text-slate-400">Pide tu código de la app en cada cambio.</span>
                {t?.activo && !cambios && <span className="text-[11px] text-[#16A34A] font-semibold">Vigente desde {new Date(t.at).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            {aviso && (
                <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[11.5px] border ${aviso.ok ? 'bg-green-50 border-green-200 text-[#16A34A]' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {aviso.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
                    <span>{aviso.t}</span>
                </div>
            )}
        </div>
    );
};
