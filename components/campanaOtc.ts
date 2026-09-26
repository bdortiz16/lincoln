// ─────────────────────────────────────────────
// campanaOtc — el aviso sonoro de que entró un cierre OTC.
//
// Vive aparte porque suena en DOS lugares: dentro de la bandeja de Cierres OTC
// y, sobre todo, desde el panel de admin esté donde esté el operador. Sonar
// solo dentro de la bandeja servía de poco: el aviso existe justamente para
// cuando NO se está mirando esa pantalla.
//
// Se sintetiza en vez de cargar archivos: cinco tonos distintos serían cinco
// assets que servir y esperar, y acá son cinco líneas de frecuencias.
//
// El tono y el volumen se eligen porque quien atiende la mesa tiene esto
// sonando todo el día: el que a una persona le resulta claro, a otra le
// resulta molesto, y un aviso molesto termina apagado.
// ─────────────────────────────────────────────

const CLAVE_ON  = 'lincoin_otc_campana';
const CLAVE_TONO = 'lincoin_otc_campana_tono';
const CLAVE_VOL  = 'lincoin_otc_campana_vol';

type Golpe = [number, number];   // [frecuencia Hz, segundo en que entra]

export type Tono = {
    id: string;
    nombre: string;
    tipo: OscillatorType;
    golpes: Golpe[];
    cola: number;                // cuánto dura el decaimiento de cada golpe
};

export const TONOS: Tono[] = [
    { id: 'campana', nombre: 'Campana',  tipo: 'sine',     golpes: [[987.77, 0], [739.99, 0.16]],               cola: 0.55 },
    { id: 'timbre',  nombre: 'Timbre',   tipo: 'triangle', golpes: [[1318.5, 0], [1760, 0.09]],                 cola: 0.35 },
    { id: 'suave',   nombre: 'Suave',    tipo: 'sine',     golpes: [[523.25, 0], [659.25, 0.14]],               cola: 0.75 },
    { id: 'triple',  nombre: 'Triple',   tipo: 'sine',     golpes: [[880, 0], [880, 0.13], [1174.7, 0.26]],     cola: 0.3  },
    { id: 'grave',   nombre: 'Grave',    tipo: 'sine',     golpes: [[392, 0], [329.63, 0.18]],                  cola: 0.7  },
];

export const tonoPorId = (id: string): Tono => TONOS.find(t => t.id === id) ?? TONOS[0];

export function campanaActiva(): boolean {
    try { return localStorage.getItem(CLAVE_ON) !== 'off'; } catch { return true; }
}
export function guardarCampana(activa: boolean): void {
    try { localStorage.setItem(CLAVE_ON, activa ? 'on' : 'off'); } catch { /* */ }
}

export function tonoActual(): string {
    try { return localStorage.getItem(CLAVE_TONO) || TONOS[0].id; } catch { return TONOS[0].id; }
}
export function guardarTono(id: string): void {
    try { localStorage.setItem(CLAVE_TONO, id); } catch { /* */ }
}

// Volumen 0–1. Fuera de rango o ilegible cae a 0,6: nunca a 0, porque un
// volumen en cero se lee como "la campana está rota" y no como "está en cero".
export function volumenActual(): number {
    try {
        const n = Number(localStorage.getItem(CLAVE_VOL));
        return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.6;
    } catch { return 0.6; }
}
export function guardarVolumen(v: number): void {
    try { localStorage.setItem(CLAVE_VOL, String(Math.min(1, Math.max(0, v)))); } catch { /* */ }
}

let _ctx: any = null;

export function sonarCampana(opts?: { tono?: string; volumen?: number }): void {
    try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        _ctx = _ctx || new AC();
        const ctx = _ctx;
        // El navegador suspende el audio hasta que hay un gesto del usuario.
        // Reanudar es lo único que se puede hacer; si aún no hubo ningún click
        // en la página, no va a sonar y no hay forma de forzarlo.
        if (ctx.state === 'suspended') ctx.resume();

        const t = tonoPorId(opts?.tono ?? tonoActual());
        const vol = Math.min(1, Math.max(0, opts?.volumen ?? volumenActual()));
        if (vol <= 0) return;
        const pico = 0.05 + vol * 0.3;   // tope prudente: esto suena en una oficina
        const now = ctx.currentTime;

        for (const [freq, cuando] of t.golpes) {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = t.tipo;
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now + cuando);
            g.gain.exponentialRampToValueAtTime(pico, now + cuando + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, now + cuando + t.cola);
            o.connect(g); g.connect(ctx.destination);
            o.start(now + cuando);
            o.stop(now + cuando + t.cola + 0.05);
        }
    } catch { /* audio no disponible */ }
}
