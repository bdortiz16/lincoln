// Generador mínimo de archivos .xlsx (Excel) sin dependencias.
//
// Arma el paquete Open XML a mano: un ZIP sin compresión con las partes que
// Excel exige (tipos de contenido, libro, hojas, estilos y, si hay, dibujos y
// gráficos). Alcanza para lo que necesitamos — exportar tablas e informes — y
// evita cargar una librería de 400 KB (que además no hace gráficos).
//
// Soporta por celda: texto, número, fecha (como fecha real de Excel, no texto)
// y booleano. Por defecto la primera fila se escribe en negrita, con filtro y
// panel fijo, como siempre. Para informes, cada celda puede llevar un estilo
// con nombre ({ v, s }), una fórmula con su valor ya calculado ({ f, v }) o la
// marca de Lincoin ({ marca: true }); y la hoja puede combinar celdas, fijar N
// filas, poner el filtro donde va la tabla y llevar gráficos de barras.

export type Celda = string | number | boolean | Date | null | undefined;

export type Estilo =
  | 'normal' | 'fecha' | 'numero' | 'cabeceraSimple'
  | 'titulo' | 'subtitulo' | 'seccion' | 'th' | 'nota'
  | 'texto' | 'textoAjustado' | 'cop' | 'copUtil' | 'usd' | 'tasa' | 'entero' | 'pct' | 'dia' | 'fechaHora'
  | 'totalTexto' | 'totalCop' | 'totalUsd' | 'totalTasa' | 'totalEntero' | 'totalPct'
  | 'etiqueta' | 'kpiTexto' | 'kpiCop' | 'kpiUsd' | 'kpiTasa' | 'kpiEntero' | 'kpiPct' | 'kpiFecha'
  | 'alerta' | 'alertaRoja';

export interface CeldaRica {
  v?: Celda;
  s?: Estilo;
  /** Fórmula sin el "=". `v` es el valor ya calculado, para quien no recalcule. */
  f?: string;
  /** La marca de Lincoin: "Lincoin" con el punto verde. */
  marca?: boolean;
}
export type CeldaX = Celda | CeldaRica;

/** Gráfico de barras de UNA serie, leído de dos columnas de la misma hoja. */
export interface Grafico {
  tipo: 'columnas' | 'barras';
  titulo: string;
  serie: string;
  /** Columna (0-based) de las categorías y de los valores, y filas (0-based, inclusive) de los datos. */
  colCategorias: number;
  colValores: number;
  desdeFila: number;
  hastaFila: number;
  /** Formato del eje de valores, ej. '"$"#,##0'. */
  formato?: string;
  /** Color de las barras, hex sin '#'. */
  color?: string;
  /** Dónde va: celda superior izquierda (0-based) y tamaño en columnas y filas. */
  col: number;
  fila: number;
  ancho: number;
  alto: number;
}

export interface Hoja {
  nombre: string;
  /** Cabecera + filas. Cada fila es una lista de celdas. */
  filas: CeldaX[][];
  /** Ancho de columnas en caracteres. Si falta, se calcula del contenido. */
  anchos?: number[];
  /** Fila (0-based) que va en negrita como cabecera. Por defecto 0; null = ninguna. */
  cabecera?: number | null;
  /** Cuántas filas quedan fijas arriba. Por defecto, hasta la cabecera. */
  fijar?: number;
  /** Rango del filtro, ej. "A5:R40". Por defecto, toda la tabla si hay cabecera en la fila 0. */
  filtro?: string | null;
  /** Rangos a combinar, ej. ["A1:F1"]. */
  combinar?: string[];
  /** Alto de filas en puntos, por índice 0-based. */
  altos?: Record<number, number>;
  /** Color de la pestaña, hex sin '#'. */
  color?: string;
  graficos?: Grafico[];
  /** Al imprimir: horizontal y ajustada al ancho de la página. */
  imprimirAncho?: boolean;
}

// ─── XML ────────────────────────────────────────────────────────────────────

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    // Caracteres de control que XML 1.0 no admite.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

export const letraCol = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
/** Referencia A1 a partir de columna y fila 0-based. */
export const refCelda = (col: number, fila: number) => `${letraCol(col)}${fila + 1}`;

// Serial de Excel a partir de la hora LOCAL, para que la celda muestre la
// misma hora que ve el usuario en pantalla.
const serialExcel = (d: Date) => {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  return (utc - Date.UTC(1899, 11, 30)) / 86400000;
};

// ─── Estilos ────────────────────────────────────────────────────────────────
// Paleta Lincoin sobre papel claro: tinta #15181A, verde #22A35C para el
// acento, grises neutros para lo secundario.

const FMT_COP = '"$"#,##0;[Red]-"$"#,##0';
const NUM_FMTS: [number, string][] = [
  [164, 'yyyy-mm-dd hh:mm'], [165, '#,##0.00'], [166, FMT_COP], [167, '0.0%'], [168, '#,##0'], [169, 'yyyy-mm-dd'],
];
// [negrita, cursiva, tamaño, color]
const FUENTES: [boolean, boolean, number, string | null][] = [
  [false, false, 11, null],        // 0 normal
  [true, false, 11, null],         // 1 negrita
  [true, false, 16, '15181A'],     // 2 título
  [true, false, 12, '15181A'],     // 3 subtítulo / sección
  [true, false, 10, 'FFFFFF'],     // 4 cabecera de tabla
  [false, true, 10, '6B716C'],     // 5 nota
  [true, false, 11, '16A34A'],     // 6 utilidad
  [true, false, 12, '15181A'],     // 7 valor de un indicador
  [false, false, 10, '4B5563'],    // 8 etiqueta
  [false, false, 10, '78350F'],    // 9 alerta
  [false, false, 10, '7F1D1D'],    // 10 alerta roja
];
const RELLENOS: (string | null)[] = [null, 'gray125', '15181A', 'F3F4F6', 'FEF3C7', 'FEE2E2'];
// [lado, estilo, color]
const BORDES: ([string, string, string] | null)[] = [
  null,
  ['bottom', 'thin', 'E5E7EB'],
  ['top', 'thin', '15181A'],
  ['bottom', 'medium', '22A35C'],
];

type Xf = { fmt?: number; fuente?: number; relleno?: number; borde?: number; ajustar?: boolean; arriba?: boolean };
const XFS: [Estilo, Xf][] = [
  ['normal', {}],
  ['fecha', { fmt: 164 }],
  ['numero', { fmt: 165 }],
  ['cabeceraSimple', { fuente: 1 }],
  ['titulo', { fuente: 2 }],
  ['subtitulo', { fuente: 3 }],
  ['seccion', { fuente: 3, borde: 3 }],
  ['th', { fuente: 4, relleno: 2, ajustar: true }],
  ['nota', { fuente: 5, ajustar: true, arriba: true }],
  ['texto', { borde: 1 }],
  ['textoAjustado', { borde: 1, ajustar: true, arriba: true }],
  ['cop', { fmt: 166, borde: 1 }],
  ['copUtil', { fmt: 166, fuente: 6, borde: 1 }],
  ['usd', { fmt: 165, borde: 1 }],
  ['tasa', { fmt: 165, borde: 1 }],
  ['entero', { fmt: 168, borde: 1 }],
  ['pct', { fmt: 167, borde: 1 }],
  ['dia', { fmt: 169, borde: 1 }],
  ['fechaHora', { fmt: 164, borde: 1 }],
  ['totalTexto', { fuente: 1, relleno: 3, borde: 2 }],
  ['totalCop', { fmt: 166, fuente: 1, relleno: 3, borde: 2 }],
  ['totalUsd', { fmt: 165, fuente: 1, relleno: 3, borde: 2 }],
  ['totalTasa', { fmt: 165, fuente: 1, relleno: 3, borde: 2 }],
  ['totalEntero', { fmt: 168, fuente: 1, relleno: 3, borde: 2 }],
  ['totalPct', { fmt: 167, fuente: 1, relleno: 3, borde: 2 }],
  ['etiqueta', { fuente: 8, relleno: 3, borde: 1 }],
  ['kpiTexto', { fuente: 7, borde: 1 }],
  ['kpiCop', { fmt: 166, fuente: 7, borde: 1 }],
  ['kpiUsd', { fmt: 165, fuente: 7, borde: 1 }],
  ['kpiTasa', { fmt: 165, fuente: 7, borde: 1 }],
  ['kpiEntero', { fmt: 168, fuente: 7, borde: 1 }],
  ['kpiPct', { fmt: 167, fuente: 7, borde: 1 }],
  ['kpiFecha', { fmt: 164, fuente: 7, borde: 1 }],
  ['alerta', { fuente: 9, relleno: 4, ajustar: true, arriba: true }],
  ['alertaRoja', { fuente: 10, relleno: 5, ajustar: true, arriba: true }],
];
const IDX_ESTILO = new Map<Estilo, number>(XFS.map(([n], i) => [n, i]));
const S_NORMAL = 0, S_FECHA = 1, S_NUMERO = 2, S_CABECERA = 3;

const ESTILOS = (() => {
  const fmts = NUM_FMTS.map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${xml(c)}"/>`).join('');
  const fuentes = FUENTES.map(([b, i, sz, color]) =>
    `<font>${b ? '<b/>' : ''}${i ? '<i/>' : ''}<sz val="${sz}"/>${color ? `<color rgb="FF${color}"/>` : ''}<name val="Calibri"/></font>`).join('');
  const rellenos = RELLENOS.map(r =>
    r === null ? '<fill><patternFill patternType="none"/></fill>'
      : r === 'gray125' ? '<fill><patternFill patternType="gray125"/></fill>'
        : `<fill><patternFill patternType="solid"><fgColor rgb="FF${r}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  const lado = (b: [string, string, string] | null, l: string) =>
    b && b[0] === l ? `<${l} style="${b[1]}"><color rgb="FF${b[2]}"/></${l}>` : `<${l}/>`;
  const bordes = BORDES.map(b => `<border>${lado(b, 'left')}${lado(b, 'right')}${lado(b, 'top')}${lado(b, 'bottom')}<diagonal/></border>`).join('');
  const xfs = XFS.map(([, x]) => {
    const fmt = x.fmt ?? 0, fu = x.fuente ?? 0, re = x.relleno ?? 0, bo = x.borde ?? 0;
    const alin = x.ajustar || x.arriba ? `<alignment${x.ajustar ? ' wrapText="1"' : ''}${x.arriba ? ' vertical="top"' : ' vertical="center"'}/>` : '';
    return `<xf numFmtId="${fmt}" fontId="${fu}" fillId="${re}" borderId="${bo}" xfId="0"` +
      `${fmt ? ' applyNumberFormat="1"' : ''}${fu ? ' applyFont="1"' : ''}${re ? ' applyFill="1"' : ''}${bo ? ' applyBorder="1"' : ''}` +
      (alin ? ` applyAlignment="1">${alin}</xf>` : '/>');
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="${NUM_FMTS.length}">${fmts}</numFmts>` +
    `<fonts count="${FUENTES.length}">${fuentes}</fonts>` +
    `<fills count="${RELLENOS.length}">${rellenos}</fills>` +
    `<borders count="${BORDES.length}">${bordes}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${XFS.length}">${xfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
})();

// ─── Celdas ─────────────────────────────────────────────────────────────────

const esRica = (x: CeldaX): x is CeldaRica => x != null && typeof x === 'object' && !(x instanceof Date);
const valorDe = (x: CeldaX): Celda => (esRica(x) ? x.v : x);

const MARCA =
  `<is><r><rPr><rFont val="Archivo"/><b/><color rgb="FF15181A"/><sz val="18"/></rPr><t>Lincoin</t></r>` +
  `<r><rPr><rFont val="Archivo"/><b/><color rgb="FF22A35C"/><sz val="18"/></rPr><t>.</t></r></is>`;

const celdaXml = (x: CeldaX, ref: string, cabecera: boolean): string => {
  const rica = esRica(x);
  const v = valorDe(x);
  const sNombre = rica ? x.s : undefined;
  if (rica && x.marca) return `<c r="${ref}" s="${IDX_ESTILO.get(sNombre ?? 'normal') ?? 0}" t="inlineStr">${MARCA}</c>`;
  const porTipo = cabecera ? S_CABECERA : v instanceof Date ? S_FECHA : typeof v === 'number' ? S_NUMERO : S_NORMAL;
  const s = sNombre ? (IDX_ESTILO.get(sNombre) ?? porTipo) : porTipo;
  if (rica && x.f) {
    const cache = typeof v === 'number' && isFinite(v) ? `<v>${v}</v>` : '';
    return `<c r="${ref}" s="${s}"><f>${xml(x.f)}</f>${cache}</c>`;
  }
  if (v == null || v === '') return sNombre ? `<c r="${ref}" s="${s}"/>` : '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return `<c r="${ref}" s="${s}"/>`;
    return `<c r="${ref}" s="${s}"><v>${serialExcel(v)}</v></c>`;
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) return `<c r="${ref}" s="${s}"/>`;
    return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  }
  if (typeof v === 'boolean') return `<c r="${ref}" s="${s}" t="b"><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
};

const largoVisible = (x: CeldaX) => {
  const v = valorDe(x);
  if (v == null) return 0;
  if (v instanceof Date) return 16;
  if (typeof v === 'number') return Math.min(18, v.toLocaleString('en-US').length + 3);
  return String(v).length;
};

const hojaXml = (h: Hoja, primera: boolean, conDibujo: boolean) => {
  const filas = h.filas;
  const nCols = Math.max(1, ...filas.map(f => f.length));
  const cabecera = h.cabecera === undefined ? 0 : h.cabecera;
  const anchos = Array.from({ length: nCols }, (_, i) =>
    h.anchos?.[i] ?? Math.min(60, Math.max(8, ...filas.slice(0, 500).map(f => largoVisible(f[i])) ) + 2));
  const cols = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const cuerpo = filas.map((f, r) => {
    const celdas = f.map((v, c) => celdaXml(v, refCelda(c, r), r === cabecera)).join('');
    const alto = h.altos?.[r];
    return `<row r="${r + 1}"${alto ? ` ht="${alto}" customHeight="1"` : ''}>${celdas}</row>`;
  }).join('');
  const ultima = refCelda(nCols - 1, Math.max(0, filas.length - 1));
  const fijar = h.fijar ?? (cabecera == null ? 0 : cabecera + 1);
  const filtro = h.filtro !== undefined ? h.filtro : (cabecera === 0 && filas.length > 1 ? `A1:${ultima}` : null);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    (h.color || h.imprimirAncho ? `<sheetPr>${h.color ? `<tabColor rgb="FF${h.color}"/>` : ''}${h.imprimirAncho ? '<pageSetUpPr fitToPage="1"/>' : ''}</sheetPr>` : '') +
    `<dimension ref="A1:${ultima}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${primera ? ' tabSelected="1"' : ''}${cabecera == null ? ' showGridLines="0"' : ''}>` +
    (fijar > 0 ? `<pane ySplit="${fijar}" topLeftCell="A${fijar + 1}" activePane="bottomLeft" state="frozen"/>` : '') +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${cuerpo}</sheetData>` +
    (filtro ? `<autoFilter ref="${filtro}"/>` : '') +
    (h.combinar?.length ? `<mergeCells count="${h.combinar.length}">${h.combinar.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '') +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    (h.imprimirAncho ? `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` : '') +
    (conDibujo ? `<drawing r:id="rId1"/>` : '') +
    `</worksheet>`;
};

const nombreHoja = (s: string, i: number) => {
  // Excel no admite \ / ? * [ ] : ni un apóstrofo al principio o al final.
  const limpio = s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31).replace(/^'+|'+$/g, '').trim();
  return limpio || `Hoja${i + 1}`;
};

// ─── Gráficos ───────────────────────────────────────────────────────────────

const refHoja = (nombre: string, c: number, f1: number, f2: number) =>
  `'${nombre.replace(/'/g, "''")}'!$${letraCol(c)}$${f1 + 1}:$${letraCol(c)}$${f2 + 1}`;

const textoEje = (color: string) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="es-CO"/></a:p></c:txPr>`;

const graficoXml = (g: Grafico, h: Hoja, nombre: string) => {
  const filas = h.filas.slice(g.desdeFila, g.hastaFila + 1);
  const cats = filas.map(f => { const v = valorDe(f[g.colCategorias]); return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''); });
  const vals = filas.map(f => { const v = valorDe(f[g.colValores]); return typeof v === 'number' && isFinite(v) ? v : null; });
  const barras = g.tipo === 'barras';
  const color = g.color ?? '22A35C';
  const formato = xml(g.formato ?? 'General');
  // Las barras arrancan en cero: un eje que empieza más arriba exagera las diferencias.
  const desdeCero = vals.every(v => v == null || v >= 0) ? '<c:min val="0"/>' : '';
  const strCache = `<c:strCache><c:ptCount val="${cats.length}"/>${cats.map((c, i) => `<c:pt idx="${i}"><c:v>${xml(c)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = `<c:numCache><c:formatCode>${formato}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => v == null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:roundedCorners val="0"/>` +
    `<c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1100" b="1"/></a:pPr>` +
    `<a:r><a:rPr lang="es-CO" sz="1100" b="1"><a:solidFill><a:srgbClr val="15181A"/></a:solidFill></a:rPr><a:t>${xml(g.titulo)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>` +
    `<c:barChart><c:barDir val="${barras ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(g.serie)}</c:v></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>` +
    `<c:cat><c:strRef><c:f>${xml(refHoja(nombre, g.colCategorias, g.desdeFila, g.hastaFila))}</c:f>${strCache}</c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${xml(refHoja(nombre, g.colValores, g.desdeFila, g.hastaFila))}</c:f>${numCache}</c:numRef></c:val>` +
    `</c:ser>` +
    `<c:gapWidth val="${barras ? 50 : 70}"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>` +
    // Barras horizontales: la primera fila de la tabla arriba, como se lee.
    `<c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${barras ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${barras ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>` +
    `<c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="D1D5DB"/></a:solidFill></a:ln></c:spPr>${textoEje('4B5563')}` +
    `<c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/>${desdeCero}</c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${barras ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>` +
    `<c:numFmt formatCode="${formato}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${textoEje('6B716C')}` +
    `<c:crossAx val="5001"/><c:crosses val="${barras ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>` +
    `</c:plotArea>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>` +
    `</c:chart>` +
    `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="E5E7EB"/></a:solidFill></a:ln></c:spPr>` +
    `</c:chartSpace>`;
};

const dibujoXml = (gs: Grafico[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
  gs.map((g, i) =>
    `<xdr:twoCellAnchor editAs="oneCell">` +
    `<xdr:from><xdr:col>${g.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.fila}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>${g.col + g.ancho}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.fila + g.alto}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${xml(g.titulo.slice(0, 60)) || `Gráfico ${i + 1}`}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/>` +
    `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('') +
  `</xdr:wsDr>`;

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

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Devuelve los bytes de un .xlsx con las hojas indicadas. */
export function armarXlsx(hojas: Hoja[]): Uint8Array {
  if (!hojas.length) hojas = [{ nombre: 'Hoja1', filas: [[]] }];
  const enc = new TextEncoder();
  const nombres = hojas.map((h, i) => nombreHoja(h.nombre, i));
  // Nombres repetidos: Excel no los acepta, y para él "Xatech" y "XATECH" son el mismo.
  nombres.forEach((n, i) => {
    let k = 2;
    while (nombres.slice(0, i).some(x => x.toLowerCase() === nombres[i].toLowerCase())) nombres[i] = `${n.slice(0, 28)} ${k++}`;
  });

  // Qué hoja lleva dibujo y qué número de gráfico le toca a cada uno.
  let nDibujo = 0, nGrafico = 0;
  const dibujos = hojas.map(h => {
    const gs = (h.graficos ?? []).filter(g => g.hastaFila >= g.desdeFila);
    if (!gs.length) return null;
    return { n: ++nDibujo, graficos: gs.map(g => ({ g, n: ++nGrafico })) };
  });

  const tipos =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    dibujos.map(d => !d ? '' :
      `<Override PartName="/xl/drawings/drawing${d.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
      d.graficos.map(x => `<Override PartName="/xl/charts/chart${x.n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')).join('') +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  // fullCalcOnLoad: Excel recalcula las fórmulas al abrir (los totales).
  const libro =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
    `<sheets>` + hojas.map((_, i) => `<sheet name="${xml(nombres[i])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets>` +
    `<calcPr calcId="191029" fullCalcOnLoad="1"/>` +
    `</workbook>`;

  const libroRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${hojas.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const partesDibujo: { nombre: string; datos: Uint8Array }[] = [];
  hojas.forEach((h, i) => {
    const d = dibujos[i];
    if (!d) return;
    partesDibujo.push(
      { nombre: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, datos: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing${d.n}.xml"/></Relationships>`) },
      { nombre: `xl/drawings/drawing${d.n}.xml`, datos: enc.encode(dibujoXml(d.graficos.map(x => x.g))) },
      { nombre: `xl/drawings/_rels/drawing${d.n}.xml.rels`, datos: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        d.graficos.map((x, k) => `<Relationship Id="rId${k + 1}" Type="${REL}/chart" Target="../charts/chart${x.n}.xml"/>`).join('') +
        `</Relationships>`) },
      ...d.graficos.map(x => ({ nombre: `xl/charts/chart${x.n}.xml`, datos: enc.encode(graficoXml(x.g, h, nombres[i])) })),
    );
  });

  return zip([
    { nombre: '[Content_Types].xml', datos: enc.encode(tipos) },
    { nombre: '_rels/.rels', datos: enc.encode(rels) },
    { nombre: 'xl/workbook.xml', datos: enc.encode(libro) },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: enc.encode(libroRels) },
    { nombre: 'xl/styles.xml', datos: enc.encode(ESTILOS) },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: enc.encode(hojaXml(h, i === 0, !!dibujos[i])) })),
    ...partesDibujo,
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
