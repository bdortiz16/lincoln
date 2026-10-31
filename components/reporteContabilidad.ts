// Informe completo de Contabilidad en Excel.
//
// Un solo archivo con:
//   · Resumen — los totales del período, por cliente, por riel y por mes (o
//     por día si es un solo mes), con gráficos.
//   · Anotaciones — lo que hay que mirar: pérdidas, ajustes sin vincular,
//     facturas por emitir o con error, movimientos rechazados… y cómo leer
//     el archivo.
//   · Operaciones — todas las operaciones contables (cargues, conversiones y
//     ajustes) de todos los clientes, con filtro.
//   · Movimientos — todos los movimientos de las cuentas en el período
//     (envíos, pagos, retiros, cargues…), con filtro.
//   · Una hoja por cliente — su resumen contable y de cuenta, sus anotaciones,
//     por riel y por mes, cada operación con su factura, y sus movimientos.
//
// Los números contables los calcula el servidor (contabilidad_cliente, la
// misma cuenta que usa la factura); acá solo se ordenan. Las filas duplicadas
// de una misma persona (mismo correo) van en UNA hoja: el servidor ya junta
// sus operaciones, y contarlas dos veces inflaría los totales.
import { armarXlsx, refCelda, MIME_XLSX, type CeldaX, type Estilo, type Grafico, type Hoja } from '../lib/xlsx';
import { pedirAdmin } from './adminApi';
import { TIPOS, fechaDe, monedaDe, direccionDe } from './excelMovimientosCliente';

const FMT_COP = '"$"#,##0';
const VERDE = '22A35C';

const c = (v: any, s: Estilo): CeldaX => ({ v: v === undefined ? null : v, s });
const num = (v: unknown): number | null => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n; };
const n0 = (v: unknown) => num(v) ?? 0;
const txt = (v: unknown) => (v == null ? '' : String(v));
const pesos = (v: unknown) => `$${Math.round(Math.abs(n0(v))).toLocaleString('es-CO')}`;
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// Hora de Colombia (UTC−5): el mes y el día contables son los de Bogotá.
const bogota = (iso: string) => new Date(Date.parse(iso) - 5 * 3600_000);
const mesDe = (iso: string) => bogota(iso).toISOString().slice(0, 7);
const diaDe = (iso: string) => bogota(iso).toISOString().slice(0, 10);
const nombreMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, 15)).toLocaleDateString('es-CO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const nombreDia = (dia: string) => new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fechaCorta = (iso: unknown) => { const s = String(iso ?? ''); return s ? new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; };
const aFecha = (iso: unknown) => { const d = new Date(String(iso ?? '')); return isNaN(d.getTime()) ? null : d; };

const ESTADO_FACTURA: Record<string, string> = {
  emitida: 'Emitida', emitiendo: 'Emitiendo', pendiente: 'Pendiente', revision: 'Revisar utilidad',
  incierta: 'Por verificar en Siigo', error: 'Error', omitida: 'No aplica',
};
const FUENTE: Record<string, string> = { registrada: 'Registrada', estimada: 'Estimada (mesa OTC)', sin_dato: 'Sin dato', manual: 'Confirmada a mano' };
const esCop = (moneda: unknown) => /^COP/i.test(String(moneda ?? ''));
const estadoMov = (s: unknown): 'ok' | 'mal' | 'curso' => {
  const t = String(s ?? '');
  if (/^complet/i.test(t)) return 'ok';
  if (/rechaz|fall|cancel|revert|devuel|anul/i.test(t)) return 'mal';
  return 'curso';
};

// ── Lienzo: va apilando filas y recuerda combinadas, altos y gráficos ──
class Lienzo {
  filas: CeldaX[][] = [];
  combinar: string[] = [];
  altos: Record<number, number> = {};
  graficos: Grafico[] = [];
  get fila() { return this.filas.length; }
  agregar(f: CeldaX[] = []) { this.filas.push(f); return this.filas.length - 1; }
  hasta(fila: number) { while (this.filas.length < fila) this.filas.push([]); }
  /** Texto que ocupa varias columnas (combinadas), con alto según el largo. */
  parrafo(texto: string, s: Estilo, cols = 8, porLinea = 120) {
    const r = this.agregar([c(texto, s), ...Array.from({ length: cols - 1 }, () => c(null, s))]);
    this.combinar.push(`${refCelda(0, r)}:${refCelda(cols - 1, r)}`);
    const lineas = Math.max(1, Math.ceil(texto.length / porLinea));
    if (lineas > 1) this.altos[r] = 14 * lineas + 4;
    return r;
  }
  seccion(t: string, cols = 8) {
    this.agregar([]);
    const r = this.agregar([c(t, 'seccion'), ...Array.from({ length: cols - 1 }, () => c(null, 'seccion'))]);
    this.altos[r] = 20;
    return r;
  }
  encabezado(titulo: string, subtitulo: string) {
    this.altos[this.agregar([{ marca: true }])] = 28;
    this.altos[this.agregar([c(titulo, 'titulo')])] = 24;
    const r = this.agregar([c(subtitulo, 'nota')]);
    this.combinar.push(`${refCelda(0, r)}:${refCelda(9, r)}`);
  }
  /** Pares etiqueta → valor, en las columnas A y B. */
  indicadores(pares: [string, any, Estilo][]) {
    for (const [k, v, s] of pares) this.agregar([c(k, 'etiqueta'), c(v, s)]);
  }
}

// ── Datos de un cliente ──
type DatosCliente = {
  base: any;              // fila del resumen
  c: any;                 // totales del servidor (las filas del mismo correo juntas)
  detalle: any[];
  movs: any[];
  movsTruncado: boolean;
  errores: string[];
};

const mapearMov = (t: any) => ({
  ...(t.raw_data ?? {}),
  id: t.id, type: t.type, amount: Number(t.amount), currency: t.currency, status: t.status,
  created_at: t.created_at, createdAt: t.raw_data?.createdAt ?? t.created_at,
});

async function leerCliente(base: any, desde?: string, hasta?: string): Promise<DatosCliente> {
  const errores: string[] = [];
  const [det, mov] = await Promise.all([
    pedirAdmin({ action: 'contabilidad_cliente', userId: base.userId, ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) }).catch((e: any) => ({ error: String(e?.message ?? e) })),
    pedirAdmin({ action: 'movimientos_cliente', userId: base.userId }).catch((e: any) => ({ error: String(e?.message ?? e) })),
  ]);
  if (!det?.ok) errores.push(`No se pudo leer el detalle contable: ${det?.error ?? 'sin respuesta'}. Los totales de esta hoja son los del resumen.`);
  if (!mov?.ok) errores.push(`No se pudieron leer los movimientos de la cuenta: ${mov?.error ?? 'sin respuesta'}.`);
  const dentro = (iso: string) => (!desde || iso >= desde) && (!hasta || iso < hasta);
  const movs = mov?.ok && Array.isArray(mov.transactions)
    ? mov.transactions.filter((t: any) => dentro(String(t.created_at ?? ''))).map(mapearMov)
      .sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))
    : [];
  return {
    base,
    c: det?.ok && det.cliente ? { ...base, ...det.cliente, nombre: base.nombre, documento: base.documento ?? det.cliente.documento, email: base.email ?? det.cliente.email } : base,
    detalle: det?.ok && Array.isArray(det.detalle) ? det.detalle : [],
    movs,
    movsTruncado: mov?.truncado === true,
    errores,
  };
}

// ── Operaciones contables: una fila por operación ──
const COLS_OPS = ['Fecha', 'Operación', 'Riel', 'Estado', 'USDT entró', 'USDT llegó', 'Tasa venta', 'Recibido COP', 'Tasa cliente', 'Acreditado COP', 'Ajuste COP', 'Comisión Bre-B COP', 'Utilidad COP', 'Fuente de la utilidad', 'Factura Lincoin', 'Nº factura', 'Anotaciones', 'Id'];
const ESTILOS_OPS: Estilo[] = ['fechaHora', 'texto', 'texto', 'texto', 'usd', 'usd', 'tasa', 'cop', 'tasa', 'cop', 'cop', 'cop', 'copUtil', 'texto', 'texto', 'texto', 'textoAjustado', 'texto'];
// Columnas que se suman en el total (sin los anulados).
const SUMA_OPS = new Set([4, 5, 7, 9, 11, 12]);

function filaOperacion(d: any, fechaDeId: (id: string) => string): { valores: any[]; anotaciones: string[] } {
  const l = d.liq;
  const notas: string[] = [];
  if (d.nota) notas.push(`Nota: ${d.nota}`);
  if (d.type === 'adjustment') {
    const vinculado = !!(d.vinculado || d.reversaDe);
    const estado = vinculado ? 'Reversa vinculada' : !d.esDebito ? 'A favor del cliente' : d.noRevierte ? 'Otro ajuste' : 'Sin vincular';
    if (vinculado) notas.push(`Revierte el cargue${d.reversaDe && fechaDeId(String(d.reversaDe)) ? ` del ${fechaDeId(String(d.reversaDe))}` : ''}: no se resta aparte, ya está dentro de ese cargue.`);
    else if (d.esDebito && !d.noRevierte) notas.push('Débito sin vincular: si corrige un cargue, vincúlalo en Contabilidad para que el cargue quede anulado o corregido.');
    const monto = n0(d.amount);
    return {
      valores: [aFecha(d.created_at), vinculado ? 'Reversa de cargue' : `Ajuste ${d.esDebito ? '(débito)' : '(crédito)'}`, d.riel ?? '', estado,
        null, null, null, null, null, null, vinculado ? null : (d.esDebito ? -monto : monto), null, null, '', '', '', '', String(d.id)],
      anotaciones: notas,
    };
  }
  const anulado = !!l?.anulado;
  const o = l?.original ?? {};
  const v = (k: string) => (anulado ? o?.[k] : l?.[k]) ?? null;
  const u = num(v('utilidadCop'));
  if (anulado) notas.push(`Anulado: ${l?.nota || 'revertido completo por un débito vinculado'}. No suma ni deja utilidad.`);
  else if (l?.reversadoCop) notas.push(`Corregido: ${l?.nota || `se revirtieron ${pesos(l.reversadoCop)}`}.`);
  if (!anulado && l?.usdLlego != null && l?.usd != null && Math.abs(l.usdLlego - l.usd) > 0.009) notas.push(`Llegaron ${l.usdLlego.toLocaleString('es-CO')} USDT de ${l.usd.toLocaleString('es-CO')}.`);
  if (!anulado && u != null && u < 0) notas.push('En pérdida: se acreditó más de lo que se recibió por la venta.');
  if (l?.fuente === 'estimada') notas.push('Utilidad estimada con la tasa de la mesa OTC.');
  if (l?.fuente === 'sin_dato' && l?.facturable) notas.push('Sin utilidad registrada: hay que confirmarla antes de facturar.');
  const f = d.factura;
  if (anulado && f?.estado === 'emitida') notas.push('Tenía factura emitida: anúlala en Siigo o haz la nota crédito.');
  if (f?.estado === 'error' && f?.error) notas.push(`Factura con error: ${f.error}`);
  if (!f && l?.facturable && !anulado && (u ?? 0) > 0) notas.push('Por facturar.');
  if (!l?.facturable && !anulado && l?.nota && !l?.reversadoCop) notas.push(l.nota);
  const estado = anulado ? 'Anulado' : l?.reversadoCop ? 'Corregido' : 'Vigente';
  const factura = f?.estado ? (ESTADO_FACTURA[f.estado] ?? f.estado) : l?.facturable ? 'Sin factura' : 'No aplica';
  return {
    valores: [aFecha(d.created_at), `${d.type === 'convert' ? 'Conversión' : 'Cargue'}${d.ref ? ` · ${d.ref}` : ''}`, d.riel ?? '', estado,
      num(v('usd')), num(anulado ? null : l?.usdLlego), num(l?.tasaLincoin), num(v('totalCop')), num(l?.tasaCliente), num(v('tercerosCop')), null,
      num(anulado ? null : l?.comisionBrebCop), u, l ? FUENTE[l.fuente] ?? l.fuente : '', factura, f?.numero ?? '', '', String(d.id)],
    anotaciones: notas,
  };
}

// Tasas promedio como en la pantalla: la de venta es lo recibido sobre los
// USDT que llegaron; la del cliente, lo acreditado (+ comisión Bre-B) sobre
// los USDT que entraron. Solo cargues: promediar con conversiones no significa nada.
function tasasPromedio(detalle: any[]) {
  let rec = 0, llego = 0, acr = 0, usd = 0;
  for (const d of detalle) {
    const l = d.liq;
    if (!l || l.anulado || l.tipo !== 'cargue' || !(l.usd > 0)) continue;
    if (l.totalCop != null && l.tasaLincoin) { rec += l.totalCop; llego += l.usdLlego ?? l.usd; }
    if (l.tercerosCop != null && l.tasaCliente) { acr += l.tercerosCop + (l.comisionBrebCop ?? 0); usd += l.usd; }
  }
  return { venta: llego ? rec / llego : null, cliente: usd ? acr / usd : null };
}

// Por riel y por mes (o día), solo lo vigente: un cargue anulado no suma.
type Grupo = { n: number; usd: number; recibido: number; acreditado: number; utilidad: number; conversiones: number; convertido: number };
const grupoNuevo = (): Grupo => ({ n: 0, usd: 0, recibido: 0, acreditado: 0, utilidad: 0, conversiones: 0, convertido: 0 });
function agrupar(detalle: any[], clave: (d: any) => string, soloCargues = false) {
  const m = new Map<string, Grupo>();
  for (const d of detalle) {
    const l = d.liq;
    if (!l || l.anulado) continue;
    if (soloCargues && l.tipo !== 'cargue') continue;
    const k = clave(d);
    const g = m.get(k) ?? grupoNuevo();
    if (l.tipo === 'cargue') { g.n++; g.usd += l.usd ?? 0; g.recibido += l.totalCop ?? l.tercerosCop ?? 0; g.acreditado += l.tercerosCop ?? 0; }
    else { g.conversiones++; g.convertido += l.totalCop ?? l.tercerosCop ?? 0; }
    g.utilidad += l.utilidadCop ?? 0;
    m.set(k, g);
  }
  return m;
}

// La columna Anotaciones va ajustada: la fila crece según lo que diga.
function altoPorAnotaciones(altos: Record<number, number>, filas: CeldaX[][], desde: number, hasta: number, col: number) {
  for (let r = desde; r <= hasta; r++) {
    const t = String((filas[r]?.[col] as any)?.v ?? '');
    const lineas = Math.ceil(t.length / 58);
    if (lineas > 1) altos[r] = 14 * lineas + 3;
  }
}

// Una tabla con cabecera oscura, filas y total con fórmula (y su valor ya
// calculado). Devuelve en qué filas quedaron los datos.
type ColTotal = { f: (desde: number, hasta: number, col: number) => string; v: number | null; s: Estilo };
function tabla(L: Lienzo, cabecera: string[], filas: CeldaX[][], total?: { etiqueta: string; columnas: Map<number, ColTotal> }) {
  const rCab = L.agregar(cabecera.map(h => c(h, 'th')));
  L.altos[rCab] = 30;
  const desde = L.fila;
  for (const f of filas) L.agregar(f);
  const hasta = L.fila - 1;
  let rTotal: number | null = null;
  if (total && filas.length) {
    const fila: CeldaX[] = cabecera.map((_, i) => c(i === 0 ? total.etiqueta : null, 'totalTexto'));
    for (const [col, t] of total.columnas) fila[col] = { f: t.f(desde, hasta, col), v: t.v, s: t.s };
    rTotal = L.agregar(fila);
  }
  return { rCab, desde, hasta, rTotal };
}
const suma = (s: Estilo, v: number | null): ColTotal => ({ f: (d, h, col) => `SUM(${refCelda(col, d)}:${refCelda(col, h)})`, v, s });

// ── Hoja de un cliente ──
function hojaCliente(dc: DatosCliente, periodoTxt: string, alertas: string[]): Hoja {
  const L = new Lienzo();
  const k = dc.c;
  L.encabezado(String(k.nombre ?? 'Cliente'), periodoTxt);

  const fechaDeId = (id: string) => { const d = dc.detalle.find(x => String(x.id) === id); return d ? fechaCorta(d.created_at) : ''; };
  const tasas = tasasPromedio(dc.detalle);
  const util = n0(k.utilidadCargues) + n0(k.utilidadConversiones);

  // Movimientos de la cuenta, resumidos.
  let entradas = 0, salidas = 0, comisiones = 0, mal = 0, curso = 0, otrasMonedas = 0;
  for (const t of dc.movs) {
    const e = estadoMov(t.status);
    if (e === 'mal') mal++; else if (e === 'curso') curso++;
    if (!esCop(t.currency)) { otrasMonedas++; continue; }
    if (e !== 'ok') continue;
    const dir = direccionDe(t);
    if (dir === 'Entrada') entradas += n0(t.amount); else if (dir === 'Salida') salidas += n0(t.amount);
    comisiones += n0(t.feeCop ?? t.fee);
  }

  const inicioBloque = L.fila;
  L.seccion('Cliente', 2);
  L.indicadores([
    ['Nombre', k.nombre ?? '', 'kpiTexto'],
    ['Documento', k.documento ?? '', 'kpiTexto'],
    ['Correo', k.email ?? '', 'kpiTexto'],
    ['Última operación contable', aFecha(k.ultima), 'kpiFecha'],
  ]);
  L.seccion('Resumen contable', 2);
  L.indicadores([
    ['Cargues vigentes', n0(k.cargues), 'kpiEntero'],
    ['Cargues anulados', n0(k.anulados), 'kpiEntero'],
    ['Cargues corregidos', n0(k.corregidos), 'kpiEntero'],
    ['USDT que entró', n0(k.usdCargado), 'kpiUsd'],
    ['USDT que llegó', n0(k.usdLlego ?? k.usdCargado), 'kpiUsd'],
    ['Recibido por la venta (COP)', n0(k.cargadoTotalCop), 'kpiCop'],
    ['Tasa promedio de venta', tasas.venta, 'kpiTasa'],
    ['Acreditado al cliente (COP)', n0(k.cargadoCop), 'kpiCop'],
    ['Tasa promedio al cliente', tasas.cliente, 'kpiTasa'],
    ['Comisión Bre-B (COP)', n0(k.comisionBrebCop), 'kpiCop'],
    ['Utilidad de cargues', n0(k.utilidadCargues), 'kpiCop'],
    ['Conversiones', n0(k.conversiones), 'kpiEntero'],
    ['Convertido (COP)', n0(k.convertidoCop), 'kpiCop'],
    ['USD convertido', n0(k.usdConvertido), 'kpiUsd'],
    ['Utilidad de conversiones', n0(k.utilidadConversiones), 'kpiCop'],
    ['Utilidad neta Lincoin', util, 'kpiCop'],
    ['Ganancias', n0(k.gananciaCop), 'kpiCop'],
    ['Pérdidas', n0(k.perdidaCop), 'kpiCop'],
    ['Operaciones en pérdida', n0(k.enPerdida), 'kpiEntero'],
    ['Facturas emitidas', n0(k.facturadas), 'kpiEntero'],
    ['Facturado (COP)', n0(k.facturadoCop), 'kpiCop'],
    ['Por facturar', n0(k.porFacturar), 'kpiEntero'],
    ['Facturas con error', n0(k.facturasConError), 'kpiEntero'],
    ['Ajustes sin vincular', n0(k.ajustes), 'kpiEntero'],
    ['Ajustes sin vincular (COP)', n0(k.ajustadoCop), 'kpiCop'],
  ]);
  L.seccion('Movimientos de la cuenta en el período', 2);
  L.indicadores([
    ['Movimientos', dc.movs.length, 'kpiEntero'],
    ['Entradas completadas (COP)', entradas, 'kpiCop'],
    ['Salidas completadas (COP)', salidas, 'kpiCop'],
    ['Comisiones cobradas (COP)', comisiones, 'kpiCop'],
    ['Rechazados o fallidos', mal, 'kpiEntero'],
    ['En curso', curso, 'kpiEntero'],
    ['En otras monedas (USDT, USD…)', otrasMonedas, 'kpiEntero'],
  ]);
  const finBloque = L.fila;

  // Gráficos a la derecha del bloque de indicadores (se llenan abajo).
  const ALTO_G = 17;
  const filaG = inicioBloque + 1;
  L.hasta(Math.max(finBloque, filaG + ALTO_G) + 1);

  if (alertas.length) {
    L.seccion('Anotaciones', 10);
    for (const a of alertas) L.parrafo(a, 'alerta', 10, 130);
  }

  // Por riel (cargues).
  const porRiel = [...agrupar(dc.detalle, d => String(d.riel || 'Sin riel'), true).entries()].sort((a, b) => b[1].acreditado - a[1].acreditado);
  if (porRiel.length) {
    L.seccion('Cargues por riel', 8);
    tabla(L, ['Riel', 'Cargues', 'USDT', 'Recibido COP', 'Acreditado COP', 'Utilidad COP'],
      porRiel.map(([r, g]) => [c(r, 'texto'), c(g.n, 'entero'), c(g.usd, 'usd'), c(g.recibido, 'cop'), c(g.acreditado, 'cop'), c(g.utilidad, 'copUtil')]),
      { etiqueta: 'Total', columnas: new Map([[1, suma('totalEntero', porRiel.reduce((s, [, g]) => s + g.n, 0))], [2, suma('totalUsd', porRiel.reduce((s, [, g]) => s + g.usd, 0))], [3, suma('totalCop', porRiel.reduce((s, [, g]) => s + g.recibido, 0))], [4, suma('totalCop', porRiel.reduce((s, [, g]) => s + g.acreditado, 0))], [5, suma('totalCop', porRiel.reduce((s, [, g]) => s + g.utilidad, 0))]]) });
  }

  // Por mes, o por día si todo cae en un mes.
  const meses = new Set(dc.detalle.filter(d => d.liq && !d.liq.anulado).map(d => mesDe(String(d.created_at))));
  const porDia = meses.size <= 1;
  const tiempo = [...agrupar(dc.detalle, d => (porDia ? diaDe : mesDe)(String(d.created_at))).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (tiempo.length) {
    L.seccion(porDia ? 'Por día' : 'Por mes', 8);
    const t = tabla(L, [porDia ? 'Día' : 'Mes', 'Cargues', 'Acreditado COP', 'Recibido COP', 'Conversiones', 'Convertido COP', 'Utilidad COP'],
      tiempo.map(([p, g]) => [c(porDia ? nombreDia(p) : nombreMes(p), 'texto'), c(g.n, 'entero'), c(g.acreditado, 'cop'), c(g.recibido, 'cop'), c(g.conversiones, 'entero'), c(g.convertido, 'cop'), c(g.utilidad, 'copUtil')]),
      { etiqueta: 'Total', columnas: new Map([[1, suma('totalEntero', tiempo.reduce((s, [, g]) => s + g.n, 0))], [2, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.acreditado, 0))], [3, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.recibido, 0))], [4, suma('totalEntero', tiempo.reduce((s, [, g]) => s + g.conversiones, 0))], [5, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.convertido, 0))], [6, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.utilidad, 0))]]) });
    if (tiempo.length >= 2) {
      L.graficos.push({ tipo: 'columnas', titulo: `Acreditado ${porDia ? 'por día' : 'por mes'} (COP)`, serie: 'Acreditado', colCategorias: 0, colValores: 2, desdeFila: t.desde, hastaFila: t.hasta, formato: FMT_COP, color: VERDE, col: 3, fila: filaG, ancho: 7, alto: ALTO_G });
    }
  }

  // Cada operación contable.
  L.seccion('Operaciones contables (cargues, conversiones y ajustes)', 12);
  const ordenadas = [...dc.detalle].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const filasOps = ordenadas.map(d => {
    const { valores, anotaciones } = filaOperacion(d, fechaDeId);
    valores[16] = anotaciones.join(' · ');
    return valores.map((v, i) => c(v, ESTILOS_OPS[i]));
  });
  if (filasOps.length) {
    const vigentes = ordenadas.map(d => filaOperacion(d, fechaDeId).valores).filter(v => v[3] !== 'Anulado');
    const totalCol = (i: number) => vigentes.reduce((s, v) => s + (typeof v[i] === 'number' ? v[i] : 0), 0);
    const cols = new Map<number, ColTotal>();
    for (const i of SUMA_OPS) {
      cols.set(i, {
        f: (d, h, col) => `SUMIFS(${refCelda(col, d)}:${refCelda(col, h)},${refCelda(3, d)}:${refCelda(3, h)},"<>Anulado")`,
        v: totalCol(i), s: i === 4 || i === 5 ? 'totalUsd' : 'totalCop',
      });
    }
    cols.set(10, suma('totalCop', ordenadas.map(d => filaOperacion(d, fechaDeId).valores[10]).reduce((s: number, v: any) => s + (typeof v === 'number' ? v : 0), 0)));
    const t = tabla(L, COLS_OPS, filasOps, { etiqueta: 'Total (sin anulados)', columnas: cols });
    altoPorAnotaciones(L.altos, L.filas, t.desde, t.hasta, 16);
    // Las tasas del total no son una suma: van como valor.
    if (t.rTotal != null) {
      L.filas[t.rTotal][6] = c(tasas.venta, 'totalTasa');
      L.filas[t.rTotal][8] = c(tasas.cliente, 'totalTasa');
    }
    L.parrafo('Los ajustes vinculados a un cargue no se restan aparte: ya están dentro del cargue que revierten (anulado o corregido). La columna "Ajuste COP" suma solo los ajustes sin vincular y los créditos a favor del cliente.', 'nota', 12, 160);
  } else {
    L.parrafo('Sin cargues, conversiones ni ajustes en el período.', 'nota', 8);
  }

  // Movimientos de la cuenta: por tipo y uno por uno.
  L.seccion('Movimientos de la cuenta por tipo', 9);
  const porTipo = new Map<string, { tipo: string; moneda: string; dir: string; n: number; ok: number; monto: number; comision: number; mal: number; curso: number }>();
  const copPorTipo = new Map<string, number>();
  for (const t of dc.movs) {
    const tipo = TIPOS[txt(t.type)] ?? txt(t.type);
    const moneda = monedaDe(t);
    const key = `${tipo}|${moneda}`;
    const g = porTipo.get(key) ?? { tipo, moneda, dir: direccionDe(t), n: 0, ok: 0, monto: 0, comision: 0, mal: 0, curso: 0 };
    const e = estadoMov(t.status);
    g.n++;
    if (e === 'ok') { g.ok++; g.monto += n0(t.amount); g.comision += n0(t.feeCop ?? t.fee); if (esCop(t.currency)) copPorTipo.set(tipo, (copPorTipo.get(tipo) ?? 0) + n0(t.amount)); }
    else if (e === 'mal') g.mal++; else g.curso++;
    porTipo.set(key, g);
  }
  const tipos = [...porTipo.values()].sort((a, b) => b.monto - a.monto);
  if (tipos.length) {
    tabla(L, ['Tipo', 'Moneda / riel', 'Dirección', 'Movimientos', 'Completados', 'Monto completado', 'Comisiones', 'Rechazados o fallidos', 'En curso'],
      tipos.map(g => [c(g.tipo, 'texto'), c(g.moneda, 'texto'), c(g.dir, 'texto'), c(g.n, 'entero'), c(g.ok, 'entero'), c(g.monto, esCop(g.moneda) ? 'cop' : 'usd'), c(g.comision, 'cop'), c(g.mal, 'entero'), c(g.curso, 'entero')]));
    L.parrafo('El monto completado está en la moneda de cada fila: no se suman pesos con USDT. Lo rechazado o fallido no movió plata.', 'nota', 9, 160);
    const copTipos = [...copPorTipo.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (copTipos.length) {
      L.agregar([]);
      const t = tabla(L, ['Tipo', 'Movido en pesos (completado)'], copTipos.map(([tp, v]) => [c(tp, 'texto'), c(v, 'cop')]));
      if (copTipos.length >= 2) {
        L.graficos.push({ tipo: 'barras', titulo: 'Movido en pesos por tipo (completado)', serie: 'COP', colCategorias: 0, colValores: 1, desdeFila: t.desde, hastaFila: t.hasta, formato: FMT_COP, color: '15181A', col: 11, fila: filaG, ancho: 7, alto: ALTO_G });
      }
    }
  } else {
    L.parrafo('Sin movimientos de la cuenta en el período.', 'nota', 8);
  }

  L.seccion('Movimientos de la cuenta, uno por uno', 16);
  if (dc.movs.length) {
    tabla(L, COLS_MOVS, dc.movs.map(t => filaMov(t).map((v, i) => c(v, ESTILOS_MOVS[i]))));
  }
  if (dc.movsTruncado) L.parrafo('El historial de esta cuenta pasa de 10.000 movimientos: aquí están los más recientes.', 'alerta', 10);

  return {
    nombre: String(k.nombre ?? 'Cliente'),
    filas: L.filas, combinar: L.combinar, altos: L.altos, graficos: L.graficos,
    cabecera: null, fijar: 3, color: VERDE, imprimirAncho: true,
    anchos: [30, 24, 16, 18, 14, 14, 13, 16, 13, 16, 14, 14, 16, 18, 18, 14, 54, 38],
  };
}

// ── Movimientos: una fila por movimiento ──
const COLS_MOVS = ['Fecha', 'Tipo', 'Dirección', 'Estado', 'Moneda / riel', 'Monto', 'Comisión', 'Beneficiario / contraparte', 'Documento', 'Banco / método', 'Cuenta / llave', 'Motivo del envío', 'Motivo del rechazo', 'Referencia del proveedor', 'Descripción', 'Id'];
const ESTILOS_MOVS: Estilo[] = ['fechaHora', 'texto', 'texto', 'texto', 'texto', 'usd', 'usd', 'texto', 'texto', 'texto', 'texto', 'texto', 'texto', 'texto', 'texto', 'texto'];
const filaMov = (t: any): any[] => [
  fechaDe(t), TIPOS[txt(t.type)] ?? txt(t.type), direccionDe(t), txt(t.status), monedaDe(t),
  num(t.amount), num(t.feeCop ?? t.fee),
  txt(t.beneficiary ?? t.recipient?.holderName ?? t.recipientName ?? t.counterparty),
  txt(t.documentNumber ?? t.recipient?.documentNumber),
  txt(t.bank), txt(t.account ?? t.recipient?.key ?? t.recipient?.accountNumber),
  txt(t.motivoTexto ?? t.reason), txt(t.providerError ?? t.errorMessage),
  txt(t.providerRef ?? t.reference ?? t.txHash), txt(t.title), txt(t.id),
];

// Anotaciones de un cliente: lo que hay que mirar, en una línea cada cosa.
function alertasDe(dc: DatosCliente): { tipo: string; detalle: string; monto: number | null }[] {
  const k = dc.c;
  const a: { tipo: string; detalle: string; monto: number | null }[] = [];
  for (const e of dc.errores) a.push({ tipo: 'Datos incompletos', detalle: e, monto: null });
  if (n0(k.enPerdida) > 0) a.push({ tipo: 'Operaciones en pérdida', detalle: `${plural(n0(k.enPerdida), 'operación tiene', 'operaciones tienen')} utilidad negativa por ${pesos(k.perdidaCop)}: se acreditó más de lo que se recibió por la venta. Si es un cargue errado ya descontado, vincula su débito; si los USDT o las tasas están mal, hay que corregir el cargue.`, monto: n0(k.perdidaCop) });
  if (n0(k.ajustes) > 0) a.push({ tipo: 'Ajustes sin vincular', detalle: `${plural(n0(k.ajustes), 'ajuste', 'ajustes')} (débito) por ${pesos(k.ajustadoCop)} sin vincular a un cargue. Si corrigen un cargue hecho por error, vincúlalos para que el cargue quede anulado o corregido.`, monto: -n0(k.ajustadoCop) });
  if (n0(k.facturasDeAnulados) > 0) a.push({ tipo: 'Factura de un cargue anulado', detalle: `${plural(n0(k.facturasDeAnulados), 'cargue anulado ya tenía', 'cargues anulados ya tenían')} factura emitida: anúlala en Siigo o haz la nota crédito.`, monto: null });
  if (n0(k.facturasConError) > 0) a.push({ tipo: 'Facturas con error', detalle: `${plural(n0(k.facturasConError), 'factura quedó', 'facturas quedaron')} con error. El motivo está en la columna Anotaciones de cada operación.`, monto: null });
  if (n0(k.porFacturar) > 0) a.push({ tipo: 'Por facturar', detalle: `${plural(n0(k.porFacturar), 'operación facturable no tiene', 'operaciones facturables no tienen')} factura de Lincoin todavía.`, monto: null });
  if (n0(k.sinUtilidad) > 0) a.push({ tipo: 'Sin utilidad registrada', detalle: `${plural(n0(k.sinUtilidad), 'operación no guardó', 'operaciones no guardaron')} la utilidad. No se facturan solas: hay que confirmarla.`, monto: null });
  if (Math.abs(n0(k.utilidadEstimada)) > 0) a.push({ tipo: 'Utilidad estimada', detalle: `${pesos(k.utilidadEstimada)} de la utilidad es estimada con la tasa de la mesa OTC.`, monto: n0(k.utilidadEstimada) });
  if (n0(k.anulados) > 0) a.push({ tipo: 'Cargues anulados', detalle: `${plural(n0(k.anulados), 'cargue anulado', 'cargues anulados')} con su débito: no suman ni dejan utilidad.`, monto: null });
  const mal = dc.movs.filter(t => estadoMov(t.status) === 'mal');
  if (mal.length) a.push({ tipo: 'Movimientos rechazados o fallidos', detalle: `${plural(mal.length, 'movimiento quedó', 'movimientos quedaron')} rechazado o fallido en el período (no movieron plata).`, monto: null });
  const curso = dc.movs.filter(t => estadoMov(t.status) === 'curso');
  if (curso.length) a.push({ tipo: 'Movimientos en curso', detalle: `${plural(curso.length, 'movimiento sigue', 'movimientos siguen')} pendiente o en proceso.`, monto: null });
  if (dc.movsTruncado) a.push({ tipo: 'Historial cortado', detalle: 'La cuenta tiene más de 10.000 movimientos: el archivo trae los más recientes.', monto: null });
  return a;
}

// Las filas de una misma persona (mismo correo) son una sola.
function unaPorPersona(clientes: any[]) {
  const vistos = new Map<string, any>();
  for (const k of clientes) {
    const clave = String(k.email ?? '').trim().toLowerCase() || String(k.userId);
    if (!vistos.has(clave)) vistos.set(clave, k);
  }
  return [...vistos.values()];
}

export type OpcionesReporte = {
  /** Las filas de clientes del resumen (contabilidad_resumen) que van en el archivo. */
  clientes: any[];
  periodo: { nombre: string; desde?: string; hasta?: string };
  onProgreso?: (hechos: number, total: number) => void;
};

export async function armarReporteContabilidad(o: OpcionesReporte): Promise<{ hojas: Hoja[]; avisos: string[] }> {
  const personas = unaPorPersona(o.clientes);
  const datos: DatosCliente[] = new Array(personas.length);
  let hechos = 0;
  o.onProgreso?.(0, personas.length);
  // De a tres a la vez: rápido sin ahogar al servidor.
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(3, personas.length) }, async () => {
    while (siguiente < personas.length) {
      const i = siguiente++;
      datos[i] = await leerCliente(personas[i], o.periodo.desde, o.periodo.hasta);
      o.onProgreso?.(++hechos, personas.length);
    }
  }));
  datos.sort((a, b) => (n0(b.c.cargadoTotalCop) + n0(b.c.convertidoCop)) - (n0(a.c.cargadoTotalCop) + n0(a.c.convertidoCop)));
  // Un cliente sin operaciones ni movimientos en el rango no lleva hoja: el
  // archivo es del período elegido y nada más.
  for (let i = datos.length - 1; i >= 0; i--) {
    if (!datos[i].detalle.length && !datos[i].movs.length && !datos[i].errores.length) datos.splice(i, 1);
  }

  const hasta = o.periodo.hasta ? new Date(Date.parse(o.periodo.hasta) - 1).toISOString() : new Date().toISOString();
  const rangoTxt = o.periodo.desde ? `${nombreDia(diaDe(o.periodo.desde))} a ${nombreDia(diaDe(hasta))}` : 'todo el historial';
  const generado = new Date().toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const periodoTxt = `${o.periodo.nombre} (${rangoTxt}) · generado el ${generado}`;

  const alertas = datos.map(alertasDe);
  const avisos = datos.flatMap(d => d.errores.map(e => `${d.c.nombre}: ${e}`));

  // ── Resumen ──
  const R = new Lienzo();
  R.encabezado('Contabilidad Lincoin', periodoTxt);
  const T = (campo: string) => datos.reduce((s, d) => s + n0(d.c[campo]), 0);
  const util = T('utilidadCargues') + T('utilidadConversiones');
  const todos = datos.flatMap(d => d.detalle);
  const tasas = tasasPromedio(todos);
  const movsTodos = datos.flatMap(d => d.movs.map(t => ({ t, d })));
  const inicioBloque = R.fila;
  R.seccion('Totales del período', 2);
  R.indicadores([
    ['Clientes', datos.length, 'kpiEntero'],
    ['Cargues vigentes', T('cargues'), 'kpiEntero'],
    ['Cargues anulados', T('anulados'), 'kpiEntero'],
    ['USDT que entró', T('usdCargado'), 'kpiUsd'],
    ['USDT que llegó', datos.reduce((s, d) => s + n0(d.c.usdLlego ?? d.c.usdCargado), 0), 'kpiUsd'],
    ['Recibido por la venta (COP)', T('cargadoTotalCop'), 'kpiCop'],
    ['Tasa promedio de venta', tasas.venta, 'kpiTasa'],
    ['Acreditado a clientes (COP)', T('cargadoCop'), 'kpiCop'],
    ['Tasa promedio al cliente', tasas.cliente, 'kpiTasa'],
    ['Comisión Bre-B (COP)', T('comisionBrebCop'), 'kpiCop'],
    ['Utilidad de cargues', T('utilidadCargues'), 'kpiCop'],
    ['Conversiones', T('conversiones'), 'kpiEntero'],
    ['Convertido (COP)', T('convertidoCop'), 'kpiCop'],
    ['USD convertido', T('usdConvertido'), 'kpiUsd'],
    ['Utilidad de conversiones', T('utilidadConversiones'), 'kpiCop'],
    ['Utilidad neta Lincoin', util, 'kpiCop'],
    ['Ganancias', T('gananciaCop'), 'kpiCop'],
    ['Pérdidas', T('perdidaCop'), 'kpiCop'],
    ['Operaciones en pérdida', T('enPerdida'), 'kpiEntero'],
    ['Utilidad estimada (mesa OTC)', T('utilidadEstimada'), 'kpiCop'],
    ['Facturas emitidas', T('facturadas'), 'kpiEntero'],
    ['Facturado (COP)', T('facturadoCop'), 'kpiCop'],
    ['Por facturar', T('porFacturar'), 'kpiEntero'],
    ['Facturas con error', T('facturasConError'), 'kpiEntero'],
    ['Ajustes sin vincular', T('ajustes'), 'kpiEntero'],
    ['Ajustes sin vincular (COP)', T('ajustadoCop'), 'kpiCop'],
    ['Movimientos de las cuentas', movsTodos.length, 'kpiEntero'],
    ['Anotaciones por revisar', alertas.reduce((s, a) => s + a.length, 0), 'kpiEntero'],
  ]);
  const ALTO_G = 16;
  const filaG = inicioBloque + 1;
  R.hasta(Math.max(R.fila, filaG + 2 * ALTO_G + 1) + 1);

  // Por cliente.
  R.seccion('Por cliente', 12);
  const filasCli = datos.map(d => {
    const k = d.c;
    const u = n0(k.utilidadCargues) + n0(k.utilidadConversiones);
    return [c(k.nombre, 'texto'), c(k.documento ?? '', 'texto'), c(k.email ?? '', 'texto'), c(n0(k.cargues), 'entero'), c(n0(k.anulados), 'entero'),
      c(n0(k.usdCargado), 'usd'), c(n0(k.cargadoTotalCop), 'cop'), c(n0(k.cargadoCop), 'cop'), c(n0(k.utilidadCargues), 'copUtil'),
      c(n0(k.conversiones), 'entero'), c(n0(k.convertidoCop), 'cop'), c(n0(k.utilidadConversiones), 'copUtil'), c(u, 'copUtil'),
      c(util ? u / util : null, 'pct'), c(n0(k.enPerdida), 'entero'), c(n0(k.ajustes), 'entero'), c(n0(k.facturadas), 'entero'),
      c(n0(k.facturadoCop), 'cop'), c(n0(k.porFacturar), 'entero'), c(d.movs.length, 'entero'), c(aFecha(k.ultima), 'fechaHora')];
  });
  const sumaCampo = (campo: string) => datos.reduce((s, d) => s + n0(d.c[campo]), 0);
  const tCli = tabla(R, ['Cliente', 'Documento', 'Correo', 'Cargues', 'Anulados', 'USDT entró', 'Recibido COP', 'Acreditado COP', 'Utilidad cargues', 'Conversiones', 'Convertido COP', 'Utilidad conversiones', 'Utilidad neta', '% de la utilidad', 'En pérdida', 'Ajustes sin vincular', 'Facturas emitidas', 'Facturado COP', 'Por facturar', 'Movimientos', 'Última operación'],
    filasCli, { etiqueta: 'Total', columnas: new Map([
      [3, suma('totalEntero', sumaCampo('cargues'))], [4, suma('totalEntero', sumaCampo('anulados'))], [5, suma('totalUsd', sumaCampo('usdCargado'))],
      [6, suma('totalCop', sumaCampo('cargadoTotalCop'))], [7, suma('totalCop', sumaCampo('cargadoCop'))], [8, suma('totalCop', sumaCampo('utilidadCargues'))],
      [9, suma('totalEntero', sumaCampo('conversiones'))], [10, suma('totalCop', sumaCampo('convertidoCop'))], [11, suma('totalCop', sumaCampo('utilidadConversiones'))],
      [12, suma('totalCop', util)], [13, suma('totalPct', util ? 1 : null)], [14, suma('totalEntero', sumaCampo('enPerdida'))], [15, suma('totalEntero', sumaCampo('ajustes'))],
      [16, suma('totalEntero', sumaCampo('facturadas'))], [17, suma('totalCop', sumaCampo('facturadoCop'))], [18, suma('totalEntero', sumaCampo('porFacturar'))],
      [19, suma('totalEntero', movsTodos.length)],
    ]) });
  if (datos.length >= 2) {
    R.graficos.push({ tipo: 'barras', titulo: 'Utilidad neta por cliente (COP)', serie: 'Utilidad neta', colCategorias: 0, colValores: 12, desdeFila: tCli.desde, hastaFila: tCli.hasta, formato: FMT_COP, color: VERDE, col: 3, fila: filaG, ancho: 7, alto: ALTO_G });
    R.graficos.push({ tipo: 'barras', titulo: 'Acreditado por cliente (COP)', serie: 'Acreditado', colCategorias: 0, colValores: 7, desdeFila: tCli.desde, hastaFila: tCli.hasta, formato: FMT_COP, color: '15181A', col: 3, fila: filaG + ALTO_G + 1, ancho: 7, alto: ALTO_G });
  }

  // Por riel (cargues).
  const porRiel = [...agrupar(todos, d => String(d.riel || 'Sin riel'), true).entries()].sort((a, b) => b[1].acreditado - a[1].acreditado);
  if (porRiel.length) {
    R.seccion('Cargues por riel', 8);
    const totAcr = porRiel.reduce((s, [, g]) => s + g.acreditado, 0);
    const t = tabla(R, ['Riel', 'Cargues', 'USDT', 'Recibido COP', 'Acreditado COP', 'Utilidad COP', '% del acreditado'],
      porRiel.map(([r, g]) => [c(r, 'texto'), c(g.n, 'entero'), c(g.usd, 'usd'), c(g.recibido, 'cop'), c(g.acreditado, 'cop'), c(g.utilidad, 'copUtil'), c(totAcr ? g.acreditado / totAcr : null, 'pct')]),
      { etiqueta: 'Total', columnas: new Map([[1, suma('totalEntero', porRiel.reduce((s, [, g]) => s + g.n, 0))], [2, suma('totalUsd', porRiel.reduce((s, [, g]) => s + g.usd, 0))], [3, suma('totalCop', porRiel.reduce((s, [, g]) => s + g.recibido, 0))], [4, suma('totalCop', totAcr)], [5, suma('totalCop', porRiel.reduce((s, [, g]) => s + g.utilidad, 0))], [6, suma('totalPct', totAcr ? 1 : null)]]) });
    if (porRiel.length >= 2) R.graficos.push({ tipo: 'barras', titulo: 'Acreditado por riel (COP)', serie: 'Acreditado', colCategorias: 0, colValores: 4, desdeFila: t.desde, hastaFila: t.hasta, formato: FMT_COP, color: '15181A', col: 11, fila: filaG + ALTO_G + 1, ancho: 7, alto: ALTO_G });
  }

  // Por mes, o por día si todo es de un mes.
  const meses = new Set(todos.filter(d => d.liq && !d.liq.anulado).map(d => mesDe(String(d.created_at))));
  const porDia = meses.size <= 1;
  const tiempo = [...agrupar(todos, d => (porDia ? diaDe : mesDe)(String(d.created_at))).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (tiempo.length) {
    R.seccion(porDia ? 'Por día' : 'Por mes', 8);
    const t = tabla(R, [porDia ? 'Día' : 'Mes', 'Cargues', 'USDT', 'Recibido COP', 'Acreditado COP', 'Conversiones', 'Convertido COP', 'Utilidad COP'],
      tiempo.map(([p, g]) => [c(porDia ? nombreDia(p) : nombreMes(p), 'texto'), c(g.n, 'entero'), c(g.usd, 'usd'), c(g.recibido, 'cop'), c(g.acreditado, 'cop'), c(g.conversiones, 'entero'), c(g.convertido, 'cop'), c(g.utilidad, 'copUtil')]),
      { etiqueta: 'Total', columnas: new Map([[1, suma('totalEntero', tiempo.reduce((s, [, g]) => s + g.n, 0))], [2, suma('totalUsd', tiempo.reduce((s, [, g]) => s + g.usd, 0))], [3, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.recibido, 0))], [4, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.acreditado, 0))], [5, suma('totalEntero', tiempo.reduce((s, [, g]) => s + g.conversiones, 0))], [6, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.convertido, 0))], [7, suma('totalCop', tiempo.reduce((s, [, g]) => s + g.utilidad, 0))]]) });
    if (tiempo.length >= 2) R.graficos.push({ tipo: 'columnas', titulo: `Utilidad ${porDia ? 'por día' : 'por mes'} (COP)`, serie: 'Utilidad', colCategorias: 0, colValores: 7, desdeFila: t.desde, hastaFila: t.hasta, formato: FMT_COP, color: VERDE, col: 11, fila: filaG, ancho: 7, alto: ALTO_G });
  }
  R.parrafo('Los totales no incluyen los cargues anulados ni sus reversas. La utilidad neta es lo recibido por la venta menos lo acreditado al cliente (en conversiones, la diferencia de tasa), con las pérdidas restadas. El detalle de cada cliente está en su hoja; las fórmulas de los totales se recalculan al abrir.', 'nota', 12, 170);

  // ── Anotaciones ──
  const A = new Lienzo();
  A.encabezado('Anotaciones', periodoTxt);
  A.seccion('Lo que hay que revisar', 5);
  const filasAl = datos.flatMap((d, i) => alertas[i].map(x => [c(d.c.nombre, 'textoAjustado'), c(x.tipo, 'textoAjustado'), c(x.detalle, 'textoAjustado'), c(x.monto, 'cop')]));
  if (filasAl.length) {
    const t = tabla(A, ['Cliente', 'Qué', 'Detalle', 'Monto COP'], filasAl);
    for (let r = t.desde; r <= t.hasta; r++) A.altos[r] = Math.max(15, 14 * Math.ceil(String((A.filas[r][2] as any)?.v ?? '').length / 95) + 4);
  } else A.parrafo('Nada pendiente en el período.', 'nota', 4);
  A.seccion('Cómo leer este archivo', 5);
  for (const [k, v] of [
    ['Recibido por la venta', 'Lo que se recibió en pesos por vender los USDT que mandó el cliente.'],
    ['Acreditado al cliente', 'Lo que se le cargó al saldo del cliente en Lincoin.'],
    ['Utilidad', 'Recibido menos acreditado (y menos la comisión Bre-B si aplica). En conversiones, la diferencia de tasa. Puede ser negativa: eso es una pérdida.'],
    ['Tasa de venta / tasa al cliente', 'Recibido sobre los USDT que llegaron / acreditado (más comisión Bre-B) sobre los USDT que entraron. En el total, solo cargues.'],
    ['Anulado', 'Cargue revertido completo por un débito vinculado: no suma ni deja utilidad, y su débito no se resta aparte.'],
    ['Corregido', 'Cargue revertido en parte por un débito vinculado: suma lo que quedó.'],
    ['Ajuste sin vincular', 'Débito que no se ha asociado a un cargue. No suma en los totales del cliente hasta vincularlo.'],
    ['Utilidad estimada', 'Calculada con la tasa de la mesa OTC porque la operación no guardó la suya.'],
    ['Movimientos de la cuenta', 'Envíos, pagos, retiros, cargues y conversiones de la cuenta en el período. Lo rechazado o fallido no movió plata.'],
    ['Fechas', 'En la hora del computador que descargó el archivo. Los meses y días de los totales son los de Colombia.'],
  ]) {
    const r = A.agregar([c(k, 'etiqueta'), c(null, 'etiqueta'), c(v, 'textoAjustado')]);
    A.combinar.push(`${refCelda(0, r)}:${refCelda(1, r)}`);
  }

  // ── Operaciones (todas) ──
  const filasTodas: CeldaX[][] = [];
  for (const d of datos) {
    const fechaDeId = (id: string) => { const x = d.detalle.find(y => String(y.id) === id); return x ? fechaCorta(x.created_at) : ''; };
    for (const op of [...d.detalle].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
      const { valores, anotaciones } = filaOperacion(op, fechaDeId);
      valores[16] = anotaciones.join(' · ');
      filasTodas.push([c(d.c.nombre, 'texto'), ...valores.map((v, i) => c(v, ESTILOS_OPS[i]))]);
    }
  }
  const hojaOps: Hoja = {
    nombre: 'Operaciones', color: '6B716C', cabecera: null, fijar: 1, imprimirAncho: true,
    filas: [['Cliente', ...COLS_OPS].map(h => c(h, 'th')), ...filasTodas],
    filtro: filasTodas.length ? `A1:${refCelda(COLS_OPS.length, filasTodas.length)}` : null,
    altos: { 0: 30 },
    anchos: [28, 18, 22, 14, 18, 12, 12, 12, 16, 12, 16, 14, 14, 16, 18, 18, 14, 54, 38],
  };
  altoPorAnotaciones(hojaOps.altos!, hojaOps.filas, 1, filasTodas.length, 17);

  // ── Movimientos (todos) ──
  const filasMovs = movsTodos.map(({ t, d }) => [c(d.c.nombre, 'texto'), ...filaMov(t).map((v, i) => c(v, ESTILOS_MOVS[i]))]);
  const hojaMovs: Hoja = {
    nombre: 'Movimientos', color: '6B716C', cabecera: null, fijar: 1, imprimirAncho: true,
    filas: [['Cliente', ...COLS_MOVS].map(h => c(h, 'th')), ...filasMovs],
    filtro: filasMovs.length ? `A1:${refCelda(COLS_MOVS.length, filasMovs.length)}` : null,
    altos: { 0: 30 },
    anchos: [28, 18, 20, 11, 12, 24, 16, 12, 30, 16, 22, 22, 24, 30, 30, 30, 38],
  };

  const hojas: Hoja[] = [
    { nombre: 'Resumen', filas: R.filas, combinar: R.combinar, altos: R.altos, graficos: R.graficos, cabecera: null, fijar: 3, color: '15181A', imprimirAncho: true,
      anchos: [32, 20, 28, 16, 16, 16, 17, 17, 16, 16, 17, 16, 16, 13, 12, 13, 13, 17, 12, 13, 18] },
    { nombre: 'Anotaciones', filas: A.filas, combinar: A.combinar, altos: A.altos, cabecera: null, fijar: 3, color: 'B45309', imprimirAncho: true, anchos: [30, 28, 90, 16, 12] },
    hojaOps,
    hojaMovs,
    ...datos.map((d, i) => hojaCliente(d, periodoTxt, alertas[i].map(x => `${x.tipo}: ${x.detalle}`))),
  ];
  return { hojas, avisos };
}

/** Arma el informe y lo descarga. */
export async function descargarReporteContabilidad(o: OpcionesReporte): Promise<{ avisos: string[] }> {
  const { hojas, avisos } = await armarReporteContabilidad(o);
  const bytes = armarXlsx(hojas);
  const unico = o.clientes.length === 1 ? String(o.clientes[0]?.nombre ?? 'cliente') : o.periodo.nombre;
  const slug = unico.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'contabilidad';
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME_XLSX }));
  const el = document.createElement('a');
  el.href = url;
  el.download = `lincoin-contabilidad-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { avisos };
}
