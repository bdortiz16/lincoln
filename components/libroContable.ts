// ══════════════════════════════════════════════════════════════════
//  El libro de una cuenta: asientos, terceros y estado de cuenta.
//
//  Lo comparten la pantalla de Contabilidad, su Excel y el estado de cuenta
//  en PDF, para que los tres cuenten igual la misma plata.
//
//  EL COSTO DEL ENVÍO TAMBIÉN SALE. Un envío en pesos debita el monto más su
//  costo (feeCop): el beneficiario recibe el monto, la cuenta pierde los dos.
//  Si el saldo solo restara el monto, el estado de cuenta terminaría con más
//  plata de la que la cuenta tiene. Va como columna aparte, porque para la
//  contadora es un gasto, no un pago a un tercero.
// ══════════════════════════════════════════════════════════════════

export type Moneda = 'COP' | 'USD';
export type Dir = 'in' | 'out';

export const TIPO_ES: Record<string, string> = {
  load: 'Depósito', send: 'Retiro', dispersion: 'Envío', convert: 'Conversión', tx_created: 'Conversión',
  pay_received: 'Pago recibido', pay_sent: 'Pago enviado', otc_deposit: 'Depósito OTC', otc_withdraw: 'Retiro OTC',
};
export const ENTRA = new Set(['load', 'pay_received', 'otc_deposit']);
export const SALE = new Set(['send', 'dispersion', 'pay_sent', 'otc_withdraw']);
export const familia = (cur: any): Moneda => (String(cur ?? '').toUpperCase().startsWith('COP') ? 'COP' : 'USD');
export const cuando = (t: any) => new Date(t?.createdAt ?? t?.created_at ?? t?.date ?? 0).getTime() || 0;
export const cuenta = (t: any) => t?.status === 'Completado' || t?.status === 'Procesando';

// Un asiento: una entrada o una salida, en una moneda. Una operación normal
// es un asiento; una conversión son dos. `costo` es lo que la cuenta pagó
// aparte por esa salida (solo envíos en pesos).
export type Asiento = { tx: any; dir: Dir; monto: number; moneda: Moneda; ts: number; tipo: string; contraparte: string; estado: string; costo: number };
export const asientosDe = (t: any): Asiento[] => {
  const ts = cuando(t);
  const estado = String(t.status ?? '');
  const base = { tx: t, ts, estado, costo: 0 };
  const contra = (() => {
    if (t.type === 'dispersion' || t.type === 'send') return String(t.beneficiary ?? t.bank ?? '—');
    if (t.type === 'pay_received') return String(t.senderName ?? 'Usuario Lincoin');
    if (t.type === 'pay_sent') return String(t.recipientName ?? 'Usuario Lincoin');
    if (t.type === 'load') return String(t.method ?? t.bank ?? '—');
    if (t.type === 'otc_deposit' || t.type === 'otc_withdraw') return String(t.chain ?? t.walletKey ?? t.currency ?? '—');
    return '—';
  })();
  if (t.type === 'convert' || t.type === 'tx_created') {
    const de = String(t.currency ?? ''), a = String(t.targetCurrency ?? '');
    const out: Asiento[] = [{ ...base, dir: 'out', monto: Number(t.amount) || 0, moneda: familia(de), tipo: 'Conversión', contraparte: `${de.split('_')[0]} → ${a.split('_')[0] || '?'}` }];
    const tA = Number(t.targetAmount);
    if (a && Number.isFinite(tA) && tA > 0) out.push({ ...base, dir: 'in', monto: tA, moneda: familia(a), tipo: 'Conversión', contraparte: `${de.split('_')[0]} → ${a.split('_')[0]}` });
    return out;
  }
  // Ajuste manual del admin: entra o sale según su dirección. Antes no se
  // contaba y un descuento del admin no bajaba el saldo de la contabilidad.
  if (t.type === 'adjustment') {
    const dirAj: Dir = String(t.direction ?? t.raw_data?.direction ?? 'debit') === 'credit' ? 'in' : 'out';
    return [{ ...base, dir: dirAj, monto: Number(t.amount) || 0, moneda: familia(t.currency), tipo: 'Ajuste', contraparte: 'Lincoin' }];
  }
  if (ENTRA.has(t.type)) return [{ ...base, dir: 'in', monto: Number(t.amount) || 0, moneda: familia(t.currency), tipo: TIPO_ES[t.type] ?? t.type, contraparte: contra }];
  if (SALE.has(t.type)) {
    const moneda = familia(t.currency);
    const costo = (t.type === 'dispersion' || t.type === 'send') && moneda === 'COP' ? Math.max(0, Number(t.feeCop) || 0) : 0;
    return [{ ...base, dir: 'out', monto: Number(t.amount) || 0, moneda, tipo: TIPO_ES[t.type] ?? t.type, contraparte: contra, costo }];
  }
  return [];
};

export const fmtMon = (v: number, m: Moneda) => `${v.toLocaleString('es-CO', { maximumFractionDigits: m === 'COP' ? 0 : 2 })} ${m}`;
export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Datos del tercero de un movimiento para el extracto: nombre, documento y
// a qué banco y cuenta fue (o de dónde vino). Solo lo que el movimiento
// guardó; lo que no está queda vacío, no se supone.
const TIPOS_DOC: Record<string, string> = { CC: 'CC', CE: 'CE', NIT: 'NIT', PP: 'Pasaporte', PPT: 'PPT', TI: 'TI', cc: 'CC', ce: 'CE', nit: 'NIT', passport: 'Pasaporte' };
export type DatosTercero = { nombre: string; docTipo: string; docNum: string; banco: string; tipoCuenta: string; cuenta: string };
export function datosTercero(tx: any, contraparte: string): DatosTercero {
  const rd = tx?.raw_data && typeof tx.raw_data === 'object' ? tx.raw_data : {};
  const v = (k: string) => tx?.[k] ?? rd?.[k];
  const rec = (v('recipient') && typeof v('recipient') === 'object') ? v('recipient') : {};
  const breb = tx?.currency === 'COP_BREB' || v('rail') === 'BREB' || !!rec.keyType;
  const nombre = String(v('beneficiary') ?? rec.holderName ?? v('beneficiaryName') ?? v('senderName') ?? v('pagador') ?? v('payerName') ?? v('recipientName') ?? contraparte ?? '').trim();
  const tipoRaw = String(v('documentType') ?? rec.documentType ?? rec.docType ?? v('payerDocumentType') ?? '').trim();
  const docNum = String(v('documentNumber') ?? rec.documentNumber ?? rec.docNumber ?? v('payerDocument') ?? v('senderDocument') ?? '').trim();
  const banco = breb ? 'Bre-B' : String(rec.bankName ?? rec.bankCode ?? (v('bank') && v('bank') !== 'ACH' ? v('bank') : (v('payerBank') ?? ''))).split('·')[0].trim();
  const tc = String(rec.accountType ?? v('accountType') ?? '').toLowerCase();
  const llaves: Record<string, string> = { celular: 'Celular', cedula: 'Cédula', correo: 'Correo', alfanumerico: 'Alfanumérica' };
  const tipoCuenta = breb
    ? (rec.keyType ? `Llave ${llaves[String(rec.keyType).toLowerCase()] ?? rec.keyType}` : 'Llave Bre-B')
    : /corriente|checking/.test(tc) ? 'Corriente' : /ahorro|saving/.test(tc) ? 'Ahorros' : '';
  const cuenta = String((breb ? (rec.key ?? v('account')) : (rec.accountNumber ?? v('account'))) ?? '').trim();
  return { nombre, docTipo: TIPOS_DOC[tipoRaw] ?? tipoRaw, docNum, banco, tipoCuenta, cuenta };
}

// Cuánto mueve el saldo un asiento. Lo rechazado no lo mueve.
export const efecto = (a: Asiento) => !cuenta(a.tx) ? 0 : a.dir === 'in' ? a.monto : -(a.monto + a.costo);

// ── Estado de cuenta ────────────────────────────────────────────────
// Saldo inicial = todo lo anterior al periodo, desde el primer movimiento
// en Lincoin. Cada fila lleva el saldo justo después de esa operación.
export type FilaEstado = { a: Asiento; entrada: number | null; salida: number | null; costo: number | null; saldo: number };
export type EstadoCuenta = {
  moneda: Moneda; desde: number; hasta: number;
  saldoInicial: number; entradas: number; salidas: number; costos: number; saldoFinal: number;
  nEntradas: number; nSalidas: number; nNoSuman: number;
  filas: FilaEstado[];
};
export function estadoDeCuenta(asientos: Asiento[], moneda: Moneda, desde: number, hasta: number): EstadoCuenta {
  const orden = asientos.filter(a => a.moneda === moneda).sort((p, q) => p.ts - q.ts);
  let saldo = 0, entradas = 0, salidas = 0, costos = 0, nEntradas = 0, nSalidas = 0, nNoSuman = 0;
  for (const a of orden) if (a.ts < desde) saldo += efecto(a);
  const saldoInicial = saldo;
  const filas: FilaEstado[] = [];
  for (const a of orden) {
    if (a.ts < desde || a.ts >= hasta) continue;
    const suma = cuenta(a.tx);
    saldo += efecto(a);
    if (!suma) nNoSuman++;
    else if (a.dir === 'in') { entradas += a.monto; nEntradas++; }
    else { salidas += a.monto; costos += a.costo; nSalidas++; }
    filas.push({
      a,
      entrada: suma && a.dir === 'in' ? a.monto : null,
      salida: suma && a.dir === 'out' ? a.monto : null,
      costo: suma && a.costo > 0 ? a.costo : null,
      saldo,
    });
  }
  return { moneda, desde, hasta, saldoInicial, entradas, salidas, costos, saldoFinal: saldo, nEntradas, nSalidas, nNoSuman, filas };
}

// ── Terceros: a quién se le envió y de quién se recibió ─────────────
// Se agrupa por documento cuando el movimiento lo guardó (dos envíos al
// mismo NIT son el mismo tercero aunque el nombre venga escrito distinto);
// si no hay documento, por nombre y cuenta. Conversiones y ajustes no son
// terceros: son la cuenta consigo misma y Lincoin.
export type Tercero = DatosTercero & { clave: string; n: number; total: number; costos: number; primera: number; ultima: number; asientos: Asiento[] };
export const claveTercero = (a: Asiento) => {
  const d = datosTercero(a.tx, a.contraparte);
  const doc = d.docNum.replace(/\D/g, '');
  if (doc.length >= 5) return `doc:${doc}`;
  return `nom:${d.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()}|${d.cuenta.replace(/\s/g, '')}`;
};
export const esDeTercero = (a: Asiento) => a.tipo !== 'Conversión' && a.tipo !== 'Ajuste';
export function terceros(asientos: Asiento[], dir: Dir): Tercero[] {
  const m = new Map<string, Tercero>();
  // Del más viejo al más nuevo: los datos que quedan son los del último
  // movimiento (el nombre o la cuenta pudieron cambiar).
  for (const a of [...asientos].sort((p, q) => p.ts - q.ts)) {
    if (a.dir !== dir || !cuenta(a.tx) || !esDeTercero(a)) continue;
    const k = claveTercero(a);
    const d = datosTercero(a.tx, a.contraparte);
    const t = m.get(k) ?? { ...d, clave: k, n: 0, total: 0, costos: 0, primera: a.ts, ultima: a.ts, asientos: [] };
    for (const c of ['nombre', 'docTipo', 'docNum', 'banco', 'tipoCuenta', 'cuenta'] as const) if (d[c]) t[c] = d[c];
    t.n += 1; t.total += a.monto; t.costos += a.costo; t.ultima = a.ts; t.asientos.push(a);
    m.set(k, t);
  }
  return [...m.values()].sort((x, y) => y.total - x.total);
}

// ── Ficha de la empresa ─────────────────────────────────────────────
// Lo que la contadora necesita para identificar al titular. Solo lo que la
// cuenta tiene guardado; lo que falta se deja vacío.
export type FichaEmpresa = {
  nombre: string; tipoDocumento?: string; nit?: string; email?: string; telefono?: string;
  pais?: string; ciudad?: string; direccion?: string;
  representante?: string; representanteDoc?: string;
  idLincoin?: string; clienteDesde?: string | null;
};
export const fichaDeUsuario = (u: any): FichaEmpresa | null => {
  if (!u) return null;
  const rep = String(u.repLegalName || [u.repFirstName, u.repLastName].filter(Boolean).join(' ') || '').trim();
  return {
    nombre: String(u.companyName || u.name || u.email || ''),
    tipoDocumento: String(u.taxIdType ?? '') || (u.taxId ? 'NIT' : ''),
    nit: String(u.taxId ?? u.nit ?? ''),
    email: String(u.email ?? ''),
    telefono: String(u.phone ?? u.telefono ?? ''),
    pais: String(u.companyCountry ?? ''),
    ciudad: String(u.companyCity ?? ''),
    direccion: String(u.companyAddress ?? ''),
    representante: rep,
    representanteDoc: [u.repDocType, u.repDocNumber].filter(Boolean).join(' '),
    idLincoin: String(u.ownReferralCode || String(u.id ?? '').slice(-6)).toUpperCase(),
    clienteDesde: u.createdAt ?? u.created_at ?? null,
  };
};
