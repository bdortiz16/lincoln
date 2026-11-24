// ── Cumplimiento → Resumen ───────────────────────────────────────────────
// El dueño (24 nov): "crear un dashboard, porque mira, siempre que abro me
// sale es acá". Cumplimiento abría directo en Cupos (o en Operadores) cuando
// había algo pendiente ahí, y lo demás —la bandeja de casos, las wallets que
// vigila el KYT, lo que falta de SIREL— no se veía sin ir pestaña por
// pestaña. Esta es la portada: arriba lo que pide una decisión, con su botón;
// abajo una tarjeta por área con sus cifras. Toda la tarjeta abre su pestaña.
//
// Solo lectura y sin cifras inventadas: cada número sale de la misma fuente
// que su pestaña (la bandeja de TusDatos, cupos y operadores del panel, y
// admin-data cumplimiento_resumen para KYT y SIREL). Si una fuente no
// responde, su tarjeta lo dice y las demás salen igual.
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ChevronRight, ShieldAlert, Users, Gauge, Wallet, FileText, UserCheck } from 'lucide-react';
import { pedirAdmin } from './adminApi';
import { llamarFuncion } from '../lib/edge';

const C = {
  carbon: '#0C0E0D', elevado: '#121413', texto: '#F4F4F2', sub: '#878E88', tenue: 'rgba(244,244,242,0.45)',
  borde: 'rgba(255,255,255,0.08)', borde2: 'rgba(255,255,255,0.14)', verde: '#4ADE80', rojo: '#F87171', ambar: '#FBBF24',
};
const n = (v: unknown) => Math.round(Number(v) || 0).toLocaleString('es-CO');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (ym: string) => { const [a, m] = ym.split('-').map(Number); return m ? `${MESES[m - 1]} ${a}` : ym; };

type Props = {
  cuposPend: number;
  operadoresPend: number;
  kyb: { pendientes?: number; verificados?: number; bloqueados?: number; empresas?: number } | null;
  irA: (tab: string) => void;
};

const Tarjeta: React.FC<{ titulo: string; icono: React.ReactNode; onAbrir: () => void; cifra?: React.ReactNode; pie?: React.ReactNode; children?: React.ReactNode; alerta?: boolean }> = ({ titulo, icono, onAbrir, cifra, pie, children, alerta }) => (
  <button type="button" onClick={onAbrir} className="transition-colors hover:border-white/25"
    style={{ textAlign: 'left', background: C.carbon, border: `1px solid ${alerta ? 'rgba(251,191,36,0.35)' : C.borde}`, borderRadius: 14, padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit', color: C.texto, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 800 }}>
      <span style={{ color: C.verde, display: 'inline-flex' }}>{icono}</span> {titulo}
      <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.verde, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>Abrir <ChevronRight size={12} /></span>
    </span>
    {cifra !== undefined && <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', color: alerta ? C.ambar : C.texto }}>{cifra}</span>}
    {pie && <span style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>{pie}</span>}
    {children}
  </button>
);

const Linea: React.FC<{ et: string; v: React.ReactNode; color?: string }> = ({ et, v, color }) => (
  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, color: C.sub }}>
    <span>{et}</span><span style={{ fontWeight: 700, color: color ?? C.texto, fontVariantNumeric: 'tabular-nums' }}>{v}</span>
  </span>
);

export const AdminCumplimientoResumen: React.FC<Props> = ({ cuposPend, operadoresPend, kyb, irA }) => {
  const [bandeja, setBandeja] = useState<any>(null);
  const [extra, setExtra] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [at, setAt] = useState<Date | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [b, x] = await Promise.all([
      llamarFuncion('tusdatos', { action: 'compliance' }).catch((e: any) => ({ error: String(e?.message ?? e) })),
      pedirAdmin({ action: 'cumplimiento_resumen' }).catch((e: any) => ({ error: String(e?.message ?? e) })),
    ]);
    setBandeja(b); setExtra(x); setAt(new Date()); setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const r: any = bandeja?.ok ? bandeja.resumen ?? {} : null;
  const reglas: any = bandeja?.ok ? bandeja.reglas ?? null : null;
  const kyt: any = extra?.ok && extra.kyt && !extra.kyt.error ? extra.kyt : null;
  const otc: any = extra?.ok && extra.otcWallets && !extra.otcWallets.error ? extra.otcWallets : null;
  const sirel: any = extra?.ok && extra.sirel && !extra.sirel.error ? extra.sirel : null;

  // Lo que pide una decisión, en el orden en que frena operaciones.
  const pendientes: { n: number; texto: string; tab: string }[] = [
    { n: operadoresPend, texto: operadoresPend === 1 ? 'operador por aprobar' : 'operadores por aprobar', tab: 'operadores' },
    { n: cuposPend, texto: cuposPend === 1 ? 'solicitud de cupo en proceso' : 'solicitudes de cupo en proceso', tab: 'cupos' },
    { n: Number(r?.bloqueados ?? 0), texto: 'beneficiarios con envíos frenados', tab: 'compliance' },
    { n: Number(r?.nombreNoCoincide ?? 0), texto: 'beneficiarios cuyo nombre no coincide', tab: 'compliance' },
    { n: Number(r?.documentoNoVigente ?? 0), texto: 'beneficiarios con documento no vigente', tab: 'compliance' },
    { n: Number(r?.alto ?? 0), texto: 'beneficiarios en riesgo alto', tab: 'compliance' },
    { n: Number(r?.fuentePendiente ?? 0), texto: 'consultas con una fuente pendiente', tab: 'compliance' },
    { n: Number(kyt?.subieron ?? 0), texto: 'wallets que subieron de nivel', tab: 'kyt' },
    { n: Number(kyb?.pendientes ?? 0), texto: 'clientes por verificar (KYB)', tab: 'clients' },
  ].filter(p => p.n > 0);

  // SIREL del mes anterior: por grupo, el reporte o su ausencia.
  const reg: string[] = sirel?.registrados ?? [];
  const sirelGrupos = [
    { l: 'Clientes', ok: reg.includes('clientes') },
    { l: 'Transacciones', ok: reg.includes('transacciones') || reg.includes('ausencia_transacciones'), ausencia: reg.includes('ausencia_transacciones') && !reg.includes('transacciones') },
    { l: 'ROS', ok: reg.includes('ros') || reg.includes('ausencia_ros'), ausencia: reg.includes('ausencia_ros') && !reg.includes('ros') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: "'Archivo', system-ui, sans-serif", color: C.texto }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 300px' }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>Resumen de cumplimiento</p>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
            Lo que pide una decisión y cómo está cada área. Toca una tarjeta para abrir su pestaña.
            {at ? ` · actualizado ${at.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <button type="button" onClick={cargar} disabled={cargando}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', background: 'transparent', border: `1px solid ${C.borde2}`, color: C.texto, opacity: cargando ? 0.6 : 1 }}>
          <RefreshCw size={14} className={cargando ? 'animate-spin' : undefined} /> Actualizar
        </button>
      </div>

      {/* ── Para revisar ── */}
      <div style={{ background: C.carbon, border: `1px solid ${pendientes.length ? 'rgba(251,191,36,0.30)' : C.borde}`, borderRadius: 14, padding: '14px 16px' }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800 }}>Para revisar</p>
        {cargando && !bandeja ? (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.sub }}>Revisando…</p>
        ) : pendientes.length === 0 ? (
          <p style={{ margin: '6px 0 0', fontSize: 12.5, color: C.verde }}>Nada pendiente: no hay operadores, cupos, beneficiarios frenados ni wallets que hayan subido de nivel.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
            {pendientes.map((p, i) => (
              <button key={p.texto} type="button" onClick={() => irA(p.tab)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i ? `1px solid ${C.borde}` : 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'transparent', color: C.texto, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                <span style={{ minWidth: 44, fontSize: 16, fontWeight: 800, color: C.ambar, fontVariantNumeric: 'tabular-nums' }}>{n(p.n)}</span>
                <span style={{ fontSize: 13, flex: 1 }}>{p.texto}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.verde, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>Revisar <ChevronRight size={12} /></span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Las áreas ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, alignItems: 'start' }}>
        <Tarjeta titulo="Bandeja de casos" icono={<ShieldAlert size={14} />} onAbrir={() => irA('compliance')}
          alerta={!!r && (Number(r.bloqueados) > 0 || Number(r.alto) > 0)}
          cifra={r ? n(Math.max(0, Number(r.total) - Number(r.enOrden) - Number(r.aprobados))) : bandeja?.error ? '—' : '…'}
          pie={r ? 'beneficiarios con algo que mirar (AML de quienes reciben)' : bandeja?.error ? `No se pudo leer: ${String(bandeja.error).slice(0, 120)}` : 'Cargando…'}>
          {r && <>
            <Linea et="Riesgo alto" v={n(r.alto)} color={Number(r.alto) > 0 ? C.ambar : undefined} />
            <Linea et="Riesgo medio" v={n(r.medio)} />
            <Linea et="Envíos frenados" v={n(r.bloqueados)} color={Number(r.bloqueados) > 0 ? C.ambar : undefined} />
            <Linea et="Consultas en curso" v={n(r.enCurso)} />
            <Linea et="En orden" v={n(r.enOrden)} color={C.verde} />
            <Linea et="Aprobados por cumplimiento" v={n(r.aprobados)} />
            {reglas && <span style={{ fontSize: 11, color: C.tenue, marginTop: 2 }}>
              Verificación automática {reglas.activo ? 'activa' : 'apagada'}{reglas.activo ? ` · ${reglas.bloquear ? (reglas.soloBloquearAlto ? 'frena solo riesgo alto' : 'frena alertas') : 'solo avisa, no frena'}` : ''}
            </span>}
          </>}
        </Tarjeta>

        <Tarjeta titulo="Cupos por beneficiario" icono={<Gauge size={14} />} onAbrir={() => irA('cupos')} alerta={cuposPend > 0}
          cifra={n(cuposPend)} pie={cuposPend === 1 ? 'solicitud de aumento en proceso' : 'solicitudes de aumento en proceso'} />

        <Tarjeta titulo="Operadores" icono={<Users size={14} />} onAbrir={() => irA('operadores')} alerta={operadoresPend > 0}
          cifra={n(operadoresPend)} pie={operadoresPend === 1 ? 'operador esperando aprobación' : 'operadores esperando aprobación'} />

        <Tarjeta titulo="KYT · Wallets" icono={<Wallet size={14} />} onAbrir={() => irA('kyt')} alerta={!!kyt && (Number(kyt.subieron) > 0 || Number(kyt.alto) > 0)}
          cifra={kyt ? n(kyt.monitoreadas) : extra?.error || extra?.kyt?.error ? '—' : '…'}
          pie={kyt ? 'wallets en monitoreo (según su última revisión)' : extra?.kyt?.error || extra?.error ? 'No se pudo leer el monitoreo.' : 'Cargando…'}>
          {kyt && <>
            <Linea et="Riesgo alto" v={n(kyt.alto)} color={Number(kyt.alto) > 0 ? C.ambar : undefined} />
            <Linea et="Riesgo medio" v={n(kyt.medio)} />
            <Linea et="Riesgo bajo" v={n(kyt.bajo)} color={C.verde} />
            {Number(kyt.subieron) > 0 && <Linea et="Subieron de nivel" v={n(kyt.subieron)} color={C.ambar} />}
          </>}
          {otc && <span style={{ fontSize: 11, color: C.tenue, marginTop: 2 }}>
            Mesa OTC, últimos {otc.dias} días: {n(otc.verificaciones)} {Number(otc.verificaciones) === 1 ? 'wallet verificada' : 'wallets verificadas'}{Number(otc.bloqueadas) > 0 ? ` · ${n(otc.bloqueadas)} no permitidas` : ''}
          </span>}
        </Tarjeta>

        <Tarjeta titulo="SIREL (UIAF)" icono={<FileText size={14} />} onAbrir={() => irA('sirel')}
          alerta={!!sirel && sirelGrupos.some(g => !g.ok)}
          cifra={sirel ? `${sirelGrupos.filter(g => g.ok).length} de ${sirelGrupos.length}` : extra?.sirel?.error || extra?.error ? '—' : '…'}
          pie={sirel ? `reportes registrados en Lincoin para ${nombreMes(sirel.mes)}` : extra?.sirel?.error || extra?.error ? 'No se pudo leer el registro de SIREL.' : 'Cargando…'}>
          {sirel && <>
            {sirelGrupos.map(g => (
              <Linea key={g.l} et={g.l} v={g.ok ? (g.ausencia ? 'Ausencia registrada' : 'Registrado') : 'Sin registrar'} color={g.ok ? C.verde : C.ambar} />
            ))}
            {sirel.ultimo && <span style={{ fontSize: 11, color: C.tenue, marginTop: 2 }}>
              Último radicado: {sirel.ultimo.radicado} ({sirel.ultimo.periodo})
            </span>}
          </>}
        </Tarjeta>

        <Tarjeta titulo="Clientes · KYB" icono={<UserCheck size={14} />} onAbrir={() => irA('clients')} alerta={Number(kyb?.pendientes ?? 0) > 0}
          cifra={kyb ? n(kyb.pendientes) : '—'} pie={kyb ? 'clientes por verificar' : 'Sin el resumen de clientes.'}>
          {kyb && <>
            <Linea et="Verificados" v={n(kyb.verificados)} color={C.verde} />
            <Linea et="Bloqueados" v={n(kyb.bloqueados)} />
          </>}
        </Tarjeta>
      </div>

      {/* ── Las demás pestañas ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: C.sub }}>También:</span>
        {[['risk', 'Lincoin Risk'], ['sarblock', 'Sarblock'], ['tusdatos', 'TusDatos']].map(([t, l]) => (
          <button key={t} type="button" onClick={() => irA(t)}
            style={{ height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', border: `1px solid ${C.borde2}`, background: 'transparent', color: C.texto }}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
};
