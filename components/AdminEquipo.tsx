// ════════════════════════════════════════════════════════
// AdminEquipo — quién del equipo puede entrar, con qué rol y sobre qué países.
//
// LO QUE HABIA ANTES
//   Una tabla que guardaba nombres en un JSON de configuración. No creaba
//   accesos, no restringía nada y el rol era una etiqueta. Se veía como
//   control de accesos sin serlo, que es peor que no tener nada: alguien
//   podía creer que le había quitado el acceso a una persona.
//
// LO QUE ES AHORA
//   Un reflejo de admin_miembros. Cada cambio se guarda en el servidor y el
//   servidor lo exige en cada llamada. Esta pantalla no decide nada: muestra.
//
// NO CREA CUENTAS, A PROPOSITO
//   Se le dan permisos a una cuenta QUE YA EXISTE y que ya tiene rol de
//   administrador. Crear accesos desde acá significaría poder fabricar un
//   administrador con un formulario, y el correo de invitación sería una vía
//   de entrada más que proteger.
// ════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, X, ShieldCheck, Globe, AlertTriangle } from 'lucide-react';
import { pedirAdmin, ROLES, PAISES } from './adminApi';

interface Miembro {
  id: string;
  email: string;
  nombre: string | null;
  rol: string;
  paises: string[];
  activo: boolean;
  ultimo_acceso_at: string | null;
}

const nombreRol = (id: string) => ROLES.find((r) => r.id === id)?.nombre ?? id;

export const AdminEquipo: React.FC = () => {
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<Miembro | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const r = await pedirAdmin({ action: 'equipo_listar' }).catch(() => null);
    if (r?.permisoDenegado) setSinPermiso(true);
    else if (r?.ok) setMiembros(Array.isArray(r.miembros) ? r.miembros : []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (sinPermiso) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex gap-3">
        <ShieldCheck size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-amber-900 text-sm">El equipo lo administra el dueño</p>
          <p className="text-xs text-amber-800 mt-1">
            Tu rol no permite ver ni cambiar quién tiene acceso. No es un error.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-bold text-slate-800">Equipo</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Quién entra al panel, con qué rol y sobre qué países.
          </p>
        </div>
        <button
          onClick={() => { setEditando(null); setAbierto(true); }}
          className="bg-[#0C0E0D] text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2"
        >
          <UserPlus size={16} /> Dar acceso
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
            <tr>
              <th className="px-6 py-4">Persona</th>
              <th className="px-6 py-4">Rol</th>
              <th className="px-6 py-4">Países</th>
              <th className="px-6 py-4">Último acceso</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-sm">Cargando…</td></tr>
            ) : miembros.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-sm">
                Todavía no hay nadie más con acceso.
              </td></tr>
            ) : miembros.map((m) => (
              <tr key={m.id} className={`hover:bg-slate-50 ${m.activo ? '' : 'opacity-50'}`}>
                <td className="px-6 py-4">
                  <p className="font-bold text-slate-800">{m.nombre || '—'}</p>
                  <p className="text-xs text-slate-400">{m.email}</p>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs font-bold px-2 py-1 rounded-md bg-slate-100 text-slate-700">
                    {nombreRol(m.rol)}
                  </span>
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">
                  {m.rol === 'dueno'
                    ? <span className="font-semibold">Todos</span>
                    : m.paises?.length
                      ? m.paises.map((c) => PAISES.find((p) => p.code === c)?.nombre ?? c).join(' · ')
                      : <span className="text-amber-600 font-semibold">Ninguno — no ve datos</span>}
                </td>
                <td className="px-6 py-4 text-xs text-slate-500">
                  {m.ultimo_acceso_at ? new Date(m.ultimo_acceso_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}
                </td>
                <td className="px-6 py-4 text-right whitespace-nowrap">
                  <button onClick={() => { setEditando(m); setAbierto(true); }}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg px-2.5 py-1 mr-2">
                    Editar
                  </button>
                  {m.activo && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Quitarle el acceso a ${m.email}?`)) return;
                        const r = await pedirAdmin({ action: 'equipo_desactivar', id: m.id });
                        if (!r?.ok) alert(r?.message ?? 'No se pudo quitar el acceso.');
                        cargar();
                      }}
                      className="text-xs font-semibold text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-2.5 py-1">
                      Quitar acceso
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {abierto && (
        <ModalMiembro
          inicial={editando}
          onCerrar={() => setAbierto(false)}
          onGuardado={() => { setAbierto(false); cargar(); }}
        />
      )}
    </div>
  );
};

const ModalMiembro: React.FC<{
  inicial: Miembro | null;
  onCerrar: () => void;
  onGuardado: () => void;
}> = ({ inicial, onCerrar, onGuardado }) => {
  const [email, setEmail] = useState(inicial?.email ?? '');
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [rol, setRol] = useState(inicial?.rol ?? 'operaciones');
  const [paises, setPaises] = useState<string[]>(inicial?.paises ?? []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = (code: string) =>
    setPaises((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));

  const guardar = async () => {
    setGuardando(true); setError(null);
    const r = await pedirAdmin({ action: 'equipo_guardar', email, nombre, rol, paises }).catch(() => null);
    setGuardando(false);
    // El servidor distingue "no tiene cuenta" de "no es admin" y lo dice con
    // sus palabras. Mostrarlo tal cual evita el clásico "algo salió mal" que
    // deja a alguien probando de nuevo sin saber qué cambiar.
    if (!r?.ok) { setError(r?.message ?? r?.error ?? 'No se pudo guardar.'); return; }
    onGuardado();
  };

  const faltaPais = rol !== 'dueno' && paises.length === 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCerrar}>
      <div className="bg-white rounded-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h4 className="font-bold text-slate-900">{inicial ? 'Editar acceso' : 'Dar acceso'}</h4>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
            Esto <b>no crea una cuenta</b>. La persona ya tiene que tener su cuenta en Lincoin
            con rol de administrador; acá se define qué puede hacer con ella.
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Correo</label>
            <input
              value={email} onChange={(e) => setEmail(e.target.value)}
              disabled={!!inicial}
              placeholder="persona@lincoin.me"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Nombre</label>
            <input
              value={nombre} onChange={(e) => setNombre(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Rol</label>
            <div className="space-y-2">
              {ROLES.map((r) => (
                <button key={r.id} onClick={() => setRol(r.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${rol === r.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <p className="text-sm font-bold text-slate-800">{r.nombre}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{r.que}</p>
                </button>
              ))}
            </div>
          </div>

          {rol !== 'dueno' && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                <Globe size={12} /> Países
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PAISES.map((p) => (
                  <button key={p.code} onClick={() => alternar(p.code)}
                    className={`px-3 py-2 rounded-lg border text-sm font-semibold transition-colors ${paises.includes(p.code) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                    {p.nombre}
                  </button>
                ))}
              </div>
              {faltaPais && (
                <p className="text-[11px] text-amber-700 mt-2 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  Sin ningún país, esta persona entra al panel pero no ve ningún dato.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onCerrar} className="px-4 py-2 text-sm font-semibold text-slate-600">Cancelar</button>
          <button onClick={guardar} disabled={guardando || !email}
            className="bg-[#0C0E0D] text-white px-4 py-2 rounded-lg font-bold text-sm disabled:opacity-40">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
};
