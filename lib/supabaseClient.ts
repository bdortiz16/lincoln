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
