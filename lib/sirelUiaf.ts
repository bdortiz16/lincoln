// ════════════════════════════════════════════════════════
// Archivos planos de la UIAF para SIREL (Resolución 314 de 2021, PSAV).
//
// 24 nov, el dueño: "modifica el descargar el Excel, si transacciones o
// clientes, porque en la UIAF es un solo archivo, y recuerda buscar el
// formato de la UIAF". En SIREL se carga UN archivo por reporte, con la
// plantilla de la UIAF, no un Excel con dos hojas. Aquí se arma cada archivo
// tal como lo piden los documentos técnicos oficiales (junio de 2022):
//
//   · Anexo 2 – Reporte de clientes PSAV        → CPSV<código><MM><AA>.txt
//   · Anexo 3 – Reporte de transacciones PSAV   → TPSV<código><MM><AA>.txt
//
// Ambos: texto ANSI CP1252, campos separados por "|", un encabezado de 39
// posiciones, el cuerpo (un registro por línea) y una cola de 39 posiciones.
// Letras en mayúscula; los números sin separador de miles y con punto
// decimal; sin ceros de relleno en lo alfanumérico.
//
// Lo que no está guardado NO se completa: el campo sale vacío y la fila dice
// qué falta. SIREL rechaza el cargue con un campo vacío, y eso es mejor que
// un dato supuesto en un reporte a la UIAF. El -1 se usa solo donde el anexo
// lo pide para "no aplica / no se conoce".
// ════════════════════════════════════════════════════════

import { codigoPais } from './banderaPais';

// Anexo 3, numeral 2: transacciones múltiples (por cliente en el mes) y
// transacciones individuales.
export const UMBRAL_MULTIPLE_USD = 450;
export const UMBRAL_INDIVIDUAL_USD = 150;

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── Tablas de códigos de los anexos ─────────────────────────

// Tipo de identificación (Anexo 2 §7.1, Anexo 3 §7.2).
export function codigoTipoId(tipo: unknown): string | null {
  const t = sinTildes(String(tipo ?? '')).toUpperCase().replace(/[^A-Z]/g, '');
  if (!t) return null;
  if (t === 'CC' || t === 'CEDULA' || t === 'CEDULADECIUDADANIA') return '13';
  if (t === 'CE' || t === 'CEDULADEEXTRANJERIA') return '22';
  if (t === 'NIT') return '31';
  if (t === 'TI' || t === 'TARJETADEIDENTIDAD') return '12';
  if (t === 'RC' || t === 'REGISTROCIVIL') return '11';
  if (t === 'TE' || t === 'TARJETADEEXTRANJERIA') return '21';
  if (t === 'PA' || t === 'PP' || t === 'PAS' || t === 'PASAPORTE' || t === 'PASSPORT') return '41';
  // "Otro tipo de identificación nacional (carné diplomático, permiso especial de permanencia y otros)".
  if (t === 'PEP' || t === 'PPT' || t === 'CD' || t === 'CARNEDIPLOMATICO') return '00';
  // "Documento de identificación extranjero" (DNI, RUT de Chile, CPF…).
  if (t === 'DNI' || t === 'RUT' || t === 'RUC' || t === 'CPF' || t === 'CNPJ' || t === 'DE' || t === 'NIE' || t === 'EXTRANJERO') return '42';
  return null;
}

// Tipo de transacción (Anexo 3 §7.1), desde el lado del cliente:
//  · depósito de USDT a Lincoin → 1 Recaudo ("el cliente acredita en la PSAV"),
//    con medio de pago 4 (activo virtual);
//  · compra / venta de USDT contra pesos → 2 / 3;
//  · envío de USDT a otra wallet → 5 Transferencia ("a otra billetera o
//    dirección de depósito"). El 6 (Retiro, "instrucción de monetización")
//    en Lincoin es la venta: ya va como 3.
export const TIPO_TRANSACCION: Record<string, { codigo: string; nombre: string; medioPago: string }> = {
  deposito: { codigo: '1', nombre: 'Recaudo', medioPago: '4' },
  compra: { codigo: '2', nombre: 'Compra de activos virtuales', medioPago: '-1' },
  venta: { codigo: '3', nombre: 'Venta de activos virtuales', medioPago: '-1' },
  retiro: { codigo: '5', nombre: 'Transferencia de activos virtuales', medioPago: '-1' },
};

// ── Formato de los campos ───────────────────────────────────

// Alfanumérico: los caracteres que admite la Figura 1 (espacio, A-Z, 0-9,
// Œ, Ž y las letras con tilde de las lenguas romances), en mayúscula. El
// Anexo 2 además pide sin puntos ni guiones ("S.A.S." → "SAS"). Lo demás
// (comas, &, comillas, "|") se vuelve espacio.
const ALFA_OK = /^[ A-Z0-9ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝŒŽ]$/;
export function alfa(v: unknown): string {
  const s = String(v ?? '').toUpperCase().replace(/[.\-]/g, '');
  let out = '';
  for (const ch of s) out += ALFA_OK.test(ch) ? ch : ' ';
  return out.replace(/\s+/g, ' ').trim();
}
// Documento, número de cliente: sin guiones, puntos, comas ni espacios.
export const sinSeparadores = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Wallet y hash: tal cual (la dirección distingue mayúsculas), sin separadores.
export const codigoCadena = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9]/g, '');
export const correo = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/[\s|]/g, '');
// Celular: solo dígitos; un móvil de Colombia con el 57 adelante queda en sus 10 dígitos.
export function celular(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '');
  return /^573\d{9}$/.test(d) ? d.slice(2) : d;
}
// Número con punto decimal, sin miles ni notación científica.
export function decimal(n: number, max = 8): string {
  const s = n.toFixed(max).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
export const entero = (n: number) => String(Math.round(n));
export const diaBogota = (iso: unknown): string | null => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? new Date(t - 5 * 3600_000).toISOString().slice(0, 10) : null;
};

// ── Archivo ─────────────────────────────────────────────────

export const codigoEntidadValido = (c: unknown) => /^[0-9A-Z]{8}$/.test(String(c ?? ''));
export const ultimoDiaMes = (mes: string) => {
  const [y, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

// Encabezado y cola (Cuadros 1 y 3): posiciones fijas, 39 en total. Los
// campos numéricos van alineados a la derecha sin espacios (relleno con 0).
export function encabezado(codigo: string, fechaCorte: string, total: number): string {
  return '0'.padStart(10, '0') + codigo.padEnd(8, ' ').slice(0, 8) + fechaCorte + String(total).padStart(10, '0') + 'X';
}
export function cola(codigo: string, total: number): string {
  return '0'.padStart(10, '0') + codigo.padEnd(8, ' ').slice(0, 8) + String(total).padStart(10, '0') + 'X'.repeat(11);
}

export type FilaUiaf = { campos: string[]; faltan: string[]; ref: string; titulo: string };

// "CPSV" o "TPSV" + SSTTTCCC + MM + AA, extensión .txt.
export function nombreArchivo(prefijo: 'CPSV' | 'TPSV', codigo: string, mes: string): string {
  return `${prefijo}${codigo}${mes.slice(5, 7)}${mes.slice(2, 4)}.txt`;
}

export function contenidoArchivo(codigo: string, mes: string, filas: FilaUiaf[]): string {
  const lineas = [
    encabezado(codigo, ultimoDiaMes(mes), filas.length),
    ...filas.map((f, i) => [String(i + 1), ...f.campos.slice(1)].join('|')),
    cola(codigo, filas.length),
  ];
  return lineas.join('\r\n');
}

// Texto → bytes en Windows-1252 ("ANSI CP1252", lo que pide el anexo). Lo
// que no existe en CP1252 sale como "?" (no debería llegar: alfa() ya lo quitó).
const CP1252_EXTRA: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};
export function aCp1252(texto: string): Uint8Array {
  const out: number[] = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out.push(c);
    else out.push(CP1252_EXTRA[c] ?? 0x3F);
  }
  return Uint8Array.from(out);
}

// ── Reporte de clientes (Anexo 2) ───────────────────────────

export type ClienteUiaf = {
  userId: string; tipoPersona: 'juridica' | 'natural'; tipoDocumento: string; documento: string | null;
  nombre: string | null; pais: string | null; municipioCodigo: string | null; municipio?: string | null;
  correo: string | null; telefono: string | null; vinculadoAt: string | null;
  wallets?: { address: string; red: string | null }[];
};

export const numeroCliente = (userId: string) => sinSeparadores(userId);

// Nombres y apellidos. Persona jurídica: la razón social en "Nombres" y -1 en
// "Apellidos" (el anexo no trae un campo de razón social; el -1 es su forma de
// decir "no aplica"). Persona natural: el registro guarda el nombre completo
// en un solo campo y partirlo sería adivinar: va en "Nombres" y se avisa.
export function nombresApellidos(c: { tipoPersona: string; nombre: string | null }): { nombres: string; apellidos: string; faltan: string[] } {
  const n = alfa(c.nombre);
  if (!n) return { nombres: '', apellidos: c.tipoPersona === 'juridica' ? '-1' : '', faltan: [c.tipoPersona === 'juridica' ? 'razón social' : 'nombre'] };
  if (c.tipoPersona === 'juridica') return { nombres: n, apellidos: '-1', faltan: [] };
  return { nombres: n, apellidos: '', faltan: ['apellidos aparte del nombre'] };
}

// Nacionalidad (ISO alfa-2) y ciudad (DANE; 00099 si es del exterior).
export function nacionalidadCiudad(c: { pais: string | null; municipioCodigo: string | null; municipio?: string | null }): { nacionalidad: string; ciudad: string; faltan: string[] } {
  const faltan: string[] = [];
  const iso = codigoPais(c.pais);
  if (!iso) faltan.push(c.pais ? `país (dice "${c.pais}")` : 'país');
  let ciudad = '';
  if (iso && iso !== 'CO') ciudad = '00099';
  else if (c.municipioCodigo && /^\d{5}$/.test(c.municipioCodigo)) ciudad = c.municipioCodigo;
  else faltan.push(c.municipio ? `municipio DANE (dice "${c.municipio}")` : 'municipio DANE');
  return { nacionalidad: iso ?? '', ciudad, faltan };
}

function datosCliente(c: ClienteUiaf) {
  const faltan: string[] = [];
  const tipoId = codigoTipoId(c.tipoDocumento);
  if (!tipoId) faltan.push(`tipo de documento sin código UIAF (${c.tipoDocumento || 'vacío'})`);
  const numId = sinSeparadores(c.documento);
  if (!numId) faltan.push(c.tipoPersona === 'juridica' ? 'NIT' : 'documento');
  const na = nombresApellidos(c);
  const nc = nacionalidadCiudad(c);
  return { tipoId: tipoId ?? '', numId, ...na, ...nc, faltan: [...faltan, ...na.faltan, ...nc.faltan] };
}

export function filasClientes(clientes: ClienteUiaf[]): FilaUiaf[] {
  const filas: FilaUiaf[] = [];
  for (const c of clientes) {
    const d = datosCliente(c);
    const vinc = diaBogota(c.vinculadoAt);
    const mail = correo(c.correo);
    const cel = celular(c.telefono);
    const base: string[] = [];
    if (!vinc) base.push('fecha de vinculación');
    if (!mail) base.push('correo');
    if (!cel) base.push('celular');
    // Una fila por billetera; sin billetera, una sola con -1 ("la naturaleza
    // de las operaciones no requiere un número wallet").
    const wallets = (c.wallets ?? []).map(w => codigoCadena(w.address)).filter(Boolean);
    for (const w of wallets.length ? wallets : ['-1']) {
      filas.push({
        ref: c.userId, titulo: c.nombre ?? c.documento ?? c.userId,
        campos: ['', vinc ?? '', numeroCliente(c.userId), d.tipoId, d.numId, d.nombres, d.apellidos, d.nacionalidad, d.ciudad, w, mail, cel],
        faltan: [...d.faltan, ...base],
      });
    }
  }
  return filas;
}

// ── Reporte de transacciones (Anexo 3) ──────────────────────

export type OperacionUiaf = {
  id: string; userId: string; fecha: string; dia?: string | null; tipo: string; activo: string; cantidad: number;
  valorUsd: number | null; tcrm?: number | null; saldoAv?: number | null; saldoMotivo?: string | null;
  walletCliente: string | null; walletContraparte: string | null; hash: string | null; origen: string;
};

export type Seleccion<T> = { op: T; criterio: 'multiple' | 'individual' };

// Primero las múltiples (un cliente que en el mes suma ≥ USD 450: van TODAS
// sus operaciones, una por una), después las individuales ≥ USD 150 que no
// entraron como múltiples. Lo que no tiene valor en dólares no se puede
// medir contra el umbral: queda aparte y la pantalla lo avisa.
export function seleccionarOperaciones<T extends OperacionUiaf>(ops: T[]): { reportadas: Seleccion<T>[]; fuera: T[]; sinUsd: T[] } {
  const conUsd = ops.filter(o => o.valorUsd != null);
  const sinUsd = ops.filter(o => o.valorUsd == null);
  const orden = (a: T, b: T) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id);
  const suma = new Map<string, number>();
  for (const o of conUsd) suma.set(o.userId, (suma.get(o.userId) ?? 0) + (o.valorUsd as number));
  const multiples = new Set(Array.from(suma.entries()).filter(([, v]) => v >= UMBRAL_MULTIPLE_USD).map(([k]) => k));
  // Clientes en el orden de su primera operación; sus operaciones por fecha.
  const primera = new Map<string, string>();
  for (const o of [...conUsd].sort(orden)) if (!primera.has(o.userId)) primera.set(o.userId, o.fecha);
  const reportadas: Seleccion<T>[] = conUsd.filter(o => multiples.has(o.userId))
    .sort((a, b) => (primera.get(a.userId)!).localeCompare(primera.get(b.userId)!) || a.userId.localeCompare(b.userId) || orden(a, b))
    .map(op => ({ op, criterio: 'multiple' as const }));
  const individuales = conUsd.filter(o => !multiples.has(o.userId) && (o.valorUsd as number) >= UMBRAL_INDIVIDUAL_USD).sort(orden);
  reportadas.push(...individuales.map(op => ({ op, criterio: 'individual' as const })));
  const dentro = new Set(reportadas.map(r => r.op.id));
  return { reportadas, fuera: conUsd.filter(o => !dentro.has(o.id)).sort(orden), sinUsd };
}

// Una conversión dentro de la app no pasa por la cadena: no hay otra wallet
// ni hash ("en caso de que la operación no involucre la billetera, -1").
const esInterna = (o: OperacionUiaf) => o.origen === 'Conversión en la app';

export function filaOperacion(o: OperacionUiaf, c: ClienteUiaf | null): FilaUiaf {
  const faltan: string[] = [];
  const tipo = TIPO_TRANSACCION[o.tipo];
  if (!tipo) faltan.push(`tipo de operación sin código (${o.tipo})`);
  const d = c ? datosCliente(c) : null;
  if (!d) faltan.push('datos del cliente');
  else faltan.push(...d.faltan);
  const dia = o.dia ?? diaBogota(o.fecha);
  if (!dia) faltan.push('fecha');
  const interna = esInterna(o);

  const walletCli = codigoCadena(o.walletCliente) || (interna ? '-1' : '');
  if (!walletCli) faltan.push('wallet del cliente');
  const hash = codigoCadena(o.hash) || (interna ? '-1' : '');
  if (!hash) faltan.push('hash');
  const walletContra = codigoCadena(o.walletContraparte) || (interna ? '-1' : '');
  if (!walletContra) faltan.push('wallet contraparte');

  // Valor en pesos a la TCRM del día (USDT y USDC a un dólar).
  const tcrm = o.tcrm ?? null;
  let valorCop = '';
  if (o.valorUsd == null) faltan.push('valor en USD');
  else if (!tcrm) faltan.push('TCRM del día');
  else valorCop = entero(o.valorUsd * tcrm);

  // Saldo del activo después de la operación y su equivalente en pesos.
  let saldoAv = '', saldoCop = '';
  if (o.saldoAv == null) faltan.push(`saldo después${o.saldoMotivo ? ` (${o.saldoMotivo})` : ''}`);
  else {
    saldoAv = decimal(o.saldoAv);
    if (!tcrm || (o.activo !== 'USDT' && o.activo !== 'USDC')) faltan.push('saldo en pesos');
    else saldoCop = entero(o.saldoAv * tcrm);
  }

  return {
    ref: o.id, titulo: c?.nombre ?? o.userId,
    campos: [
      '', dia ?? '', tipo?.codigo ?? '', numeroCliente(o.userId), d?.tipoId ?? '', d?.numId ?? '', d?.nombres ?? '', d?.apellidos ?? '',
      d?.nacionalidad ?? '', d?.ciudad ?? '', tipo?.medioPago ?? '', walletCli, hash, alfa(o.activo), decimal(o.cantidad), valorCop, saldoAv, saldoCop,
      walletContra,
      // Contraparte: Lincoin no guarda su identificación, nombre, país ni su
      // PSAV; el anexo pide -1 cuando no es posible obtener la información.
      '-1', '-1', '-1', '-1', '-1', '-1', '-1',
    ],
    faltan,
  };
}

// Cabeceras de los Excel de revisión: las mismas columnas del archivo, en orden.
export const COLUMNAS_CLIENTES = ['Consecutivo', 'Fecha de vinculación', 'Número del cliente', 'Tipo de identificación', 'Número de identificación', 'Nombres', 'Apellidos', 'Nacionalidad', 'Ciudad residencia (DANE)', 'Número wallet', 'Correo electrónico', 'Número celular'];
export const COLUMNAS_TRANSACCIONES = ['Consecutivo', 'Fecha de la transacción', 'Tipo de transacción', 'Número del cliente', 'Tipo de identificación', 'Número de identificación', 'Nombres', 'Apellidos', 'Nacionalidad', 'Ciudad domicilio (DANE)', 'Medio de pago', 'Número wallet', 'Código hash', 'Tipo de activo virtual', 'Cantidad de activos virtuales', 'Valor en pesos (TCRM)', 'Saldo activo virtual', 'Saldo en pesos', 'Wallet contraparte', 'Tipo id. contraparte', 'Número id. contraparte', 'Nombres contraparte', 'Apellidos contraparte', 'Nacionalidad contraparte', 'Entidad PSAV contraparte', 'País PSAV contraparte'];
