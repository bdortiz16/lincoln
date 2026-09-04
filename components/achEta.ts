// ─────────────────────────────────────────────
// achEta — Estimación REAL de llegada de una transferencia ACH en Colombia.
//
// ACH Colombia liquida por CICLOS intradía SOLO en días hábiles (lunes a
// viernes, sin festivos). Modelo de ciclos (hora Colombia, UTC-5):
//   · enviado antes de las 10:00 a. m. → llega ese día entre 12 m. y 2 p. m.
//   · enviado entre 10:00 a. m. y 2:00 p. m. → llega ese día en la tarde (4–6 p. m.)
//   · después de las 2:00 p. m., o en fin de semana/festivo → llega el
//     SIGUIENTE día hábil en la mañana (8–10 a. m.)
//
// Festivos: Colombia usa la Ley Emiliani — 3 grupos:
//   · Fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
//   · Trasladables al LUNES siguiente (si no caen lunes): Reyes (6 ene),
//     San José (19 mar), San Pedro y San Pablo (29 jun), Asunción (15 ago),
//     Día de la Raza (12 oct), Todos los Santos (1 nov), Independencia de
//     Cartagena (11 nov).
//   · Ligados a Pascua: Jueves y Viernes Santo (−3/−2 días), y trasladables
//     al lunes: Ascensión (+39), Corpus Christi (+60), Sagrado Corazón (+68).
// Todo se CALCULA — no depende de una lista quemada ni de internet.
// ─────────────────────────────────────────────

// Domingo de Pascua (computus gregoriano anónimo).
function easterSunday(year: number): Date {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
// Ley Emiliani: si no cae lunes, se corre al lunes siguiente.
const toMonday = (d: Date) => { const dow = d.getUTCDay(); return dow === 1 ? d : addDays(d, (8 - dow) % 7); };

const holidayCache: Record<number, Set<string>> = {};
export function colombiaHolidays(year: number): Set<string> {
    if (holidayCache[year]) return holidayCache[year];
    const H = new Set<string>();
    // Fijos
    for (const [m, day] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]] as const) {
        H.add(key(new Date(Date.UTC(year, m - 1, day))));
    }
    // Trasladables al lunes
    for (const [m, day] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]] as const) {
        H.add(key(toMonday(new Date(Date.UTC(year, m - 1, day)))));
    }
    // Semana Santa y ligados a Pascua
    const easter = easterSunday(year);
    H.add(key(addDays(easter, -3))); // Jueves Santo
    H.add(key(addDays(easter, -2))); // Viernes Santo
    H.add(key(toMonday(addDays(easter, 39)))); // Ascensión
    H.add(key(toMonday(addDays(easter, 60)))); // Corpus Christi
    H.add(key(toMonday(addDays(easter, 68)))); // Sagrado Corazón
    holidayCache[year] = H;
    return H;
}

// "Ahora" en hora Colombia (UTC-5, sin horario de verano), como fecha UTC
// desplazada — así los getUTC* devuelven la hora colombiana.
function nowColombia(): Date {
    return new Date(Date.now() - 5 * 3600 * 1000);
}

export function isBusinessDayCO(d: Date): boolean {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !colombiaHolidays(d.getUTCFullYear()).has(key(d));
}

function nextBusinessDay(d: Date): Date {
    let n = addDays(d, 1);
    while (!isBusinessDayCO(n)) n = addDays(n, 1);
    return n;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dayLabel(target: Date, from: Date): string {
    const diff = Math.round((Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
        - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86400000);
    if (diff === 1) return `mañana ${WEEKDAYS[target.getUTCDay()]}`;
    return `el ${WEEKDAYS[target.getUTCDay()]} ${target.getUTCDate()} de ${MONTHS[target.getUTCMonth()]}`;
}

// Estimación de llegada para un envío ACH hecho AHORA (hora Colombia).
export function achEta(): string {
    const now = nowColombia();
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    if (isBusinessDayCO(now)) {
        if (hour < 10) return 'Hoy, entre 12:00 m. y 2:00 p. m. (ciclo ACH)';
        if (hour < 14) return 'Hoy en la tarde, entre 4:00 y 6:00 p. m. (ciclo ACH)';
    }
    const nbd = nextBusinessDay(now);
    return `${dayLabel(nbd, now)[0].toUpperCase()}${dayLabel(nbd, now).slice(1)}, en la mañana (8–10 a. m.)`;
}

// Versión corta para la lista de métodos del paso 2.
export function achEtaShort(): string {
    const now = nowColombia();
    const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
    if (isBusinessDayCO(now) && hour < 14) return 'llega hoy por ciclos ACH';
    const nbd = nextBusinessDay(now);
    return `llega ${dayLabel(nbd, now)}`;
}
