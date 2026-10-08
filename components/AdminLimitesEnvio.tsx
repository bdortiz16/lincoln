import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, Save, Search, Trash2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { llamarFuncion } from '../lib/edge';

// ─────────────────────────────────────────────
// Límites por envío ACH — Configuración del admin.
//
// Tres topes generales y excepciones por cliente. Los aplica el SERVIDOR
// (mouv-proxy) al momento de cada envío; esta pantalla solo los guarda:
//   · Empresas y Personas: máximo por envío según el tipo de cuenta.
//   · Proveedor: lo que Finity acepta por transferencia. Es el techo de
//     todo — ni el general ni una excepción lo pueden pasar.
//   · Excepción por cliente: sube o baja el tope de UNA cuenta.
// ─────────────────────────────────────────────

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 11);
const conPuntos = (v: string) => (v ? Number(v).toLocaleString('es-CO') : '');
// "500.000.000" → "500 millones": un cero de más se ve a simple vista.
const enPalabras = (v: string | number | null | undefined): string => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1e9) return `${(n / 1e9).toLocaleString('es-CO', { maximumFractionDigits: 2 })} mil millones`;
    if (n >= 1e6) return `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 2 })} millones`;
    return `${n.toLocaleString('es-CO')} pesos`;
};

interface Excepcion { userId: string; achMax: number; nota: string | null; at: string | null; email: string | null; nombre: string | null; tipo: 'empresa' | 'persona' }

const CampoPesos: React.FC<{ label: string; hint: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({ label, hint, value, onChange, placeholder }) => (
    <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
        <div className="mt-1 flex items-center border border-slate-200 rounded-lg overflow-hidden focus-within:border-slate-400">
            <span className="px-2.5 text-xs text-slate-400">COP</span>
            <input inputMode="numeric" value={conPuntos(value)} onChange={e => onChange(soloDigitos(e.target.value))} placeholder={placeholder}
                className="w-full py-2 pr-3 text-sm font-mono outline-none" />
        </div>
        <p className="text-[11px] text-slate-400 mt-1">{value ? `= ${enPalabras(value)} · ` : ''}{hint}</p>
    </div>
);

export const AdminLimitesEnvio: React.FC = () => {
    const { getAllUsers } = useDatabase() as any;
    const [cargando, setCargando] = useState(true);
    const [empresa, setEmpresa] = useState('');
    const [persona, setPersona] = useState('');
    const [proveedor, setProveedor] = useState('');
    const [guardado, setGuardado] = useState<{ achEmpresa: number; achPersona: number; achProveedor: number | null } | null>(null);
    const [excepciones, setExcepciones] = useState<Excepcion[]>([]);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
    const [ocupado, setOcupado] = useState(false);

    // Excepción nueva
    const [q, setQ] = useState('');
    const [cliente, setCliente] = useState<any>(null);
    const [topeCliente, setTopeCliente] = useState('');
    const [nota, setNota] = useState('');

    const cargar = async () => {
        setCargando(true);
        const r = await llamarFuncion('admin-data', { action: 'limites_envio_get' }).catch(() => null);
        setCargando(false);
        if (!r?.ok) { setMsg({ ok: false, text: r?.error ?? 'No se pudieron leer los límites.' }); return; }
        const l = r.limites;
        setGuardado({ achEmpresa: l.achEmpresa, achPersona: l.achPersona, achProveedor: l.achProveedor ?? null });
        setEmpresa(String(l.achEmpresa ?? ''));
        setPersona(String(l.achPersona ?? ''));
        setProveedor(l.achProveedor ? String(l.achProveedor) : '');
        setExcepciones(Array.isArray(r.excepciones) ? r.excepciones : []);
    };
    useEffect(() => { cargar(); }, []);

    const cambiado = !!guardado && (Number(empresa) !== guardado.achEmpresa || Number(persona) !== guardado.achPersona || (Number(proveedor) || null) !== (guardado.achProveedor || null));

    const guardarGeneral = async () => {
        if (ocupado) return;
        const prov = Number(proveedor) || 0;
        if (!Number(empresa) || !Number(persona)) { setMsg({ ok: false, text: 'Pon el tope de empresas y el de personas.' }); return; }
        if (prov && (Number(empresa) > prov || Number(persona) > prov)) { setMsg({ ok: false, text: `Ningún tope puede pasar el del proveedor (${conPuntos(proveedor)} COP).` }); return; }
        setOcupado(true); setMsg(null);
        const r = await llamarFuncion('admin-data', { action: 'limites_envio_set', achEmpresa: empresa, achPersona: persona, achProveedor: proveedor || null }).catch(() => null);
        setOcupado(false);
        if (!r?.ok) { setMsg({ ok: false, text: r?.error ?? 'No se pudo guardar.' }); return; }
        setMsg({ ok: true, text: 'Límites guardados. Aplican desde el próximo envío.' });
        cargar();
    };

    const guardarExcepcion = async (userId: string, achMax: string | null, notaTxt = '') => {
        if (ocupado) return;
        const prov = Number(guardado?.achProveedor) || 0;
        if (achMax && prov && Number(achMax) > prov) { setMsg({ ok: false, text: `No puede pasar el tope del proveedor (${conPuntos(String(prov))} COP).` }); return; }
        setOcupado(true); setMsg(null);
        const r = await llamarFuncion('admin-data', { action: 'limite_cliente_set', userId, achMax, nota: notaTxt }).catch(() => null);
        setOcupado(false);
        if (!r?.ok) { setMsg({ ok: false, text: r?.error ?? 'No se pudo guardar.' }); return; }
        setMsg({ ok: true, text: achMax ? 'Excepción guardada para ese cliente.' : 'Excepción quitada: vuelve al tope general.' });
        setCliente(null); setTopeCliente(''); setNota(''); setQ('');
        cargar();
    };

    const usuarios: any[] = useMemo(() => (typeof getAllUsers === 'function' ? getAllUsers() : []).filter((u: any) => u.role !== 'admin'), [getAllUsers]);
    const resultados = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (s.length < 2) return [];
        return usuarios.filter((u: any) => [u.name, u.companyName, u.company_name, u.email, u.id].some((x: any) => String(x ?? '').toLowerCase().includes(s))).slice(0, 8);
    }, [q, usuarios]);
    const esEmpresa = (u: any) => u?.role === 'business';
    const generalDe = (u: any) => (esEmpresa(u) ? Number(empresa) : Number(persona));

    return (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-1">
                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Gauge size={20} /> Límites por envío ACH</h3>
                <button onClick={cargar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Recargar"><RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /></button>
            </div>
            <p className="text-xs text-slate-500 mb-5">Máximo que un cliente puede enviar por ACH en una sola operación. Lo aplica el servidor en cada envío. El tope del proveedor es el techo: ni el general ni una excepción lo pueden pasar.</p>

            {msg && (
                <div className={`mb-4 flex items-start gap-2 rounded-lg px-3 py-2.5 border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {msg.ok ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} className="shrink-0 mt-0.5" />}
                    <p className="text-xs">{msg.text}</p>
                </div>
            )}

            {cargando && !guardado ? <p className="text-sm text-slate-400">Cargando…</p> : (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <CampoPesos label="Empresas" hint="por envío" value={empresa} onChange={setEmpresa} />
                        <CampoPesos label="Personas" hint="por envío" value={persona} onChange={setPersona} />
                        <CampoPesos label="Tope del proveedor (Finity)" hint="opcional · lo que Finity acepta por transferencia" value={proveedor} onChange={setProveedor} placeholder="Sin definir" />
                    </div>
                    <div className="flex justify-end mt-4">
                        <button onClick={guardarGeneral} disabled={ocupado || !cambiado}
                            className="px-4 py-2 text-sm font-bold rounded-lg text-white bg-slate-900 inline-flex items-center gap-1.5 disabled:opacity-40">
                            <Save size={14} /> {ocupado ? 'Guardando…' : 'Guardar límites'}
                        </button>
                    </div>

                    <div className="border-t border-slate-100 mt-6 pt-5">
                        <p className="text-sm font-bold text-slate-800">Excepciones por cliente</p>
                        <p className="text-xs text-slate-500 mt-0.5 mb-3">Sube o baja el tope de una cuenta en particular. Manda sobre el general.</p>

                        {!cliente ? (
                            <div className="relative">
                                <div className="flex items-center border border-slate-200 rounded-lg px-2.5">
                                    <Search size={14} className="text-slate-400" />
                                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cliente por nombre o correo…" className="w-full py-2 px-2 text-sm outline-none" />
                                </div>
                                {resultados.length > 0 && (
                                    <div className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100">
                                        {resultados.map((u: any) => (
                                            <button key={u.id} onClick={() => { setCliente(u); setTopeCliente(''); }} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                                                <p className="text-sm font-semibold text-slate-800">{u.companyName || u.company_name || u.name || '—'} <span className="text-[10px] font-bold uppercase text-slate-400 ml-1">{esEmpresa(u) ? 'empresa' : 'persona'}</span></p>
                                                <p className="text-[11px] text-slate-500">{u.email}</p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-sm font-bold text-slate-800">{cliente.companyName || cliente.company_name || cliente.name}</p>
                                        <p className="text-[11px] text-slate-500">{cliente.email} · {esEmpresa(cliente) ? 'empresa' : 'persona'} · general {conPuntos(String(generalDe(cliente)))} COP</p>
                                    </div>
                                    <button onClick={() => setCliente(null)} className="text-xs text-slate-500 hover:text-slate-800">Cambiar</button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                    <CampoPesos label="Tope por envío para este cliente" hint="por envío" value={topeCliente} onChange={setTopeCliente} />
                                    <div>
                                        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Motivo (opcional)</label>
                                        <input value={nota} onChange={e => setNota(e.target.value.slice(0, 200))} placeholder="Ej.: pago de nómina mensual" className="mt-1 w-full border border-slate-200 rounded-lg py-2 px-3 text-sm outline-none focus:border-slate-400" />
                                    </div>
                                </div>
                                <div className="flex justify-end mt-3">
                                    <button onClick={() => guardarExcepcion(cliente.id, topeCliente || null, nota)} disabled={ocupado || !topeCliente}
                                        className="px-4 py-2 text-sm font-bold rounded-lg text-white bg-slate-900 inline-flex items-center gap-1.5 disabled:opacity-40">
                                        <Save size={14} /> Guardar excepción
                                    </button>
                                </div>
                            </div>
                        )}

                        {excepciones.length > 0 && (
                            <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden">
                                {excepciones.map(e => (
                                    <div key={e.userId} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 last:border-b-0">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate">{e.nombre || e.email || e.userId} <span className="text-[10px] font-bold uppercase text-slate-400 ml-1">{e.tipo}</span></p>
                                            <p className="text-[11px] text-slate-500 truncate">{e.email}{e.nota ? ` · ${e.nota}` : ''}</p>
                                        </div>
                                        <div className="flex items-center gap-3 shrink-0">
                                            <div className="text-right">
                                                <p className="text-sm font-bold font-mono text-slate-800">{conPuntos(String(e.achMax))}</p>
                                                <p className="text-[10px] text-slate-400">{enPalabras(e.achMax)}</p>
                                            </div>
                                            <button onClick={() => guardarExcepcion(e.userId, null)} disabled={ocupado} title="Quitar excepción" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 disabled:opacity-40"><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};
