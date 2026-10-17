import { createClient } from '@supabase/supabase-js';

// Candado de sesión DESACTIVADO (no-op). supabase-js usa navigator.locks
// para coordinar el refresh del token entre pestañas; con varias pestañas
// de Lincoin abiertas el candado se "roba" entre ellas y aborta o cuelga
// peticiones en curso ("AbortError: Lock broken by another request with
// the 'steal' option") — el panel quedaba en "Cargando" eterno. Sin
// candado cada pestaña refresca por su cuenta; Supabase tolera refresh
// concurrente (ventana de reuso de ~10 s del refresh token).
const noLock = async <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn();

// =====================================================
// EMPRESAS (Business) — Proyecto principal
// =====================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const isUrlConfigured = !!SUPABASE_URL && SUPABASE_URL.startsWith('https://');
const isKeyConfigured = !!SUPABASE_ANON_KEY;

export const isSupabaseConfigured = isUrlConfigured && isKeyConfigured;

if (!isSupabaseConfigured) {
    console.warn('Supabase Empresas no está configurado. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.');
}

const validUrl = isSupabaseConfigured ? SUPABASE_URL : 'https://placeholder.supabase.co';
const validKey = isSupabaseConfigured ? SUPABASE_ANON_KEY : 'placeholder-key';

// Cliente Empresas (web) — usado por la app web actual
export const supabase = createClient(validUrl, validKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        lock: noLock,
    },
    global: {
        headers: { 'x-my-custom-header': 'lincoin-empresas' },
    },
});

// =====================================================
// PERSONAS — Proyecto separado (para app móvil + admin de personas)
// =====================================================
// Si no hay proyecto Personas dedicado, se usa el mismo proyecto que Empresas
// (setup de un solo Supabase). Los componentes de /admin-personas ya hacen este
// mismo fallback, así que el cliente lo replica para ser consistente.
const SUPABASE_PERSONAS_URL = (import.meta.env.VITE_SUPABASE_PERSONAS_URL || import.meta.env.VITE_SUPABASE_URL) as string;
const SUPABASE_PERSONAS_ANON_KEY = (import.meta.env.VITE_SUPABASE_PERSONAS_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string;

const isPersonasUrlConfigured = !!SUPABASE_PERSONAS_URL && SUPABASE_PERSONAS_URL.startsWith('https://');
const isPersonasKeyConfigured = !!SUPABASE_PERSONAS_ANON_KEY;

export const isSupabasePersonasConfigured = isPersonasUrlConfigured && isPersonasKeyConfigured;

if (!isSupabasePersonasConfigured) {
    console.warn('Supabase Personas no está configurado. Agrega VITE_SUPABASE_PERSONAS_URL y VITE_SUPABASE_PERSONAS_ANON_KEY a Vercel.');
}

const validPersonasUrl = isSupabasePersonasConfigured ? SUPABASE_PERSONAS_URL : 'https://placeholder-personas.supabase.co';
const validPersonasKey = isSupabasePersonasConfigured ? SUPABASE_PERSONAS_ANON_KEY : 'placeholder-key-personas';

// Cliente Personas — usado por:
//  - App móvil Android (vía Kotlin SDK con sus propias credenciales)
//  - Panel de admin de Personas en /admin-personas
export const supabasePersonas = createClient(validPersonasUrl, validPersonasKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'lincoin-personas-auth', // separa la sesión del cliente principal
        lock: noLock,
    },
    global: {
        headers: { 'x-my-custom-header': 'lincoin-personas' },
    },
});

// =====================================================
// SESIÓN VIGENTE EN TODAS LAS LLAMADAS A SUPABASE
// =====================================================
// Muchas pantallas arman su propio fetch a /functions/v1 o /rest/v1 con el
// token guardado en localStorage. Ese token puede estar vencido: el navegador
// deja de renovarlo con la pestaña oculta y, al volver, lo renueva tarde. El
// resultado eran 401 sueltos — una inscripción que no llegaba, una
// conversión que caía al camino de error. En vez de tocar cada llamada, se
// intercepta acá: si el token de usuario que viaja vence en menos de un
// minuto, se renueva la sesión y se manda el nuevo.
let renovando: Promise<string | null> | null = null;
function vencePronto(token: string): boolean {
    try {
        const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (p?.role !== 'authenticated' || !p?.exp) return false;
        return Number(p.exp) * 1000 - Date.now() < 60_000;
    } catch { return false; }
}
function renovarUnaVez(): Promise<string | null> {
    if (!renovando) {
        renovando = supabase.auth.refreshSession()
            .then(r => r.data?.session?.access_token ?? null)
            .catch(() => null)
            .finally(() => { setTimeout(() => { renovando = null; }, 5000); });
    }
    return renovando;
}
if (typeof window !== 'undefined' && isSupabaseConfigured && !(window as any).__lcFetchSesion) {
    (window as any).__lcFetchSesion = true;
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        try {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
            if (url.startsWith(SUPABASE_URL) && (url.includes('/functions/v1/') || url.includes('/rest/v1/'))) {
                const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
                const auth = h.get('Authorization') ?? h.get('authorization') ?? '';
                const tok = auth.replace(/^Bearer\s+/i, '');
                if (tok && vencePronto(tok)) {
                    const nuevo = await renovarUnaVez();
                    if (nuevo) {
                        h.set('Authorization', `Bearer ${nuevo}`);
                        if (input instanceof Request) return fetchOriginal(new Request(input, { ...init, headers: h }));
                        return fetchOriginal(input, { ...init, headers: h });
                    }
                }
            }
        } catch { /* ante cualquier duda, la llamada sale tal cual */ }
        return fetchOriginal(input as any, init);
    };
}
