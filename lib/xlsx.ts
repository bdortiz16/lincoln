// Generador mínimo de archivos .xlsx (Excel) sin dependencias.
//
// Arma el paquete Open XML a mano: un ZIP sin compresión con las partes que
// Excel exige (tipos de contenido, libro, hojas, estilos). Alcanza para lo que
// necesitamos — exportar tablas — y evita cargar una librería de 400 KB.
//
// Soporta por celda: texto, número, fecha (como fecha real de Excel, no texto)
// y booleano. La primera fila se escribe en negrita, con filtro y panel fijo.

export type Celda = string | number | boolean | Date | null | undefined;

export interface Hoja {
  nombre: string;
  /** Cabecera + filas. Cada fila es una lista de celdas. */
  filas: Celda[][];
  /** Ancho de columnas en caracteres. Si falta, se calcula del contenido. */
  anchos?: number[];
}

// ─── XML ────────────────────────────────────────────────────────────────────

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de control que XML 1.0 no admite.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

const letraCol = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Serial de Excel a partir de la hora LOCAL, para que la celda muestre la
// misma hora que ve el usuario en pantalla.
const serialExcel = (d: Date) => {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
};

// Estilos (índices de cellXfs en styles.xml).
const S_NORMAL = 0, S_FECHA = 1, S_NUMERO = 2, S_CABECERA = 3;

const celdaXml = (v: Celda, ref: string, cabecera: boolean): string => {
  if (v == null || v === '') return '';
  if (cabecera) return `<c r="${ref}" s="${S_CABECERA}" t="inlineStr"><is><t>${xml(String(v))}</t></is></c>`;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return `<c r="${ref}" s="${S_FECHA}"><v>${serialExcel(v)}</v></c>`;
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    return `<c r="${ref}" s="${S_NUMERO}"><v>${v}</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" s="${S_NORMAL}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
};

const largoVisible = (v: Celda) => {
  if (v == null) return 0;
  if (v instanceof Date) return 16;
  if (typeof v === 'number') return Math.min(18, v.toLocaleString('en-US').length + 3);
  return String(v).length;
};

const hojaXml = (h: Hoja, primera: boolean) => {
  const filas = h.filas;
  const nCols = Math.max(1, ...filas.map(f => f.length));
  const anchos = Array.from({ length: nCols }, (_, i) =>
    h.anchos?.[i] ?? Math.min(60, Math.max(8, ...filas.slice(0, 500).map(f => largoVisible(f[i])) ) + 2));
  const cols = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const cuerpo = filas.map((f, r) => {
    const celdas = f.map((v, c) => celdaXml(v, `${letraCol(c)}${r + 1}`, r === 0)).join('');
    return `<row r="${r + 1}">${celdas}</row>`;
  }).join('');
  const ultima = `${letraCol(nCols - 1)}${Math.max(1, filas.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${ultima}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${primera ? ' tabSelected="1"' : ''}>` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${cuerpo}</sheetData>` +
    (filas.length > 1 ? `<autoFilter ref="A1:${ultima}"/>` : '') +
    `</worksheet>`;
};

const nombreHoja = (s: string, i: number) => {
  const limpio = s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
  return limpio || `Hoja${i + 1}`;
};

const ESTILOS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

// ─── ZIP (sin compresión) ───────────────────────────────────────────────────

let TABLA_CRC: Uint32Array | null = null;
const crc32 = (b: Uint8Array) => {
  if (!TABLA_CRC) {
    TABLA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABLA_CRC[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) crc = TABLA_CRC[(crc ^ b[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const fechaDos = (d: Date) => ({
  hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  dia: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

const zip = (partes: { nombre: string; datos: Uint8Array }[]): Uint8Array => {
  const enc = new TextEncoder();
  const { hora, dia } = fechaDos(new Date());
  const locales: Uint8Array[] = [], centrales: Uint8Array[] = [];
  let offset = 0;
  const u16 = (dv: DataView, o: number, v: number) => dv.setUint16(o, v, true);
  const u32 = (dv: DataView, o: number, v: number) => dv.setUint32(o, v >>> 0, true);
  for (const p of partes) {
    const nombre = enc.encode(p.nombre);
    const crc = crc32(p.datos);
    const loc = new Uint8Array(30 + nombre.length);
    const dv = new DataView(loc.buffer);
    u32(dv, 0, 0x04034b50); u16(dv, 4, 20); u16(dv, 6, 0x0800); u16(dv, 8, 0);
    u16(dv, 10, hora); u16(dv, 12, dia); u32(dv, 14, crc); u32(dv, 18, p.datos.length); u32(dv, 22, p.datos.length);
    u16(dv, 26, nombre.length); u16(dv, 28, 0);
    loc.set(nombre, 30);
    locales.push(loc, p.datos);

    const cen = new Uint8Array(46 + nombre.length);
    const dc = new DataView(cen.buffer);
    u32(dc, 0, 0x02014b50); u16(dc, 4, 20); u16(dc, 6, 20); u16(dc, 8, 0x0800); u16(dc, 10, 0);
    u16(dc, 12, hora); u16(dc, 14, dia); u32(dc, 16, crc); u32(dc, 20, p.datos.length); u32(dc, 24, p.datos.length);
    u16(dc, 28, nombre.length); u16(dc, 30, 0); u16(dc, 32, 0); u16(dc, 34, 0); u16(dc, 36, 0); u32(dc, 38, 0); u32(dc, 42, offset);
    cen.set(nombre, 46);
    centrales.push(cen);
    offset += loc.length + p.datos.length;
  }
  const tamCentral = centrales.reduce((s, c) => s + c.length, 0);
  const fin = new Uint8Array(22);
  const df = new DataView(fin.buffer);
  u32(df, 0, 0x06054b50); u16(df, 4, 0); u16(df, 6, 0); u16(df, 8, partes.length); u16(df, 10, partes.length);
  u32(df, 12, tamCentral); u32(df, 16, offset); u16(df, 20, 0);
  const total = offset + tamCentral + 22;
  const salida = new Uint8Array(total);
  let pos = 0;
  for (const b of [...locales, ...centrales, fin]) { salida.set(b, pos); pos += b.length; }
  return salida;
};

// ─── Libro ──────────────────────────────────────────────────────────────────

/** Devuelve los bytes de un .xlsx con las hojas indicadas. */
export function armarXlsx(hojas: Hoja[]): Uint8Array {
  if (!hojas.length) hojas = [{ nombre: 'Hoja1', filas: [[]] }];
  const enc = new TextEncoder();
  const nombres = hojas.map((h, i) => nombreHoja(h.nombre, i));
  // Nombres repetidos: Excel no los acepta.
  nombres.forEach((n, i) => { let k = 2; while (nombres.slice(0, i).includes(nombres[i])) nombres[i] = `${n.slice(0, 28)} ${k++}`; });

  const tipos =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const libro =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` + hojas.map((_, i) => `<sheet name="${xml(nombres[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets>` +
    `</workbook>`;

  const libroRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  return zip([
    { nombre: '[Content_Types].xml', datos: enc.encode(tipos) },
    { nombre: '_rels/.rels', datos: enc.encode(rels) },
    { nombre: 'xl/workbook.xml', datos: enc.encode(libro) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: enc.encode(libroRels) },
    { nombre: 'xl/styles.xml', datos: enc.encode(ESTILOS) },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: enc.encode(hojaXml(h, i === 0)) })),
  ]);
}

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Arma el .xlsx y lo descarga en el navegador con el nombre dado. */
export function descargarXlsx(nombreArchivo: string, hojas: Hoja[]) {
  const bytes = armarXlsx(hojas);
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME_XLSX }));
  const el = document.createElement('a');
  el.href = url;
  el.download = nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`;
  el.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
