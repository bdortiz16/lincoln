// ─────────────────────────────────────────────
// pushLincoin — permiso, suscripción y baja de las notificaciones push.
//
// Vive aparte del panel porque lo va a usar también la app del cliente: lo
// único que cambia entre los dos es a quién se le registra el aparato.
//
// EN iOS SOLO FUNCIONA CON LA APP EN LA PANTALLA DE INICIO
//   Safari no entrega pushes a una pestaña del navegador. Hace falta
//   Compartir → "Añadir a pantalla de inicio" (iOS 16.4 o superior). Por eso
//   `estadoPush()` distingue "el navegador no puede" de "falta instalar la
//   app": son dos problemas con dos soluciones distintas, y decir solo "no se
//   puede" manda a buscar en el lugar equivocado.
//
// EL PERMISO SE PIDE CON UN CLICK, NUNCA SOLO
//   Un navegador ignora (y algunos castigan) el pedido de permiso que no sale
//   de un gesto del usuario. Además, un permiso denegado no se vuelve a pedir:
//   se gasta una sola vez y hay que ir a la configuración del sistema.
// ─────────────────────────────────────────────

const SURL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SKEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

function authHeader(): string {
    try {
        const k = Object.keys(localStorage).find(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (k) {
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            if (d.access_token) return `Bearer ${d.access_token}`;
        }
    } catch { /* sin sesión supabase */ }
    return `Bearer ${SKEY}`;
}

async function callPush(action: string, body: Record<string, unknown> = {}): Promise<any> {
    try {
        const r = await fetch(`${SURL}/functions/v1/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: authHeader() },
            body: JSON.stringify({ action, ...body }),
            signal: AbortSignal.timeout(20000),
        });
        const t = await r.text();
        if (!t) return { ok: false, error: 'El servicio no respondió.' };
        try { return JSON.parse(t); } catch { return { ok: false, error: `Respuesta no válida (HTTP ${r.status})` }; }
    } catch (e: any) {
        return { ok: false, error: `Error de red: ${String(e?.message ?? e)}` };
    }
}

// ─── Qué se puede hacer en ESTE aparato ─────────────────
export type EstadoPush =
    | 'activo'          // suscrito y registrado en el servidor
    | 'permitido'       // el permiso está dado pero falta suscribir
    | 'pedir'           // se puede pedir permiso
    | 'bloqueado'       // el usuario dijo que no; hay que ir a ajustes del sistema
    | 'falta_instalar'  // iOS: la app tiene que estar en la pantalla de inicio
    | 'no_soportado';   // este navegador no hace push

const esIOS = (): boolean => {
    try {
        const ua = navigator.userAgent || '';
        // iPadOS moderno se anuncia como Mac; el touch lo delata.
        return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
    } catch { return false; }
};

export const esStandalone = (): boolean => {
    try {
        return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    } catch { return false; }
};

// `navigator.serviceWorker.ready` NUNCA se resuelve si el registro falló: no
// rechaza, se queda esperando para siempre. Sin este tope, el panel de ajustes
// se quedaba en blanco sin decir por qué.
async function swListo(): Promise<ServiceWorkerRegistration> {
    return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, rechazar) =>
            setTimeout(() => rechazar(new Error('El service worker no llegó a registrarse.')), 6000)),
    ]);
}

export async function estadoPush(): Promise<EstadoPush> {
    if (typeof window === 'undefined') return 'no_soportado';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        // En iOS la ausencia de PushManager casi siempre es "está en una
        // pestaña", no "este iPhone no puede".
        return esIOS() && !esStandalone() ? 'falta_instalar' : 'no_soportado';
    }
    if (esIOS() && !esStandalone()) return 'falta_instalar';

    if (Notification.permission === 'denied') return 'bloqueado';
    if (Notification.permission !== 'granted') return 'pedir';

    try {
        const reg = await swListo();
        const sub = await reg.pushManager.getSubscription();
        return sub ? 'activo' : 'permitido';
    } catch { return 'permitido'; }
}

// ─── Activar ────────────────────────────────────────────
// Llamar SIEMPRE desde un click. Devuelve el motivo en castellano cuando no
// se puede, para poder mostrarlo tal cual.
//
// userId es opcional: con una sesión real de Supabase el servidor sabe quién
// llama y registrarlo con un id del navegador sería dejarle elegir a nombre de
// quién suscribirse. Se manda solo donde la app usa auth propia.
export async function activarPush(userId?: string): Promise<{ ok: boolean; error?: string }> {
    const est = await estadoPush();
    if (est === 'falta_instalar') {
        return { ok: false, error: 'En iPhone las notificaciones solo llegan con la app agregada a la pantalla de inicio: Compartir → "Añadir a pantalla de inicio", y activalas desde ahí.' };
    }
    if (est === 'no_soportado') return { ok: false, error: 'Este navegador no admite notificaciones push.' };
    if (est === 'bloqueado') {
        return { ok: false, error: 'Las notificaciones están bloqueadas para este sitio. Hay que habilitarlas en los ajustes del navegador — el permiso no se puede volver a pedir desde acá.' };
    }

    const r = await callPush('clave', userId ? { user_id: userId } : {});
    if (!r?.ok || !r.clave) {
        return { ok: false, error: r?.message || r?.error || 'Faltan las claves VAPID en el servidor.' };
    }

    if (Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') return { ok: false, error: 'No se dio el permiso de notificaciones.' };
    }

    try {
        const reg = await swListo();
        let sub = await reg.pushManager.getSubscription();
        // Si ya hay una suscripción hecha con OTRA clave VAPID (porque se
        // regeneraron las claves), el navegador rechaza la nueva. Se da de baja
        // la vieja antes de pedir otra.
        if (sub && b64(sub.options?.applicationServerKey) !== r.clave) {
            try { await sub.unsubscribe(); } catch { /* */ }
            sub = null;
        }
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: aBytes(r.clave),
            });
        }
        const g = await callPush('suscribir', {
            ...(userId ? { user_id: userId } : {}),
            sub: JSON.parse(JSON.stringify(sub)),
            ua: navigator.userAgent,
        });
        if (!g?.ok) return { ok: false, error: g?.message || g?.error || 'No se pudo registrar el aparato.' };
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}

// ─── Desactivar ─────────────────────────────────────────
// Se da de baja en el navegador Y en el servidor. Hacer solo lo primero deja
// una fila que falla para siempre; solo lo segundo deja el navegador mandando
// a un endpoint que ya no se lee.
export async function desactivarPush(): Promise<{ ok: boolean; error?: string }> {
    try {
        const reg = await swListo();
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return { ok: true };
        const endpoint = sub.endpoint;
        try { await sub.unsubscribe(); } catch { /* */ }
        await callPush('desuscribir', { endpoint });
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}

export async function probarPush(userId?: string): Promise<{ ok: boolean; error?: string }> {
    const r = await callPush('probar', userId ? { user_id: userId } : {});
    if (r?.ok) return { ok: true };
    return { ok: false, error: r?.message || r?.error || 'No llegó a ningún aparato.' };
}

// ─── base64url ↔ bytes ──────────────────────────────────
function aBytes(s: string): Uint8Array {
    const limpio = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = limpio + '='.repeat((4 - (limpio.length % 4)) % 4);
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function b64(buf: ArrayBuffer | null | undefined): string {
    if (!buf) return '';
    const b = new Uint8Array(buf);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Registro del service worker ────────────────────────
// Se llama una vez al arrancar la app. Sin esto no hay push posible: el
// service worker es lo que sigue vivo cuando la app está cerrada.
export function registrarSW(): void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Después del load: registrar durante el arranque compite por la red con
    // lo que el usuario está esperando ver.
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { /* sin push, la app funciona igual */ });
    });
}
