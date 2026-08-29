import React, { useState, useEffect } from 'react';
import { BookUser, Plus, X, Trash2, CheckCircle, AlertTriangle, Landmark, Wallet, Search, SlidersHorizontal, Zap } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { supabase } from '../lib/supabaseClient';
import { FlagImg } from './FlagImg';

declare const __BUILD_TS__: string;

// Mouv fue retirado (migración a Mouv). La inscripción/sincronización de
// cuentas destino con el proveedor queda deshabilitada: los contactos se
// guardan localmente y las llamadas al proveedor devuelven "no disponible"
// para que el flujo degrade con gracia en lugar de romperse.
const callMouv = async (_action: string, _userId: string, _extra?: any): Promise<any> =>
    ({ ok: false, status: 0, path: '', data: { error: 'Proveedor de dispersión en migración a Mouv' } });

// ─────────────────────────────────────────────
// ContactsSection — Contactos (cuentas bancarias destino) de EMPRESAS.
//
// Modelo Mouv: antes de dispersar hay que INSCRIBIR la cuenta destino
// (external account). Aquí el cliente registra sus contactos:
//   1. Se intenta inscribir en Mouv (create_external_account).
//   2. Se guarda en raw_data.mouvContacts del usuario (con el id de
//      Mouv si la inscripción pasó; 'pendiente' si no).
// El flujo de Enviar Dinero (COP · banco) usa estos contactos inscritos.
// ─────────────────────────────────────────────

// Ciclo de vida (modelo Mouv):
//   Colombia → al inscribir queda EN PROCESO y la API de Mouv la pasa a
//              APROBADA o RECHAZADA (se sincroniza automáticamente).
//   Otros países → se aprueban AUTOMÁTICAMENTE al inscribir (no pasan por Mouv).
export type ContactStatus = 'en_proceso' | 'aprobada' | 'rechazada';

export interface MouvContact {
    id: string;
    mouvId: string | null;   // id de la external account en Mouv (null = pendiente)
    kind: 'persona' | 'empresa';
    name: string;
    docType: string;
    docNumber: string;
    country: string;
    bank: string;
    accountType: 'savings' | 'checking';
    accountNumber: string;     // cuenta bancaria — o dirección de la wallet
    status: ContactStatus;
    createdAt: string;
    // Tipo de destino: cuenta bancaria (default) o wallet cripto (solo
    // para envíos en USD). Las wallets se aprueban automáticamente.
    accountKind?: 'bank' | 'wallet';
    walletCoin?: 'USDT' | 'USDC';
    walletNetwork?: 'TRC-20' | 'BEP-20';
    // Última respuesta de Mouv al intentar inscribir (null = ok). Visible
    // en el detalle para diagnosticar rechazos de campos/validación.
    lastError?: string | null;
    // Tipo de destino Colombia (modelo Mouv): 'ach' = cuenta bancaria
    // (default, retrocompatible con contactos viejos) · 'breb' = llave Bre-B.
    destKind?: 'ach' | 'breb';
    // Solo Bre-B: tipo de llave y valor.
    brebKeyType?: 'celular' | 'cedula' | 'correo' | 'alfanumerico';
    brebKey?: string;
    // Contacto opcional del destinatario — SOLO notificaciones, no mueve dinero.
    notifyEmail?: string;
    notifyPhone?: string;
}

// Tipos de llave Bre-B (igual que la consola de Mouv).
const BREB_KEY_TYPES = [
    { v: 'celular', l: 'Celular' },
    { v: 'cedula', l: 'Cédula' },
    { v: 'correo', l: 'Correo' },
    { v: 'alfanumerico', l: 'Llave alfanumérica' },
] as const;

const brebKeyLabel = (v?: string) => BREB_KEY_TYPES.find(k => k.v === v)?.l ?? 'Llave';

// Estado efectivo (contactos viejos sin campo status → en proceso si son
// de Colombia; aprobados si son de otro país).
export const contactStatus = (c: Partial<MouvContact>): ContactStatus => {
    // Mientras Mouv no esté APIficado no hay "en proceso": todo destinatario
    // inscrito queda aprobado y usable. Los contactos viejos sin estado (o que
    // quedaron 'en_proceso') se muestran como aprobados.
    if (c.status && c.status !== 'en_proceso') return c.status;
    return 'aprobada';
};

// Cuerpo EXACTO del contrato oficial (doc: Create External Account):
// POST /v0/external-accounts
// { account: { geo, account_type (savings|checking), account_number,
//   financial_institution_code, account_holder_fullname,
//   account_holder_id_type (CC|CE|NIT), account_holder_id_number } }
// → 201 { id: "ea_...", ... }
const buildMouvAccountBody = (c: { name: string; docType: string; docNumber: string; bank: string; accountType: string; accountNumber: string; kind?: string }) => ({
    account: {
        geo: 'CO',
        account_type: c.accountType,
        account_number: c.accountNumber,
        financial_institution_code: BANK_CODES_CO[c.bank] ?? '',
        account_holder_fullname: c.name,
        // Enum de Mouv: CC | CE | NIT (PAS no existe → se envía como CE)
        account_holder_id_type: c.docType === 'PAS' ? 'CE' : c.docType,
        account_holder_id_number: c.docNumber,
    },
});

// Cuerpo para inscribir una llave BRE-B como destino en Mouv.
// ⚠️ El contrato EXACTO del endpoint Bre-B aún no está confirmado en la doc
// (developer.mouvlatam.com está bloqueada desde aquí). Este body sigue la
// forma del create-external-account con la variante de llave; cuando llegue
// el cURL real, ajusta los nombres de campo en un solo lugar (aquí).
const buildMouvBrebBody = (c: { name: string; brebKeyType: string; brebKey: string; docType?: string; docNumber?: string }) => ({
    account: {
        geo: 'CO',
        rail: 'BREB',
        breb_key_type: c.brebKeyType,   // celular | cedula | correo | alfanumerico
        breb_key: c.brebKey,
        account_holder_fullname: c.name,
        ...(c.docType ? { account_holder_id_type: c.docType === 'PAS' ? 'CE' : c.docType } : {}),
        ...(c.docNumber ? { account_holder_id_number: c.docNumber } : {}),
    },
});

const normalizeStatus = (v: unknown): ContactStatus | null => {
    const s = String(v ?? '').toLowerCase();
    if (!s) return null;
    if (/aprob|approv|active|activa|complete|enabled|verified|success/.test(s)) return 'aprobada';
    if (/rechaz|reject|denied|declin|fail/.test(s)) return 'rechazada';
    if (/proces|pend|review|revis|created|unconfirmed/.test(s)) return 'en_proceso';
    return null;
};

const BANKS_CO = [
    'Bancolombia', 'Banco de Bogotá', 'Davivienda', 'BBVA Colombia',
    'Banco de Occidente', 'Banco Popular', 'Scotiabank Colpatria',
    'Banco AV Villas', 'Banco Agrario', 'Banco Caja Social', 'Itaú',
    'Nequi', 'Daviplata', 'Nu Colombia', 'Lulo Bank', 'Movii', 'Otro',
];

// Códigos ACH Colombia (financial_institution_code — lo exige la
// validación de Mouv: "financial_institution_code should not be empty").
const BANK_CODES_CO: Record<string, string> = {
    'Banco de Bogotá': '1001',
    'Banco Popular': '1002',
    'Itaú': '1006',
    'Bancolombia': '1007',
    'Citibank': '1009',
    'GNB Sudameris': '1012',
    'BBVA Colombia': '1013',
    'Scotiabank Colpatria': '1019',
    'Banco de Occidente': '1023',
    'Banco Caja Social': '1032',
    'Banco Agrario': '1040',
    'Davivienda': '1051',
    'Banco AV Villas': '1052',
    'Banco Pichincha': '1060',
    'Bancoomeva': '1061',
    'Banco Falabella': '1062',
    'Coopcentral': '1066',
    'Lulo Bank': '1070',
    'Nequi': '1507',
    'Daviplata': '1551',
    'Movii': '1801',
    'Nu Colombia': '1809',
};

const DOC_TYPES = [
    { v: 'CC', l: 'Cédula de ciudadanía' },
    { v: 'CE', l: 'Cédula de extranjería' },
    { v: 'NIT', l: 'NIT (empresa)' },
    { v: 'PAS', l: 'Pasaporte' },
];

const CONTACT_COUNTRIES = [
    { code: 'CO', name: 'Colombia' },
    { code: 'CL', name: 'Chile' },
    { code: 'PE', name: 'Perú' },
    { code: 'MX', name: 'México' },
    { code: 'BR', name: 'Brasil' },
    { code: 'VE', name: 'Venezuela' },
    { code: 'US', name: 'Estados Unidos' },
];

const emptyForm = {
    kind: 'persona' as 'persona' | 'empresa',
    country: 'Colombia',
    name: '', docType: 'CC', docNumber: '', bank: '',
    accountType: 'savings' as 'savings' | 'checking', accountNumber: '',
    accountKind: 'bank' as 'bank' | 'wallet',
    walletCoin: 'USDT' as 'USDT' | 'USDC',
    walletNetwork: 'TRC-20' as 'TRC-20' | 'BEP-20',
    // Destino Colombia: Bre-B (llave) o ACH (cuenta bancaria).
    destKind: 'ach' as 'ach' | 'breb',
    brebKeyType: 'celular' as 'celular' | 'cedula' | 'correo' | 'alfanumerico',
    brebKey: '',
    notifyEmail: '',
    notifyPhone: '',
};

const WALLET_ADDR_RX: Record<string, RegExp> = {
    'TRC-20': /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
    'BEP-20': /^0x[0-9a-fA-F]{40}$/,
};

// Chip de filtro reutilizable (buscador + filtros de la lista de contactos)
const FilterChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        type="button"
        onClick={onClick}
        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${active ? 'bg-[#4ADE80] text-[#0C0E0D] border-[#4ADE80]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
    >
        {children}
    </button>
);

export const ContactsSection: React.FC<{ onBack?: () => void; onSendTo?: (c: MouvContact) => void }> = ({ onBack, onSendTo }) => {
    const { currentUser, updateUserRawData } = useDatabase();
    // Menú "···" abierto (id del contacto)
    const [menuFor, setMenuFor] = useState<string | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    // Paso 0: ¿banco o wallet? → banco: país → datos · wallet: datos wallet
    const [formStep, setFormStep] = useState<'type' | 'country' | 'data' | 'wallet'>('type');
    const [form, setForm] = useState({ ...emptyForm });
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    // Contacto abierto en el modal de detalle (clic sobre la fila)
    const [detail, setDetail] = useState<MouvContact | null>(null);

    // Buscador + filtros de la lista
    const [search, setSearch] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [fCountry, setFCountry] = useState('all');
    const [fType, setFType] = useState<'all' | 'bank' | 'wallet'>('all');
    const [fStatus, setFStatus] = useState<'all' | 'aprobada' | 'en_proceso' | 'rechazada'>('all');

    // ── INFRAESTRUCTURA SEPARADA ─────────────────────────────
    // Cuentas bancarias (mouvContacts) y wallets (walletContacts) viven
    // en LISTAS DISTINTAS de raw_data: guardar una jamás pisa a la otra.
    // Cada lista puede venir anidada (raw_data.X, recién guardada) o
    // aplanada al nivel superior (perfil recargado) — se lee donde esté.
    const cu: any = currentUser as any;
    const readList = (key: string): MouvContact[] =>
        Array.isArray(cu?.raw_data?.[key]) ? cu.raw_data[key]
        : Array.isArray(cu?.[key]) ? cu[key]
        : [];
    const rawBankList = readList('mouvContacts');
    // Compat: wallets viejas que quedaron dentro de mouvContacts
    const bankContacts: MouvContact[] = rawBankList.filter((c: any) => c?.accountKind !== 'wallet');
    const walletContacts: MouvContact[] = [
        ...readList('walletContacts'),
        ...rawBankList.filter((c: any) => c?.accountKind === 'wallet'),
    ];
    // Vista combinada (lista e interfaz)
    const contacts: MouvContact[] = [...walletContacts, ...bankContacts];

    // Guarda UNA lista bajo SU llave a TRAVÉS DEL SERVIDOR (service-role):
    // la edge function escribe raw_data sin pasar por RLS ni el candado —
    // así se acabó el "se guarda en memoria y desaparece al recargar".
    // Actualiza el estado local con lo que la base confirma que quedó.
    const persistKey = async (key: 'mouvContacts' | 'walletContacts', list: MouvContact[]): Promise<boolean> => {
        if (!currentUser?.id) return false;
        // Guardado DIRIGIDO: escribe SOLO raw_data.<key> (merge server-side).
        // Antes iba por updateUserProfile, que escribe el perfil COMPLETO
        // (balances incluidos) — el candado de columnas sensibles rechazaba
        // TODO el update cuando los saldos en memoria estaban desactualizados
        // (p. ej. tras un cargue del admin) y el contacto se perdía al
        // recargar. Devuelve true solo si la base confirmó el write.
        return updateUserRawData(currentUser.id, { [key]: list });
    };
    const persistBanks = (list: MouvContact[]) => persistKey('mouvContacts', list.filter((c: any) => c?.accountKind !== 'wallet'));
    const persistWallets = (list: MouvContact[]) => persistKey('walletContacts', list.filter((c: any) => c?.accountKind === 'wallet'));

    // Normaliza un número de cuenta / dirección para comparar (solo dígitos en
    // bancos; minúsculas y sin espacios en wallets) → detectar duplicados.
    const normAccount = (v: string, isWallet: boolean) =>
        isWallet ? v.trim().toLowerCase() : v.replace(/\D/g, '');

    const saveContact = async () => {
        if (!currentUser?.id || saving) return;
        const f = form;

        // ── Wallet (solo USD): validar dirección y guardar aprobada ──
        if (f.accountKind === 'wallet') {
            if (!f.name.trim()) { setNotice({ ok: false, text: 'Ponle un nombre o alias al destinatario.' }); return; }
            if (!WALLET_ADDR_RX[f.walletNetwork]?.test(f.accountNumber.trim())) {
                setNotice({ ok: false, text: f.walletNetwork === 'TRC-20'
                    ? 'Dirección TRC-20 inválida: debe empezar con T y tener 34 caracteres.'
                    : 'Dirección BEP-20 inválida: debe empezar con 0x y tener 42 caracteres.' });
                return;
            }
            // Deduplicar: la misma dirección + red ya inscrita → no repetir.
            const wAddr = normAccount(f.accountNumber, true);
            const dupW = walletContacts.find(c => normAccount(c.accountNumber, true) === wAddr && (c.walletNetwork ?? 'TRC-20') === f.walletNetwork);
            if (dupW) { setNotice({ ok: false, text: `Ya tienes esta wallet inscrita como “${dupW.name}”. No es necesario inscribirla de nuevo.` }); return; }
            setSaving(true);
            const wc: MouvContact = {
                id: `ct_${Math.random().toString(36).slice(2, 10)}`,
                mouvId: null,
                kind: f.kind,
                name: f.name.trim(),
                docType: '—', docNumber: '—',
                country: 'Estados Unidos',
                bank: `Wallet ${f.walletCoin} ${f.walletNetwork}`,
                accountType: 'savings',
                accountNumber: f.accountNumber.trim(),
                status: 'aprobada',
                createdAt: new Date().toISOString(),
                lastError: null,
                accountKind: 'wallet',
                walletCoin: f.walletCoin,
                walletNetwork: f.walletNetwork,
            };
            const okW = await persistWallets([wc, ...walletContacts]);
            setSaving(false);
            setFormOpen(false);
            setForm({ ...emptyForm });
            setNotice(okW
                ? { ok: true, text: `✅ Wallet inscrita (${wc.name}). Ya puedes enviarle USD.` }
                : { ok: false, text: '⚠ El contacto NO quedó guardado en el servidor (sesión vencida o permisos de la base). Cierra sesión, vuelve a entrar e inscríbelo otra vez. Si persiste, avísale al administrador.' });
            return;
        }

        // ── BRE-B (solo Colombia): inscribir por llave ──
        if (f.country === 'Colombia' && f.destKind === 'breb') {
            if (!f.name.trim()) { setNotice({ ok: false, text: 'Ponle un alias al destinatario.' }); return; }
            if (!f.brebKey.trim()) { setNotice({ ok: false, text: 'Escribe la llave Bre-B.' }); return; }
            const keyNorm = f.brebKey.trim().toLowerCase();
            const dupK = bankContacts.find(c => c.destKind === 'breb' && (c.brebKey ?? '').trim().toLowerCase() === keyNorm);
            if (dupK) { setNotice({ ok: false, text: `Ya tienes esta llave inscrita como “${dupK.name}”.` }); return; }
            setSaving(true); setNotice(null);
            // Mientras Mouv no esté APIficado, el destinatario queda APROBADO y
            // usable de una (sin "en proceso"). Cuando se cablee Mouv, aquí se
            // intentará el registro real y su verificación.
            const brebContact: MouvContact = {
                id: `ct_${Math.random().toString(36).slice(2, 10)}`,
                mouvId: null, kind: f.kind, name: f.name.trim(),
                docType: f.docType, docNumber: f.docNumber.trim() || '—',
                country: 'Colombia', bank: `Bre-B · ${brebKeyLabel(f.brebKeyType)}`,
                accountType: 'savings', accountNumber: f.brebKey.trim(),
                status: 'aprobada', createdAt: new Date().toISOString(), lastError: null,
                destKind: 'breb', brebKeyType: f.brebKeyType, brebKey: f.brebKey.trim(),
                notifyEmail: f.notifyEmail.trim() || undefined, notifyPhone: f.notifyPhone.trim() || undefined,
            };
            const okK = await persistBanks([brebContact, ...bankContacts]);
            setSaving(false); setFormOpen(false); setForm({ ...emptyForm });
            if (!okK) { setNotice({ ok: false, text: '⚠ El destinatario NO quedó guardado en el servidor (sesión vencida o permisos). Vuelve a entrar e inscríbelo otra vez.' }); return; }
            setNotice({ ok: true, text: `✅ Destinatario Bre-B inscrito (${brebContact.name}). Ya puedes dispersarle.` });
            return;
        }

        if (!f.name.trim() || !f.docNumber.trim() || !f.bank.trim() || !f.accountNumber.trim()) {
            setNotice({ ok: false, text: 'Completa nombre, documento, banco y número de cuenta.' });
            return;
        }
        // Deduplicar: mismo banco + mismo número de cuenta ya inscrito → no repetir.
        const bAcc = normAccount(f.accountNumber, false);
        const dupB = bankContacts.find(c => normAccount(c.accountNumber, false) === bAcc && (c.bank || '').toLowerCase() === f.bank.toLowerCase() && (c.country || 'Colombia') === f.country);
        if (dupB) { setNotice({ ok: false, text: `Ya tienes esta cuenta de ${f.bank} inscrita como “${dupB.name}”. No es necesario inscribirla de nuevo.` }); return; }
        setSaving(true);
        setNotice(null);

        // Mientras Mouv no esté APIficado, la cuenta queda APROBADA y usable de
        // una (sin "en proceso"). Cuando se cablee Mouv, aquí volverá el
        // registro real (create_external_account) y su verificación.
        const mouvId: string | null = null;
        const status: ContactStatus = 'aprobada';
        const lastError: string | null = null;

        const contact: MouvContact = {
            id: `ct_${Math.random().toString(36).slice(2, 10)}`,
            mouvId,
            kind: f.kind,
            name: f.name.trim(),
            docType: f.docType,
            docNumber: f.docNumber.trim(),
            country: f.country,
            bank: f.bank,
            accountType: f.accountType,
            accountNumber: f.accountNumber.trim(),
            status,
            createdAt: new Date().toISOString(),
            lastError,
            destKind: 'ach',
        };
        const okB = await persistBanks([contact, ...bankContacts]);
        setSaving(false);
        setFormOpen(false);
        setForm({ ...emptyForm });
        if (!okB) { setNotice({ ok: false, text: '⚠ El contacto NO quedó guardado en el servidor (sesión vencida o permisos de la base). Cierra sesión, vuelve a entrar e inscríbelo otra vez. Si persiste, avísale al administrador.' }); return; }
        setNotice({ ok: true, text: `✅ Contacto inscrito (${contact.name}). Ya puedes transferirle.` });
    };

    // ── Sincronizar estados con Mouv (solo contactos de Colombia) ──
    // Lee las external accounts de Mouv y empareja por número de cuenta:
    // el estado del portal (Aprobada / Rechazada / En proceso) manda.
    const [syncing, setSyncing] = useState(false);
    // Respuesta cruda de la lista de cuentas de Mouv (debug del matching)
    const [listRaw, setListRaw] = useState<any>(null);
    const syncStatuses = async (silent = false) => {
        if (!currentUser?.id || syncing) return;
        const targets = bankContacts.filter(c => (c.country ?? 'Colombia') === 'Colombia');
        if (targets.length === 0) return;
        setSyncing(true);
        try {
            // 0) Reintentar la inscripción de contactos de Colombia que quedaron
            //    sin ID de Mouv (la primera inscripción falló — auth o red).
            let retried = bankContacts;
            const pendingReg = bankContacts.filter(c => (c.country ?? 'Colombia') === 'Colombia' && !c.mouvId);
            for (const c of pendingReg) {
                try {
                    const rr = await callMouv('create_external_account', currentUser.id, {
                        data: c.destKind === 'breb'
                            ? buildMouvBrebBody({ name: c.name, brebKeyType: c.brebKeyType ?? 'celular', brebKey: c.brebKey ?? c.accountNumber, docType: c.docType, docNumber: c.docNumber })
                            : buildMouvAccountBody(c),
                    });
                    const dd = (rr?.data ?? {}) as any;
                    const fid = dd.id ?? dd.external_account_id ?? dd.account_id ?? null;
                    if (rr?.ok && fid) {
                        retried = retried.map(x => x.id === c.id
                            ? { ...x, mouvId: fid, status: normalizeStatus(dd.verification_status ?? dd.status ?? dd.estado ?? dd.state) ?? 'en_proceso', lastError: null }
                            : x);
                    } else {
                        // Guardar el rechazo de Mouv — visible en el detalle del contacto
                        const err = `[${new Date().toLocaleTimeString('es-CO')}] HTTP ${rr?.status ?? '—'} en ${rr?.path ?? '¿?'}: ${JSON.stringify(rr?.data ?? rr).slice(0, 260)}`;
                        retried = retried.map(x => x.id === c.id ? { ...x, lastError: err } : x);
                    }
                } catch (e: any) {
                    const err = String(e?.message ?? e);
                    retried = retried.map(x => x.id === c.id ? { ...x, lastError: err } : x);
                }
            }
            if (retried !== bankContacts) await persistBanks(retried);

            const r = await callMouv('external_accounts', currentUser.id);
            setListRaw({ status: r?.status, path: r?.path, data: r?.data });
            const d: any = r?.data ?? {};
            let rows: any[] = Array.isArray(d) ? d
                : Array.isArray(d.data) ? d.data
                : Array.isArray(d.items) ? d.items
                : Array.isArray(d.accounts) ? d.accounts
                : Array.isArray(d.external_accounts) ? d.external_accounts
                : Array.isArray(d.results) ? d.results : [];
            // Fallback: primer array de objetos que aparezca (hasta 2 niveles)
            if (rows.length === 0 && d && typeof d === 'object') {
                outer: for (const v of Object.values(d)) {
                    if (Array.isArray(v) && v.length && typeof v[0] === 'object') { rows = v as any[]; break; }
                    if (v && typeof v === 'object') {
                        for (const vv of Object.values(v as Record<string, unknown>)) {
                            if (Array.isArray(vv) && vv.length && typeof vv[0] === 'object') { rows = vv as any[]; break outer; }
                        }
                    }
                }
            }
            if (rows.length > 0) {
                let changed = false;
                const newlyApproved: MouvContact[] = [];
                const next = retried.map(c => {
                    if ((c.country ?? 'Colombia') !== 'Colombia') return c;
                    const row = rows.find((x: any) => {
                        // 1) Por ID de Mouv (infalible cuando lo tenemos)
                        const rid = String(x.id ?? x.external_account_id ?? x.account_id ?? '');
                        if (c.mouvId && rid && rid === c.mouvId) return true;
                        // 2) Por número de cuenta — comparando solo dígitos, y
                        //    tolerando números enmascarados (****1185)
                        const acc = String(x.account_number ?? x.accountNumber ?? x.number ?? x.account ?? '');
                        const accDigits = acc.replace(/\D/g, '');
                        const cDigits = String(c.accountNumber).replace(/\D/g, '');
                        if (!accDigits || !cDigits) return false;
                        if (accDigits === cDigits) return true;
                        return /[*·•]/.test(acc) && accDigits.length >= 4 && cDigits.endsWith(accDigits.slice(-4));
                    });
                    if (!row) return c;
                    const st = normalizeStatus(row.verification_status ?? row.status ?? row.estado ?? row.state);
                    const fid = row.id ?? row.external_account_id ?? row.account_id ?? c.mouvId;
                    if ((st && st !== contactStatus(c)) || (fid && fid !== c.mouvId)) {
                        changed = true;
                        const wasApproved = contactStatus(c) === 'aprobada';
                        const updated = { ...c, status: st ?? contactStatus(c), mouvId: fid ?? c.mouvId };
                        if (st === 'aprobada' && !wasApproved) newlyApproved.push(updated);
                        return updated;
                    }
                    return c;
                });
                if (changed) {
                    await persistBanks(next);
                    // Correo "Contacto aprobado" — server-side, al correo del
                    // propio usuario. Solo en la TRANSICIÓN a aprobada (la
                    // persistencia evita reenviarlo en cada sincronización).
                    for (const c of newlyApproved) {
                        callMouv('email_event', currentUser!.id, {
                            subject: 'Lincoin · Contacto aprobado',
                            title: 'Contacto aprobado',
                            message: `La cuenta de <strong>${c.name}</strong> quedó aprobada. Ya puedes transferirle.`,
                        }).catch(() => {});
                    }
                    if (!silent) setNotice({ ok: true, text: 'Estados sincronizados con Mouv.' });
                } else if (!silent) {
                    setNotice({ ok: true, text: 'Estados al día — sin cambios.' });
                }
            } else if (!silent) {
                // Mostrar la respuesta cruda ayuda a mapear el formato real de la lista
                setNotice({ ok: false, text: `Mouv no devolvió cuentas para comparar. Respuesta (${r?.status ?? '—'}): ${JSON.stringify(r?.data ?? r).slice(0, 220)}` });
            }
        } catch { /* red flaky: se reintenta en la próxima visita */ }
        setSyncing(false);
    };

    // Sincronización con Mouv DESACTIVADA mientras el proveedor no esté
    // APIficado: los contactos quedan aprobados y usables de una. (Antes esto
    // corría contra un stub y dejaba los contactos "en proceso" o los perdía.)
    // useEffect(() => { syncStatuses(true); }, [currentUser?.id]);

    const removeContact = async (id: string) => {
        if (!window.confirm('¿Eliminar este contacto?')) return;
        const target = contacts.find(c => c.id === id);
        const isWallet = walletContacts.some(c => c.id === id);
        // 1) Quitar de la lista local del usuario (cada tipo de SU lista).
        const removedOk = isWallet
            ? await persistWallets(walletContacts.filter(c => c.id !== id))
            : await persistBanks(bankContacts.filter(c => c.id !== id));
        if (!removedOk) { setNotice({ ok: false, text: 'No se pudo eliminar el contacto. Reintenta.' }); return; }
        // 2) Des-inscribir en Mouv (solo cuentas bancarias de Colombia con id).
        //    El backend verifica que NINGÚN otro usuario la siga usando antes de
        //    borrarla allá — Mouv es una sola cuenta de empresa compartida.
        if (target && target.accountKind !== 'wallet' && (target.country ?? 'Colombia') === 'Colombia' && target.mouvId) {
            try {
                const r = await callMouv('delete_external_account', currentUser!.id, {
                    mouvId: target.mouvId,
                    accountNumber: target.accountNumber,
                });
                if (r?.deletedInMouv) setNotice({ ok: true, text: 'Contacto eliminado — también des-inscrito en el banco (Mouv).' });
                else if (r?.reason === 'still_used') setNotice({ ok: true, text: 'Contacto eliminado de tu lista. La cuenta sigue inscrita porque otro usuario también la tiene.' });
                else setNotice({ ok: true, text: 'Contacto eliminado.' });
            } catch { setNotice({ ok: true, text: 'Contacto eliminado de tu lista.' }); }
        } else {
            setNotice({ ok: true, text: 'Contacto eliminado.' });
        }
    };

    const mask = (acc: string) => acc.length > 4 ? `···${acc.slice(-4)}` : acc;

    // ── Buscador + filtros ───────────────────────────────────
    // Países: los que el usuario ya tiene inscritos, primero; luego el resto
    // de países soportados por la app (para poder filtrar aunque no tenga
    // contactos en todos todavía).
    const presentCountries = Array.from(new Set(contacts.map(c => c.country || 'Colombia')));
    const countryOptions = Array.from(new Set([...presentCountries, ...CONTACT_COUNTRIES.map(c => c.name)]));
    const q = search.trim().toLowerCase();
    const filteredContacts = contacts.filter(c => {
        const isWallet = c.accountKind === 'wallet';
        if (fType === 'wallet' && !isWallet) return false;
        if (fType === 'bank' && isWallet) return false;
        if (fStatus !== 'all' && contactStatus(c) !== fStatus) return false;
        if (fCountry !== 'all' && (c.country || 'Colombia') !== fCountry) return false;
        if (q) {
            const hay = [c.name, c.bank, c.accountNumber, c.docNumber, c.country, c.walletCoin, c.walletNetwork]
                .filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });
    const activeFilters = (fCountry !== 'all' ? 1 : 0) + (fType !== 'all' ? 1 : 0) + (fStatus !== 'all' ? 1 : 0);
    const clearFilters = () => { setFCountry('all'); setFType('all'); setFStatus('all'); };

    // ── Diseño "Beneficiarios": helpers de fila ─────────────────────────
    // Banderas en CSS puro (círculo, sin imágenes) — patrón del handoff.
    const FLAG_BG: Record<string, string> = {
        Colombia:  'linear-gradient(180deg,#FCD116 0%,#FCD116 50%,#003893 50%,#003893 75%,#CE1126 75%,#CE1126 100%)',
        'Brasil':  'radial-gradient(circle at 50% 50%, #002776 0 24%, #FFDF00 25% 46%, #009C3B 47%)',
        'México':  'linear-gradient(90deg,#006847 0 33%,#FFFFFF 33% 66%,#CE1126 66%)',
        'Perú':    'linear-gradient(90deg,#D91023 0 33%,#FFFFFF 33% 66%,#D91023 66%)',
        'Chile':   'linear-gradient(90deg, #0039A6 0 40%, rgba(0,0,0,0) 40%) 0 0/100% 50% no-repeat, linear-gradient(180deg,#FFFFFF 0 50%,#D52B1E 50%)',
        'Venezuela':'linear-gradient(180deg,#FFCC00 0 33%,#00247D 33% 66%,#CF142B 66%)',
        'Ecuador': 'linear-gradient(180deg,#FFD100 0 50%,#0072CE 50% 75%,#EF3340 75%)',
        'Argentina':'linear-gradient(180deg,#74ACDF 0 33%,#FFFFFF 33% 66%,#74ACDF 66%)',
    };
    // Riel y moneda por país (paso 1 del modal) — config, no hardcode en UI.
    const COUNTRY_RAILS: Record<string, string> = {
        Colombia: 'Bre-B · ACH · COP', Chile: 'Transferencia · CLP', 'Perú': 'Transferencia · PEN',
        'México': 'Transferencia · MXN', Brasil: 'Transferencia · BRL', Venezuela: 'Transferencia · VES',
        'Estados Unidos': 'Wallet USDT · TRC-20',
    };
    // Tokens de inputs del modal (diseño: 46px, fondo translúcido, sin blanco)
    const INP: React.CSSProperties = {
        width: '100%', height: 46, marginTop: 6, padding: '0 14px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, color: '#F4F4F2', fontSize: 14, outline: 'none', fontFamily: 'inherit',
    };
    const LBL: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: '1.4px', color: '#878E88', textTransform: 'uppercase' as const, display: 'block' };
    const ShieldCheckIcon = () => (
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="#878E88" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10 2.5l6 2.2v4.5c0 3.6-2.4 6.4-6 8.3-3.6-1.9-6-4.7-6-8.3V4.7l6-2.2z" />
            <path d="M7.5 10l1.8 1.8 3.2-3.6" />
        </svg>
    );
    const initialsOf = (name: string) => {
        const parts = String(name || '').trim().split(/\s+/);
        return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '·';
    };
    // Capitalización normal aunque el nombre venga en MAYÚSCULAS sostenidas.
    const prettyName = (name: string) => {
        const n = String(name || '').trim();
        if (n && n === n.toUpperCase() && n.length > 3) {
            return n.toLowerCase().replace(/(^|\s|\.)\p{L}/gu, ch => ch.toUpperCase());
        }
        return n;
    };
    const last4 = (v?: string) => { const d = String(v ?? '').replace(/\s/g, ''); return d.length > 4 ? d.slice(-4) : d; };
    const rowMeta = (c: MouvContact) => {
        const isWallet = c.accountKind === 'wallet';
        const country = isWallet ? null : (c.country || 'Colombia');
        const railLine = isWallet
            ? `${c.walletCoin ?? 'USDT'} · ${c.walletNetwork ?? 'TRC-20'}`
            : c.destKind === 'breb' ? `Bre-B · ${brebKeyLabel(c.brebKeyType)}`
            : country === 'Colombia' ? 'ACH · Cuenta bancaria'
            : 'Transferencia local';
        const bankName = isWallet ? 'Wallet' : (c.destKind === 'breb' ? (c.bank?.startsWith('Bre-B') ? '—' : c.bank) : (c.bank || '—'));
        const maskLine = isWallet
            ? `${mask(c.accountNumber)} · USDT`
            : c.destKind === 'breb'
                ? `Llave ···${last4(c.brebKey ?? c.accountNumber)} · COP`
                : `${c.accountType === 'savings' ? 'Ahorros' : 'Corriente'} ···${last4(c.accountNumber)} · ${country === 'Colombia' ? 'COP' : 'Local'}`;
        const created = c.createdAt ? new Date(c.createdAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : '';
        const meta = `${isWallet ? 'Wallet' : c.kind === 'empresa' ? 'Empresa' : 'Persona'}${created ? ` · Inscrito el ${created}` : ''}`;
        return { isWallet, country, railLine, bankName, maskLine, meta };
    };
    // Chips por país derivados de los datos (+ Wallets si hay + En validación al final)
    const chipCountries = Array.from(new Set(contacts.filter(c => c.accountKind !== 'wallet').map(c => c.country || 'Colombia')));
    const walletCount = contacts.filter(c => c.accountKind === 'wallet').length;
    const pendingCount = contacts.filter(c => contactStatus(c) === 'en_proceso').length;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pt-6">
            {onBack && (
                <button onClick={onBack} style={{ color: '#121413' }} className="flex items-center gap-2 font-bold text-sm hover:underline">
                    ← Volver al inicio
                </button>
            )}
            <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                    <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.8px', color: '#F4F4F2' }}>Beneficiarios</h1>
                    <p style={{ fontSize: 14, color: '#878E88', maxWidth: 560, marginTop: 4, lineHeight: 1.5 }}>
                        Cuentas inscritas y validadas. Las transferencias locales solo salen hacia beneficiarios aprobados.
                    </p>
                </div>
                <button
                    onClick={() => { setFormOpen(true); setFormStep('country'); setForm({ ...emptyForm }); setNotice(null); }}
                    className="lincoin-btn-white flex items-center gap-2 transition-colors"
                    style={{ fontWeight: 700, fontSize: 13.5, padding: '11px 20px', borderRadius: 9, border: 'none' }}
                >
                    <Plus size={15} strokeWidth={2.5} /> Inscribir beneficiario
                </button>
            </div>

            {notice && (
                <div className={`rounded-xl border p-3 text-sm font-medium ${notice.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                    {notice.text}
                </div>
            )}

            {listRaw && (
                <details className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                    <summary className="text-[11px] text-slate-500 cursor-pointer select-none font-bold">
                        Ver respuesta técnica (lista de cuentas · {listRaw.path ?? '¿?'} · status {listRaw.status ?? '¿?'}) — debug del emparejamiento
                    </summary>
                    <pre className="mt-2 text-[10px] bg-slate-50 border border-slate-100 rounded-lg p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
{JSON.stringify(listRaw.data ?? null, null, 2)?.slice(0, 6000)}
                    </pre>
                </details>
            )}

            {/* Modal "Inscribir beneficiario" — 2 pasos (handoff inscribir_beneficiario) */}
            {formOpen && (
                <div className="fixed inset-0 z-50 p-4" style={{ background: 'rgba(4,5,4,0.72)', display: 'grid', placeItems: 'center' }} onClick={() => !saving && setFormOpen(false)}>
                <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" className="w-full animate-in zoom-in-95 duration-300"
                    style={{ maxWidth: 520, background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 18, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column', fontFamily: "'Archivo', system-ui, sans-serif" }}>
                    {/* Cabecera */}
                    <div style={{ padding: '18px 22px 14px' }}>
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <h3 style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px', color: '#F4F4F2' }}>Inscribir beneficiario</h3>
                                {formStep === 'country' ? (
                                    <p style={{ fontSize: 12.5, color: '#878E88', marginTop: 3 }}>¿En qué país está la cuenta de destino?</p>
                                ) : (
                                    <div className="flex items-center gap-1.5" style={{ marginTop: 4 }}>
                                        <span style={{ width: 15, height: 15, borderRadius: '50%', display: 'inline-block', background: FLAG_BG[form.country] ?? '#2E3330', flexShrink: 0 }} />
                                        <span style={{ fontSize: 12.5, color: '#878E88' }}>{form.country}</span>
                                        <button onClick={() => setFormStep('country')} style={{ fontSize: 12.5, color: '#F4F4F2', textDecoration: 'underline', marginLeft: 4 }}>cambiar país</button>
                                    </div>
                                )}
                            </div>
                            <button onClick={() => setFormOpen(false)} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                                <X size={13} style={{ color: '#878E88' }} strokeWidth={1.7} />
                            </button>
                        </div>
                        {/* Barra de progreso 2 segmentos */}
                        <div className="flex" style={{ gap: 5, marginTop: 14 }}>
                            <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#4ADE80' }} />
                            <div style={{ flex: 1, height: 3, borderRadius: 2, background: formStep === 'country' ? 'rgba(255,255,255,0.1)' : '#4ADE80' }} />
                        </div>
                    </div>

                    {/* Cuerpo scrolleable */}
                    <div style={{ padding: '6px 22px 20px', overflowY: 'auto' }} className="space-y-4">

                    {/* PASO WALLET — datos de la wallet USDT (Estados Unidos) */}
                    {formStep === 'wallet' && (<>
                        <div>
                            <label style={LBL}>Nombre / alias del destinatario</label>
                            <input value={form.name} onChange={e => setForm(fm => ({ ...fm, name: e.target.value }))} placeholder="Ej: Proveedor XYZ" style={INP} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label style={LBL}>Moneda</label>
                                <select value={form.walletCoin} onChange={e => setForm(fm => ({ ...fm, walletCoin: e.target.value as 'USDT' | 'USDC' }))} style={INP}>
                                    <option value="USDT">USDT (Tether)</option>
                                    <option value="USDC">USDC</option>
                                </select>
                            </div>
                            <div>
                                <label style={LBL}>Red</label>
                                <select value={form.walletNetwork} onChange={e => setForm(fm => ({ ...fm, walletNetwork: e.target.value as 'TRC-20' | 'BEP-20' }))} style={INP}>
                                    <option value="TRC-20">TRON (TRC-20)</option>
                                    <option value="BEP-20">BNB Chain (BEP-20)</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style={LBL}>Dirección de la wallet</label>
                            <input value={form.accountNumber} onChange={e => setForm(fm => ({ ...fm, accountNumber: e.target.value.trim() }))}
                                placeholder={form.walletNetwork === 'TRC-20' ? 'T…' : '0x…'}
                                style={{ ...INP, fontFamily: 'ui-monospace, monospace' }} />
                        </div>
                        <div className="flex items-start" style={{ gap: 11, border: '1px solid rgba(255,255,255,0.1)', borderLeft: '2px solid #4ADE80', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 15px' }}>
                            <ShieldCheckIcon />
                            <span style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5 }}>Verifica la dirección y la red: un envío a una dirección equivocada <span style={{ color: '#F4F4F2', fontWeight: 700 }}>no se puede recuperar</span>.</span>
                        </div>
                    </>)}

                    {/* PASO 1 — País de la cuenta: tarjetas-radio 2 columnas */}
                    {formStep === 'country' && (<>
                        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8 }}>
                            {CONTACT_COUNTRIES.map(c => {
                                const sel = form.country === c.name;
                                const railLabel = COUNTRY_RAILS[c.name] ?? 'Transferencia local';
                                return (
                                    <button
                                        key={c.code}
                                        type="button"
                                        onClick={() => setForm(fm => ({ ...fm, country: c.name, bank: '', docType: c.name === 'Colombia' ? (fm.kind === 'empresa' ? 'NIT' : 'CC') : fm.docType }))}
                                        className="flex items-center gap-3 text-left transition-colors"
                                        style={{
                                            padding: '12px 14px', borderRadius: 12,
                                            border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)',
                                            background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.025)',
                                        }}
                                    >
                                        <span style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'block', background: FLAG_BG[c.name] ?? '#2E3330' }} />
                                        <span className="flex-1 min-w-0">
                                            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{c.name}</span>
                                            <span style={{ display: 'block', fontSize: 11, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{railLabel}</span>
                                        </span>
                                        <span style={{ width: 17, height: 17, borderRadius: '50%', flexShrink: 0, border: sel ? '5px solid #4ADE80' : '1.5px solid rgba(255,255,255,0.25)', background: sel ? '#0C0E0D' : 'transparent' }} />
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center" style={{ gap: 8 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: '#878E88' }}>Cada país usa su riel local. La cuenta se valida antes del primer envío.</span>
                        </div>
                    </>)}

                    {formStep === 'data' && (<>
                    {/* Segmentado Persona / Empresa */}
                    <div className="flex" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: 3 }}>
                        {(['persona', 'empresa'] as const).map(k => (
                            <button
                                key={k}
                                onClick={() => setForm(fm => ({ ...fm, kind: k, docType: k === 'empresa' ? 'NIT' : 'CC' }))}
                                style={{
                                    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13,
                                    fontWeight: form.kind === k ? 700 : 500,
                                    background: form.kind === k ? 'rgba(255,255,255,0.09)' : 'transparent',
                                    color: form.kind === k ? '#F4F4F2' : '#878E88',
                                }}
                            >
                                {k === 'persona' ? 'Persona' : 'Empresa'}
                            </button>
                        ))}
                    </div>
                    {/* Riel de envío (solo Colombia): Bre-B o ACH */}
                    {form.country === 'Colombia' && (<div>
                        <label style={LBL}>Riel de envío</label>
                        <div className="grid grid-cols-2" style={{ gap: 8, marginTop: 6 }}>
                            {([{ v: 'breb', l: 'Bre-B', pill: 'SEGUNDOS', s: 'Por llave · 24/7' }, { v: 'ach', l: 'ACH', pill: null, s: 'Cuenta bancaria · L–V' }] as const).map(t => {
                                const sel = form.destKind === t.v;
                                return (
                                    <button key={t.v} type="button" onClick={() => setForm(fm => ({ ...fm, destKind: t.v }))}
                                        className="text-left transition-colors"
                                        style={{
                                            padding: '11px 13px', borderRadius: 11,
                                            border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)',
                                            background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.025)',
                                        }}>
                                        <div className="flex items-center gap-2">
                                            <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{t.l}</p>
                                            {t.pill && <span style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.6px', padding: '2px 6px', borderRadius: 999 }}>{t.pill}</span>}
                                        </div>
                                        <p style={{ fontSize: 11, color: '#878E88', marginTop: 2 }}>{t.s}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>)}

                    {/* ── Rama BRE-B: chips de tipo de llave + llave + identidad ── */}
                    {form.country === 'Colombia' && form.destKind === 'breb' ? (
                        <>
                            <div>
                                <label style={LBL}>Tipo de llave Bre-B</label>
                                <div className="flex flex-wrap" style={{ gap: 6, marginTop: 6 }}>
                                    {BREB_KEY_TYPES.map(k => {
                                        const sel = form.brebKeyType === k.v;
                                        return (
                                            <button key={k.v} type="button" onClick={() => setForm(fm => ({ ...fm, brebKeyType: k.v as any }))}
                                                style={{
                                                    borderRadius: 999, padding: '7px 14px', fontSize: 12, fontWeight: sel ? 700 : 500,
                                                    border: sel ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)',
                                                    background: sel ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.025)',
                                                    color: sel ? '#F4F4F2' : '#878E88',
                                                }}>
                                                {k.l}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div>
                                <label style={LBL}>Llave Bre-B ({brebKeyLabel(form.brebKeyType)})</label>
                                <input value={form.brebKey} onChange={e => setForm(fm => ({ ...fm, brebKey: e.target.value }))}
                                    placeholder={form.brebKeyType === 'celular' ? '+57 300 1234567' : form.brebKeyType === 'correo' ? 'correo@empresa.com' : form.brebKeyType === 'cedula' ? 'Número de cédula' : '@LLAVE123'}
                                    style={INP} />
                            </div>
                            <div>
                                <label style={LBL}>{form.kind === 'empresa' ? 'Razón social' : 'Nombre completo'}</label>
                                <input value={form.name} onChange={e => setForm(fm => ({ ...fm, name: e.target.value }))} style={INP} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label style={LBL}>Tipo de documento</label>
                                    <select value={form.docType} onChange={e => setForm(fm => ({ ...fm, docType: e.target.value }))} style={INP}>
                                        {DOC_TYPES.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={LBL}>Número de documento</label>
                                    <input value={form.docNumber} onChange={e => setForm(fm => ({ ...fm, docNumber: e.target.value }))} inputMode="numeric" style={INP} />
                                </div>
                            </div>
                        </>
                    ) : (
                    /* ── Rama ACH / otros países: cuenta bancaria ── */
                    <>
                        <div>
                            <label style={LBL}>{form.kind === 'empresa' ? 'Razón social' : 'Nombre completo'}</label>
                            <input value={form.name} onChange={e => setForm(fm => ({ ...fm, name: e.target.value }))} style={INP} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label style={LBL}>Tipo de documento</label>
                                <select value={form.docType} onChange={e => setForm(fm => ({ ...fm, docType: e.target.value }))} style={INP}>
                                    {DOC_TYPES.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                                </select>
                            </div>
                            <div>
                                <label style={LBL}>Número de documento</label>
                                <input value={form.docNumber} onChange={e => setForm(fm => ({ ...fm, docNumber: e.target.value }))} inputMode="numeric" style={INP} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label style={LBL}>Banco destino</label>
                                {form.country === 'Colombia' ? (
                                    <select value={form.bank} onChange={e => setForm(fm => ({ ...fm, bank: e.target.value }))} style={INP}>
                                        <option value="">Selecciona…</option>
                                        {BANKS_CO.map(b => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                ) : (
                                    <input value={form.bank} onChange={e => setForm(fm => ({ ...fm, bank: e.target.value }))} placeholder="Nombre del banco" style={INP} />
                                )}
                            </div>
                            <div>
                                <label style={LBL}>Tipo de cuenta</label>
                                <select value={form.accountType} onChange={e => setForm(fm => ({ ...fm, accountType: e.target.value as 'savings' | 'checking' }))} style={INP}>
                                    <option value="savings">Ahorros</option>
                                    <option value="checking">Corriente</option>
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style={LBL}>Número de cuenta</label>
                            <input value={form.accountNumber} onChange={e => setForm(fm => ({ ...fm, accountNumber: e.target.value.replace(/[^\d-]/g, '') }))} inputMode="numeric" style={INP} />
                        </div>
                    </>
                    )}

                    {/* Nota de validación con filo verde */}
                    <div className="flex items-start" style={{ gap: 11, border: '1px solid rgba(255,255,255,0.1)', borderLeft: '2px solid #4ADE80', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '12px 15px' }}>
                        <ShieldCheckIcon />
                        <span style={{ fontSize: 12, color: '#878E88', lineHeight: 1.5 }}>Validamos que la cuenta exista y que el titular coincida con el documento. <span style={{ color: '#F4F4F2', fontWeight: 700 }}>Suele tardar minutos.</span></span>
                    </div>
                    </>)}
                    </div>

                    {/* Botonera */}
                    <div className="flex" style={{ gap: 9, padding: '14px 22px 20px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                        <button
                            onClick={() => formStep === 'country' ? setFormOpen(false) : setFormStep('country')}
                            disabled={saving}
                            style={{ flex: 1, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.11)', color: '#F4F4F2', fontWeight: 600, fontSize: 14, padding: '13px 0', borderRadius: 10 }}
                            className="hover:bg-white/[0.09] transition-colors"
                        >
                            {formStep === 'country' ? 'Cancelar' : 'Atrás'}
                        </button>
                        {formStep === 'country' ? (
                            <button
                                onClick={() => {
                                    if (!form.country) return;
                                    if (form.country === 'Estados Unidos') { setForm(fm => ({ ...fm, accountKind: 'wallet', bank: '' })); setFormStep('wallet'); }
                                    else { setForm(fm => ({ ...fm, accountKind: 'bank' })); setFormStep('data'); }
                                }}
                                disabled={!form.country}
                                className="lincoin-btn-white transition-colors"
                                style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: form.country ? 1 : 0.45, cursor: form.country ? 'pointer' : 'not-allowed' }}
                            >
                                Continuar
                            </button>
                        ) : (
                            <button
                                onClick={saveContact}
                                disabled={saving}
                                className="lincoin-btn-white transition-colors"
                                style={{ flex: 1.5, fontWeight: 700, fontSize: 14, padding: '13px 0', borderRadius: 10, border: 'none', opacity: saving ? 0.45 : 1 }}
                            >
                                {saving ? 'Inscribiendo…' : 'Inscribir beneficiario'}
                            </button>
                        )}
                    </div>
                </div>
                </div>
            )}

            {/* Buscador + chips de filtro por país (diseño Beneficiarios) */}
            <div className="space-y-3">
                <div className="relative" style={{ maxWidth: 440 }}>
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#878E88' }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Buscar por nombre, banco, cuenta o documento"
                        style={{ width: '100%', height: 42, paddingLeft: 38, paddingRight: 12, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, color: '#F4F4F2', fontSize: 13.5, outline: 'none' }}
                    />
                </div>
                <div className="flex flex-wrap gap-2 overflow-x-auto">
                    {([
                        { key: 'all', label: `Todos · ${contacts.length}`, active: fCountry === 'all' && fType === 'all' && fStatus === 'all', onClick: clearFilters },
                        ...chipCountries.map(co => ({
                            key: co,
                            label: `${co} · ${contacts.filter(c => c.accountKind !== 'wallet' && (c.country || 'Colombia') === co).length}`,
                            active: fCountry === co && fType !== 'wallet',
                            onClick: () => { setFStatus('all'); setFType('bank'); setFCountry(co); },
                        })),
                        ...(walletCount > 0 ? [{ key: '__wallets', label: `Wallets · ${walletCount}`, active: fType === 'wallet', onClick: () => { setFStatus('all'); setFCountry('all'); setFType('wallet'); } }] : []),
                        { key: '__pending', label: `En validación · ${pendingCount}`, active: fStatus === 'en_proceso', onClick: () => { setFCountry('all'); setFType('all'); setFStatus(fStatus === 'en_proceso' ? 'all' : 'en_proceso'); } },
                    ]).map(chip => (
                        <button key={chip.key} type="button" onClick={chip.onClick}
                            style={{
                                borderRadius: 999, padding: '8px 16px', fontSize: 12.5, whiteSpace: 'nowrap',
                                fontWeight: chip.active ? 700 : 500,
                                border: chip.active ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.1)',
                                background: chip.active ? 'rgba(74,222,128,0.07)' : 'rgba(255,255,255,0.03)',
                                color: chip.active ? '#F4F4F2' : '#878E88',
                            }}>
                            {chip.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tabla de beneficiarios (diseño Beneficiarios) */}
            <div style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden' }}>
                {/* Encabezados — solo desktop */}
                <div className="hidden lg:grid" style={{ gridTemplateColumns: '1fr 180px 190px 120px 90px', padding: '9px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {['BENEFICIARIO', 'PAÍS Y RIEL', 'BANCO Y CUENTA', 'ESTADO', 'ACCIONES'].map((h, i) => (
                        <span key={h} style={{ color: '#878E88', fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', textAlign: i === 4 ? 'right' : 'left' }}>{h}</span>
                    ))}
                </div>
                {contacts.length === 0 && (
                    <div className="p-12 text-center">
                        <p style={{ color: '#F4F4F2', fontWeight: 600, fontSize: 14 }}>Aún no tienes beneficiarios inscritos</p>
                        <p style={{ color: '#878E88', fontSize: 12.5, marginTop: 4 }}>Inscribe la primera cuenta destino para poder transferir.</p>
                        <button onClick={() => { setFormOpen(true); setFormStep('country'); setForm({ ...emptyForm }); setNotice(null); }}
                            className="lincoin-btn-white transition-colors" style={{ marginTop: 16, fontWeight: 700, fontSize: 13, padding: '10px 18px', borderRadius: 9, border: 'none' }}>
                            Inscribir beneficiario
                        </button>
                    </div>
                )}
                {contacts.length > 0 && filteredContacts.length === 0 && (
                    <div className="p-12 text-center" style={{ color: '#878E88', fontSize: 13 }}>
                        Ningún beneficiario coincide con la búsqueda o los filtros.
                    </div>
                )}
                {filteredContacts.map(c => {
                    const m = rowMeta(c);
                    const st = contactStatus(c);
                    const statusPill = st === 'aprobada'
                        ? <span className="inline-flex items-center gap-1" style={{ border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}><CheckCircle size={10} /> VERIFICADO</span>
                        : st === 'rechazada'
                            ? <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' }} title={c.lastError ?? undefined}>RECHAZADO</span>
                            : <span style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#878E88', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.5px', padding: '4px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>EN VALIDACIÓN</span>;
                    const avatar = (
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(140deg, #2E3330, #1A1D1B)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span style={{ color: '#878E88', fontWeight: 800, fontSize: 13 }}>{initialsOf(c.name)}</span>
                        </div>
                    );
                    const flagEl = m.isWallet
                        ? <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#26A17B', color: '#fff', fontWeight: 800, fontSize: 10, display: 'grid', placeItems: 'center', flexShrink: 0 }}>₮</span>
                        : <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'block', background: FLAG_BG[m.country ?? ''] ?? '#2E3330' }} />;
                    const actions = (
                        <div className="flex items-center justify-end gap-2" style={{ position: 'relative' }}>
                            <button onClick={() => onSendTo?.(c)} disabled={!onSendTo || st !== 'aprobada'}
                                style={{ fontSize: 12.5, fontWeight: 600, color: (!onSendTo || st !== 'aprobada') ? '#878E88' : '#F4F4F2', cursor: (!onSendTo || st !== 'aprobada') ? 'not-allowed' : 'pointer' }}
                                className="hover:text-[#4ADE80] transition-colors">Enviar</button>
                            <button onClick={() => setMenuFor(menuFor === c.id ? null : c.id)} style={{ color: '#878E88', fontWeight: 700, fontSize: 14, padding: '2px 6px', borderRadius: 6 }} className="hover:bg-white/[0.06] transition-colors">···</button>
                            {menuFor === c.id && (
                                <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, background: '#121413', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, overflow: 'hidden', minWidth: 150, boxShadow: '0 12px 30px rgba(0,0,0,0.5)' }}>
                                    <button onClick={() => { setMenuFor(null); setDetail(c); }} className="w-full text-left hover:bg-white/[0.06] transition-colors" style={{ padding: '10px 14px', fontSize: 12.5, color: '#F4F4F2' }}>Ver detalle</button>
                                    <button onClick={() => { setMenuFor(null); removeContact(c.id); }} className="w-full text-left hover:bg-white/[0.06] transition-colors" style={{ padding: '10px 14px', fontSize: 12.5, color: '#F87171', borderTop: '1px solid rgba(255,255,255,0.07)' }}>Eliminar</button>
                                </div>
                            )}
                        </div>
                    );
                    return (
                    <div key={c.id}>
                        {/* Fila desktop */}
                        <div className="hidden lg:grid items-center hover:bg-white/[0.02] transition-colors" style={{ gridTemplateColumns: '1fr 180px 190px 120px 90px', padding: '14px 22px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <button onClick={() => setDetail(c)} className="flex items-center gap-3 min-w-0 text-left cursor-pointer">
                                {avatar}
                                <div className="min-w-0">
                                    <p style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyName(c.name)}</p>
                                    <p style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.meta}</p>
                                </div>
                            </button>
                            <div className="flex items-center gap-2 min-w-0">
                                {flagEl}
                                <div className="min-w-0">
                                    <p style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F2' }}>{m.isWallet ? (c.walletCoin ?? 'USDT') : m.country}</p>
                                    <p style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.railLine}</p>
                                </div>
                            </div>
                            <div className="min-w-0">
                                <p style={{ fontSize: 13, fontWeight: 600, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.bankName}</p>
                                <p style={{ fontSize: 11.5, color: '#878E88', fontFamily: 'ui-monospace, monospace' }}>{m.maskLine}</p>
                            </div>
                            <div>{statusPill}</div>
                            {actions}
                        </div>
                        {/* Tarjeta móvil */}
                        <div className="lg:hidden" style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="flex items-center justify-between gap-3">
                                <button onClick={() => setDetail(c)} className="flex items-center gap-3 min-w-0 text-left flex-1">
                                    {avatar}
                                    <div className="min-w-0">
                                        <p style={{ fontSize: 14, fontWeight: 700, color: '#F4F4F2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prettyName(c.name)}</p>
                                        <div className="flex items-center gap-1.5" style={{ marginTop: 2 }}>
                                            {flagEl}
                                            <span style={{ fontSize: 11.5, color: '#878E88', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.railLine} · {m.maskLine}</span>
                                        </div>
                                    </div>
                                </button>
                                <div className="flex flex-col items-end gap-1.5 shrink-0">
                                    {statusPill}
                                    {actions}
                                </div>
                            </div>
                        </div>
                    </div>
                    );
                })}
            </div>

            {/* Cómo funciona (pie) */}
            <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 14 }}>
                {[
                    { n: '1', t: 'Inscribes la cuenta', d: 'Eliges el país y das el dato del riel local: llave Bre-B, cuenta bancaria o wallet USDT.' },
                    { n: '2', t: 'La validamos', d: 'Confirmamos que los datos estén completos y el destino quede listo para operar.' },
                    { n: '3', t: 'Envías sin volver a digitar', d: 'El beneficiario queda listo para el riel de su país desde cualquier envío.' },
                ].map(card => (
                    <div key={card.n} style={{ background: '#0C0E0D', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '18px 20px' }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', color: '#4ADE80', fontWeight: 800, fontSize: 12, display: 'grid', placeItems: 'center', marginBottom: 10 }}>{card.n}</div>
                        <p style={{ fontSize: 13.5, fontWeight: 700, color: '#F4F4F2' }}>{card.t}</p>
                        <p style={{ fontSize: 12, color: '#878E88', marginTop: 4, lineHeight: 1.5 }}>{card.d}</p>
                    </div>
                ))}
            </div>

            {/* Modal de detalle: todos los datos de la inscripción */}
            {detail && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDetail(null)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="font-bold text-lg text-slate-800">Datos del contacto</h3>
                            <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"><X size={20} /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    {detail.accountKind === 'wallet'
                                        ? <><Wallet size={18} className="text-[#16A34A]" /><span className="font-bold text-slate-800">Wallet · {detail.walletCoin ?? 'USDT'} · {detail.walletNetwork ?? 'TRC-20'}</span></>
                                        : <><FlagImg code={CONTACT_COUNTRIES.find(cc => cc.name === (detail.country ?? 'Colombia'))?.code ?? 'CO'} className="w-7 h-5 object-cover rounded shadow-sm" />
                                          <span className="font-bold text-slate-800">{detail.country ?? 'Colombia'}</span></>}
                                </div>
                                {(() => {
                                    const st = contactStatus(detail);
                                    if (st === 'aprobada') return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full"><CheckCircle size={11} /> Aprobada</span>;
                                    if (st === 'rechazada') return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-full"><X size={11} /> Rechazada</span>;
                                    return <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full"><AlertTriangle size={11} /> En proceso</span>;
                                })()}
                            </div>
                            <div className="bg-slate-50 border border-slate-100 rounded-xl divide-y divide-slate-100 text-sm">
                                {(detail.accountKind === 'wallet' ? [
                                    ['Destinatario', detail.name],
                                    ['Moneda', detail.walletCoin ?? 'USDT'],
                                    ['Red', detail.walletNetwork === 'BEP-20' ? 'BNB Chain (BEP-20)' : 'TRON (TRC-20)'],
                                    ['Dirección', detail.accountNumber],
                                    ['Uso', 'Solo envíos en USD'],
                                    ['Inscrito el', new Date(detail.createdAt).toLocaleString('es-CO')],
                                ] : [
                                    ['Titular', detail.name],
                                    ['Tipo', detail.kind === 'empresa' ? 'Empresa' : 'Persona'],
                                    ['Documento', `${detail.docType} ${detail.docNumber}`],
                                    ['Banco', detail.bank],
                                    ['Tipo de cuenta', detail.accountType === 'savings' ? 'Ahorros' : 'Corriente'],
                                    ['Número de cuenta', detail.accountNumber],
                                    ['Inscrito el', new Date(detail.createdAt).toLocaleString('es-CO')],
                                    ['ID de inscripción', detail.mouvId ?? '— aún sin ID (en proceso)'],
                                    ...(detail.lastError ? [['⚠ Respuesta de la red', detail.lastError]] : []),
                                ]).map(([k, v]) => (
                                    <div key={k} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wide shrink-0 pt-0.5">{k}</span>
                                        <span className="font-semibold text-slate-800 text-right break-all">{v}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { navigator.clipboard?.writeText(detail.accountNumber); setNotice({ ok: true, text: 'Número de cuenta copiado.' }); }}
                                    className="flex-1 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-bold text-slate-600 transition-colors"
                                >
                                    Copiar cuenta
                                </button>
                                <button
                                    onClick={() => { const id = detail.id; setDetail(null); removeContact(id); }}
                                    className="py-2.5 px-4 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-sm font-bold transition-colors"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
