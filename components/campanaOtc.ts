// ─────────────────────────────────────────────
// campanaOtc — el aviso sonoro de que entró un cierre OTC.
//
// Vive aparte porque suena en DOS lugares: dentro de la bandeja de Cierres OTC
// y, sobre todo, desde el panel de admin esté donde esté el operador. Sonar
// solo dentro de la bandeja servía de poco: el aviso existe justamente para
// cuando NO se está mirando esa pantalla.
//
// Se sintetiza en vez de cargar un archivo: no hay asset que servir ni que
// esperar a que baje para que suene.
// ─────────────────────────────────────────────

const CLAVE = 'lincoin_otc_campana';

export function campanaActiva(): boolean {
    try { return localStorage.getItem(CLAVE) !== 'off'; } catch { return true; }
}

export function guardarCampana(activa: boolean): void {
    try { localStorage.setItem(CLAVE, activa ? 'on' : 'off'); } catch { /* */ }
}

let _ctx: any = null;

export function sonarCampana(): void {
    try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        _ctx = _ctx || new AC();
        const ctx = _ctx;
        // El navegador suspende el audio hasta que hay un gesto del usuario.
        // Reanudar es lo único que se puede hacer; si aún no hubo ningún click
        // en la página, no va a sonar y no hay forma de forzarlo.
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        // Dos golpes descendentes: se reconoce como campana y no como alarma.
        ([[987.77, 0], [739.99, 0.16]] as Array<[number, number]>).forEach(([freq, t]) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, now + t);
            g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.55);
            o.connect(g); g.connect(ctx.destination);
            o.start(now + t);
            o.stop(now + t + 0.6);
        });
    } catch { /* audio no disponible */ }
}
