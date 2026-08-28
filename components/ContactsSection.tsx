import React, { useState, useEffect } from 'react';
import { BookUser, Plus, X, Trash2, CheckCircle, AlertTriangle, Landmark, Wallet, Search, SlidersHorizontal } from 'lucide-react';
import { useDatabase } from '../context/DatabaseContext';
import { callFinity } from './FinitySection';
import { supabase } from '../lib/supabaseClient';
import { FlagImg } from './FlagImg';

declare const __BUILD_TS__: string;

// ─────────────────────────────────────────────
// ContactsSection — Contactos (cuentas bancarias destino) de EMPRESAS.
//
// Modelo Finity: antes de dispersar hay que INSCRIBIR la cuenta destino
// (external account). Aquí el cliente registra sus contactos:
//   1. Se intenta inscribir en Finity (create_external_account).
//   2. Se guarda en raw_data.finityContacts del usuario (con el id de
//      Finity si la inscripción pasó; 'pendiente' si no).
// El flujo de Enviar Dinero (COP · banco) usa estos contactos inscritos.
// ─────────────────────────────────────────────

// Ciclo de vida (modelo Finity):
//   Colombia → al inscribir queda EN PROCESO y la API de Finity la pasa a
//              APROBADA o RECHAZADA (se sincroniza automáticamente).
//   Otros países → se aprueban AUTOMÁTICAMENTE al inscribir (no pasan por Finity).
export type ContactStatus = 'en_proceso' | 'aprobada' | 'rechazada';

export interface FinityContact {
    id: string;
    finityId: string | null;   // id de la external account en Finity (null = pendiente)
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
    // Última respuesta de Finity al intentar inscribir (null = ok). Visible
    // en el detalle para diagnosticar rechazos de campos/validación.
    lastError?: string | null;
}

// Estado efectivo (contactos viejos sin campo status → en proceso si son
// de Colombia; aprobados si son de otro país).
export const contactStatus = (c: Partial<FinityContact>): ContactStatus => {
    if (c.status) return c.status;
    return (c.country && c.country !== 'Colombia') ? 'aprobada' : 'en_proceso';
};

// Cuerpo EXACTO del contrato oficial (doc: Create External Account):
// POST /v0/external-accounts
// { account: { geo, account_type (savings|checking), account_number,
//   financial_institution_code, account_holder_fullname,
//   account_holder_id_type (CC|CE|NIT), account_holder_id_number } }
// → 201 { id: "ea_...", ... }
const buildFinityAccountBody = (c: { name: string; docType: string; docNumber: string; bank: string; accountType: string; accountNumber: string; kind?: string }) => ({
    account: {
        geo: 'CO',
        account_type: c.accountType,
        account_number: c.accountNumber,
        financial_institution_code: BANK_CODES_CO[c.bank] ?? '',
        account_holder_fullname: c.name,
        // Enum de Finity: CC | CE | NIT (PAS no existe → se envía como CE)
        account_holder_id_type: c.docType === 'PAS' ? 'CE' : c.docType,
        account_holder_id_number: c.docNumber,
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
// validación de Finity: "financial_institution_code should not be empty").
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
        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${active ? 'bg-[#4ADE80] text-[#0F172A] border-[#4ADE80]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
    >
        {children}
    </button>
);

export const ContactsSection: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
    const { currentUser, updateUserProfile } = useDatabase();
    const [formOpen, setFormOpen] = useState(false);
    // Paso 0: ¿banco o wallet? → banco: país → datos · wallet: datos wallet
    const [formStep, setFormStep] = useState<'type' | 'country' | 'data' | 'wallet'>('type');
    const [form, setForm] = useState({ ...emptyForm });
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
    // Contacto abierto en el modal de detalle (clic sobre la fila)
    const [detail, setDetail] = useState<FinityContact | null>(null);

    // Buscador + filtros de la lista
    const [search, setSearch] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [fCountry, setFCountry] = useState('all');
    const [fType, setFType] = useState<'all' | 'bank' | 'wallet'>('all');
    const [fStatus, setFStatus] = useState<'all' | 'aprobada' | 'en_proceso' | 'rechazada'>('all');

    // ── INFRAESTRUCTURA SEPARADA ─────────────────────────────
    // Cuentas bancarias (finityContacts) y wallets (walletContacts) viven
    // en LISTAS DISTINTAS de raw_data: guardar una jamás pisa a la otra.
    // Cada lista puede venir anidada (raw_data.X, recién guardada) o
    // aplanada al nivel superior (perfil recargado) — se lee donde esté.
    const cu: any = currentUser as any;
    const readList = (key: string): FinityContact[] =>
        Array.isArray(cu?.raw_data?.[key]) ? cu.raw_data[key]
        : Array.isArray(cu?.[key]) ? cu[key]
        : [];
    const rawBankList = readList('finityContacts');
    // Compat: wallets viejas que quedaron dentro de finityContacts
    const bankContacts: FinityContact[] = rawBankList.filter((c: any) => c?.accountKind !== 'wallet');
    const walletContacts: FinityContact[] = [
        ...readList('walletContacts'),
        ...rawBankList.filter((c: any) => c?.accountKind === 'wallet'),
    ];
    // Vista combinada (lista e interfaz)
    const contacts: FinityContact[] = [...walletContacts, ...bankContacts];

    // Guarda UNA lista bajo SU llave a TRAVÉS DEL SERVIDOR (service-role):
    // la edge function escribe raw_data sin pasar por RLS ni el candado —
    // así se acabó el "se guarda en memoria y desaparece al recargar".
    // Actualiza el estado local con lo que la base confirma que quedó.
    const persistKey = async (key: 'finityContacts' | 'walletContacts', list: FinityContact[]): Promise<boolean> => {
        if (!currentUser?.id) return false;
        const SURL = (import.meta as any).env?.VITE_SUPABASE_URL as string || '';
        const SKEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string || '';
        try {
            const r = await Promise.race([
                fetch(`${SURL}/functions/v1/tatum-wallet`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', apikey: SKEY, Authorization: `Bearer ${SKEY}` },
                    body: JSON.stringify({ action: 'save_contacts', userId: currentUser.id, key, list }),
                }).then(res => res.json()),
                new Promise<any>((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
            ]);
            if (!r?.ok || !Array.isArray(r.saved)) return false;
            // El servidor YA guardó y confirmó. Reflejar en memoria es
            // secundario y NO debe cambiar el resultado: si esto fallara, el
            // contacto igual está en la base y aparece al recargar.
            try { updateUserProfile(currentUser.id, { raw_data: { [key]: r.saved }, [key]: r.saved } as any); } catch { /* no-op */ }
            return true;
        } catch { return false; }
    };
    const persistBanks = (list: FinityContact[]) => persistKey('finityContacts', list.filter((c: any) => c?.accountKind !== 'wallet'));
    const persistWallets = (list: FinityContact[]) => persistKey('walletContacts', list.filter((c: any) => c?.accountKind === 'wallet'));

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
            const wc: FinityContact = {
                id: `ct_${Math.random().toString(36).slice(2, 10)}`,
                finityId: null,
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

        const isColombia = f.country === 'Colombia';
        let finityId: string | null = null;
        let status: ContactStatus = isColombia ? 'en_proceso' : 'aprobada';
        let lastError: string | null = null;

        // Solo Colombia pasa por Finity: la inscripción queda EN PROCESO y la
        // API de Finity decide aprobada/rechazada (se sincroniza al entrar
        // aquí o con "Actualizar estados"). Otros países: aprobación automática.
        if (isColombia) {
            try {
                const r = await callFinity('create_external_account', currentUser.id, {
                    data: buildFinityAccountBody({
                        name: f.name.trim(),
                        docType: f.docType,
                        docNumber: f.docNumber.trim(),
                        bank: f.bank,
                        accountType: f.accountType,
                        accountNumber: f.accountNumber.trim(),
                        kind: f.kind,
                    }),
                });
                const d = (r?.data ?? {}) as any;
                finityId = d.id ?? d.external_account_id ?? d.account_id ?? null;
                status = normalizeStatus(d.verification_status ?? d.status ?? d.estado ?? d.state) ?? 'en_proceso';
                if (!r?.ok || !finityId) {
                    lastError = `[${new Date().toLocaleTimeString('es-CO')}] HTTP ${r?.status ?? '—'} en ${r?.path ?? '¿?'}: ${JSON.stringify(r?.data ?? r).slice(0, 260)}`;
                }
            } catch (e: any) {
                lastError = String(e?.message ?? e);
            }
        }

        const contact: FinityContact = {
            id: `ct_${Math.random().toString(36).slice(2, 10)}`,
            finityId,
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
        };
        const okB = await persistBanks([contact, ...bankContacts]);
        setSaving(false);
        setFormOpen(false);
        setForm({ ...emptyForm });
        if (!okB) { setNotice({ ok: false, text: '⚠ El contacto NO quedó guardado en el servidor (sesión vencida o permisos de la base). Cierra sesión, vuelve a entrar e inscríbelo otra vez. Si persiste, avísale al administrador.' }); return; }
        setNotice(status === 'aprobada'
            ? { ok: true, text: `✅ Contacto aprobado (${contact.name}). Ya puedes transferirle.` }
            : { ok: true, text: `📋 Cuenta inscrita — quedó EN PROCESO. Será aprobada o rechazada en la revisión bancaria; el estado se actualiza solo.` });
    };

    // ── Sincronizar estados con Finity (solo contactos de Colombia) ──
    // Lee las external accounts de Finity y empareja por número de cuenta:
    // el estado del portal (Aprobada / Rechazada / En proceso) manda.
    const [syncing, setSyncing] = useState(false);
    // Respuesta cruda de la lista de cuentas de Finity (debug del matching)
    const [listRaw, setListRaw] = useState<any>(null);
    const syncStatuses = async (silent = false) => {
        if (!currentUser?.id || syncing) return;
        const targets = bankContacts.filter(c => (c.country ?? 'Colombia') === 'Colombia');
        if (targets.length === 0) return;
        setSyncing(true);
        try {
            // 0) Reintentar la inscripción de contactos de Colombia que quedaron
            //    sin ID de Finity (la primera inscripción falló — auth o red).
            let retried = bankContacts;
            const pendingReg = bankContacts.filter(c => (c.country ?? 'Colombia') === 'Colombia' && !c.finityId);
            for (const c of pendingReg) {
                try {
                    const rr = await callFinity('create_external_account', currentUser.id, {
                        data: buildFinityAccountBody(c),
                    });
                    const dd = (rr?.data ?? {}) as any;
                    const fid = dd.id ?? dd.external_account_id ?? dd.account_id ?? null;
                    if (rr?.ok && fid) {
                        retried = retried.map(x => x.id === c.id
                            ? { ...x, finityId: fid, status: normalizeStatus(dd.verification_status ?? dd.status ?? dd.estado ?? dd.state) ?? 'en_proceso', lastError: null }
                            : x);
                    } else {
                        // Guardar el rechazo de Finity — visible en el detalle del contacto
                        const err = `[${new Date().toLocaleTimeString('es-CO')}] HTTP ${rr?.status ?? '—'} en ${rr?.path ?? '¿?'}: ${JSON.stringify(rr?.data ?? rr).slice(0, 260)}`;
                        retried = retried.map(x => x.id === c.id ? { ...x, lastError: err } : x);
                    }
                } catch (e: any) {
                    const err = String(e?.message ?? e);
                    retried = retried.map(x => x.id === c.id ? { ...x, lastError: err } : x);
                }
            }
            if (retried !== bankContacts) await persistBanks(retried);

            const r = await callFinity('external_accounts', currentUser.id);
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
                const newlyApproved: FinityContact[] = [];
                const next = retried.map(c => {
                    if ((c.country ?? 'Colombia') !== 'Colombia') return c;
                    const row = rows.find((x: any) => {
                        // 1) Por ID de Finity (infalible cuando lo tenemos)
                        const rid = String(x.id ?? x.external_account_id ?? x.account_id ?? '');
                        if (c.finityId && rid && rid === c.finityId) return true;
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
                    const fid = row.id ?? row.external_account_id ?? row.account_id ?? c.finityId;
                    if ((st && st !== contactStatus(c)) || (fid && fid !== c.finityId)) {
                        changed = true;
                        const wasApproved = contactStatus(c) === 'aprobada';
                        const updated = { ...c, status: st ?? contactStatus(c), finityId: fid ?? c.finityId };
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
                        callFinity('email_event', currentUser!.id, {
                            subject: 'Lincoin · Contacto aprobado',
                            title: 'Contacto aprobado',
                            message: `La cuenta de <strong>${c.name}</strong> quedó aprobada. Ya puedes transferirle.`,
                        }).catch(() => {});
                    }
                    if (!silent) setNotice({ ok: true, text: 'Estados sincronizados con Finity.' });
                } else if (!silent) {
                    setNotice({ ok: true, text: 'Estados al día — sin cambios.' });
                }
            } else if (!silent) {
                // Mostrar la respuesta cruda ayuda a mapear el formato real de la lista
                setNotice({ ok: false, text: `Finity no devolvió cuentas para comparar. Respuesta (${r?.status ?? '—'}): ${JSON.stringify(r?.data ?? r).slice(0, 220)}` });
            }
        } catch { /* red flaky: se reintenta en la próxima visita */ }
        setSyncing(false);
    };

    // Al entrar a la sección, sincronizar en silencio.
    useEffect(() => { syncStatuses(true); /* eslint-disable-next-line */ }, [currentUser?.id]);

    const removeContact = async (id: string) => {
        if (!window.confirm('¿Eliminar este contacto?')) return;
        const target = contacts.find(c => c.id === id);
        const isWallet = walletContacts.some(c => c.id === id);
        // 1) Quitar de la lista local del usuario (cada tipo de SU lista).
        const removedOk = isWallet
            ? await persistWallets(walletContacts.filter(c => c.id !== id))
            : await persistBanks(bankContacts.filter(c => c.id !== id));
        if (!removedOk) { setNotice({ ok: false, text: 'No se pudo eliminar el contacto. Reintenta.' }); return; }
        // 2) Des-inscribir en Finity (solo cuentas bancarias de Colombia con id).
        //    El backend verifica que NINGÚN otro usuario la siga usando antes de
        //    borrarla allá — Finity es una sola cuenta de empresa compartida.
        if (target && target.accountKind !== 'wallet' && (target.country ?? 'Colombia') === 'Colombia' && target.finityId) {
            try {
                const r = await callFinity('delete_external_account', currentUser!.id, {
                    finityId: target.finityId,
                    accountNumber: target.accountNumber,
                });
                if (r?.deletedInFinity) setNotice({ ok: true, text: 'Contacto eliminado — también des-inscrito en el banco (Finity).' });
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

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pt-6">
            {onBack && (
                <button onClick={onBack} style={{ color: '#1E293B' }} className="flex items-center gap-2 font-bold text-sm hover:underline">
                    ← Volver al inicio
                </button>
            )}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-extrabold text-[#0F172A] flex items-center gap-2">
                        <BookUser size={22} className="text-[#4ADE80]" /> Contactos
                    </h1>
                    <p className="text-sm" style={{ color: '#334155' }}>
                        Inscribe las cuentas bancarias destino. Las transferencias en COP van
                        <b style={{ color: '#0F172A' }}> solo a contactos inscritos</b>.
                        <span className="ml-2 text-[10px] font-mono" style={{ color: '#94A3B8' }}>v{typeof __BUILD_TS__ !== 'undefined' ? __BUILD_TS__ : '¿?'}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => syncStatuses(false)}
                        disabled={syncing}
                        style={{ color: '#0F172A', borderColor: '#94A3B8' }}
                        className="py-2.5 px-4 rounded-xl border hover:bg-slate-50 text-sm font-bold disabled:opacity-60 transition-colors"
                        title="Consulta el estado de las cuentas de Colombia"
                    >
                        {syncing ? 'Sincronizando…' : '↻ Actualizar estados'}
                    </button>
                    <button
                        onClick={() => { setFormOpen(true); setFormStep('country'); setForm({ ...emptyForm }); setNotice(null); }}
                        style={{ color: '#0F172A' }}
                        className="py-2.5 px-5 rounded-xl bg-[#4ADE80] hover:bg-[#6EE7A0] text-sm font-bold flex items-center gap-2 transition-colors"
                    >
                        <Plus size={16} strokeWidth={3} /> Inscribir contacto
                    </button>
                </div>
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

            {/* Formulario de inscripción */}
            {formOpen && (
                <div className="bg-white rounded-2xl border-2 border-[#4ADE80]/40 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-800">Nuevo contacto</h3>
                        <button onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
                    </div>

                    {/* PASO EE. UU. — ¿Banco o Wallet? (solo Estados Unidos / USD) */}
                    {formStep === 'type' && (
                        <div className="space-y-3">
                            <button onClick={() => setFormStep('country')} className="text-xs font-bold text-[#16A34A] hover:underline">← Cambiar país</button>
                            <p className="text-sm text-slate-600 font-medium">Estados Unidos (USD) — ¿qué tipo de destino vas a inscribir?</p>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => { setForm(fm => ({ ...fm, accountKind: 'bank' })); setFormStep('data'); }}
                                    className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-slate-200 hover:border-[#0F172A] hover:bg-slate-50 transition-all"
                                >
                                    <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center"><Landmark size={24} className="text-[#0F172A]" /></div>
                                    <span className="text-sm font-bold text-slate-800">Cuenta bancaria</span>
                                    <span className="text-[10px] text-slate-500 leading-tight text-center">Transferencia bancaria en EE. UU.</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setForm(fm => ({ ...fm, accountKind: 'wallet', bank: '' })); setFormStep('wallet'); }}
                                    className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-slate-200 hover:border-[#4ADE80] hover:bg-green-50/40 transition-all"
                                >
                                    <div className="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center"><Wallet size={24} className="text-[#16A34A]" /></div>
                                    <span className="text-sm font-bold text-slate-800">Wallet</span>
                                    <span className="text-[10px] text-slate-500 leading-tight text-center">Dirección cripto (USDT/USDC)</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* PASO WALLET — datos de la wallet (solo USD, aprobación automática) */}
                    {formStep === 'wallet' && (<>
                        <button onClick={() => setFormStep('type')} className="text-xs font-bold text-[#16A34A] hover:underline">← Cambiar tipo</button>
                        <div className="grid md:grid-cols-2 gap-3">
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Nombre / Alias del destinatario</label>
                                <input value={form.name} onChange={e => setForm(fm => ({ ...fm, name: e.target.value }))}
                                    placeholder="Ej: Proveedor XYZ"
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Moneda</label>
                                <select value={form.walletCoin} onChange={e => setForm(fm => ({ ...fm, walletCoin: e.target.value as 'USDT' | 'USDC' }))}
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:border-[#4ADE80] outline-none">
                                    <option value="USDT">USDT (Tether)</option>
                                    <option value="USDC">USDC</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Red</label>
                                <select value={form.walletNetwork} onChange={e => setForm(fm => ({ ...fm, walletNetwork: e.target.value as 'TRC-20' | 'BEP-20' }))}
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:border-[#4ADE80] outline-none">
                                    <option value="TRC-20">TRON (TRC-20)</option>
                                    <option value="BEP-20">BNB Chain (BEP-20)</option>
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Dirección de la wallet</label>
                                <input value={form.accountNumber} onChange={e => setForm(fm => ({ ...fm, accountNumber: e.target.value.trim() }))}
                                    placeholder={form.walletNetwork === 'TRC-20' ? 'T…' : '0x…'}
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono focus:border-[#4ADE80] outline-none" />
                                <p className="text-[10px] text-slate-400 mt-1">⚠️ Verifica la dirección y la red: un envío a una dirección equivocada no se puede recuperar.</p>
                            </div>
                        </div>
                        <button
                            onClick={saveContact}
                            disabled={saving}
                            style={{ color: '#FFFFFF' }}
                            className="w-full py-3 rounded-xl bg-[#0F172A] hover:bg-[#152e52] font-bold text-sm disabled:opacity-60 transition-colors"
                        >
                            {saving ? 'Guardando…' : 'Inscribir wallet'}
                        </button>
                    </>)}

                    {/* PASO 1 — País de la cuenta: tarjetas con bandera */}
                    {formStep === 'country' && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600 font-medium">¿En qué país está la cuenta bancaria?</p>
                            <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                                {CONTACT_COUNTRIES.map(c => (
                                    <button
                                        key={c.code}
                                        type="button"
                                        onClick={() => {
                                            setForm(fm => ({ ...fm, country: c.name, bank: '', docType: c.name === 'Colombia' ? 'CC' : fm.docType }));
                                            // Estados Unidos (USD): preguntar Banco o Wallet.
                                            // Demás países: directo a los datos bancarios.
                                            setFormStep(c.name === 'Estados Unidos' ? 'type' : 'data');
                                        }}
                                        className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-slate-200 hover:border-[#0F172A] hover:bg-slate-50 transition-all"
                                    >
                                        <FlagImg code={c.code} className="w-10 h-7 object-cover rounded shadow-sm" />
                                        <span className="text-xs font-bold text-slate-700 leading-tight text-center">{c.name}</span>
                                        <span className={`text-[9px] font-bold leading-tight text-center ${c.name === 'Colombia' ? 'text-amber-600' : 'text-green-600'}`}>
                                            {c.name === 'Colombia' ? 'Revisión bancaria' : 'Aprobación automática'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {formStep === 'data' && (<>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                            <FlagImg code={CONTACT_COUNTRIES.find(c => c.name === form.country)?.code ?? 'CO'} className="w-6 h-4 object-cover rounded shadow-sm" />
                            <span className="text-sm font-bold text-slate-700">{form.country}</span>
                            <button onClick={() => setFormStep('country')} className="text-xs font-bold text-[#16A34A] hover:underline ml-1">Cambiar país</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-56">
                            {(['persona', 'empresa'] as const).map(k => (
                                <button
                                    key={k}
                                    onClick={() => setForm(fm => ({ ...fm, kind: k, docType: k === 'empresa' ? 'NIT' : 'CC' }))}
                                    className={`py-2 rounded-xl text-sm font-bold border transition-colors ${form.kind === k ? 'bg-[#0F172A] border-[#0F172A]' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                    style={form.kind === k ? { color: '#FFFFFF' } : undefined}
                                >
                                    {k === 'persona' ? 'Persona' : 'Empresa'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Nombre completo / Razón social</label>
                            <input value={form.name} onChange={e => setForm(fm => ({ ...fm, name: e.target.value }))}
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tipo de documento</label>
                            <select value={form.docType} onChange={e => setForm(fm => ({ ...fm, docType: e.target.value }))}
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:border-[#4ADE80] outline-none">
                                {DOC_TYPES.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Número de documento</label>
                            <input value={form.docNumber} onChange={e => setForm(fm => ({ ...fm, docNumber: e.target.value }))}
                                inputMode="numeric"
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Banco destino</label>
                            {form.country === 'Colombia' ? (
                                <select value={form.bank} onChange={e => setForm(fm => ({ ...fm, bank: e.target.value }))}
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:border-[#4ADE80] outline-none">
                                    <option value="">Selecciona…</option>
                                    {BANKS_CO.map(b => <option key={b} value={b}>{b}</option>)}
                                </select>
                            ) : (
                                <input value={form.bank} onChange={e => setForm(fm => ({ ...fm, bank: e.target.value }))}
                                    placeholder="Nombre del banco"
                                    className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                            )}
                        </div>
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tipo de cuenta</label>
                            <select value={form.accountType} onChange={e => setForm(fm => ({ ...fm, accountType: e.target.value as 'savings' | 'checking' }))}
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:border-[#4ADE80] outline-none">
                                <option value="savings">Ahorros</option>
                                <option value="checking">Corriente</option>
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Número de cuenta</label>
                            <input value={form.accountNumber} onChange={e => setForm(fm => ({ ...fm, accountNumber: e.target.value.replace(/[^\d-]/g, '') }))}
                                inputMode="numeric"
                                className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-[#4ADE80] outline-none" />
                        </div>
                    </div>
                    <button
                        onClick={saveContact}
                        disabled={saving}
                        style={{ color: '#FFFFFF' }}
                        className="w-full py-3 rounded-xl bg-[#0F172A] hover:bg-[#152e52] font-bold text-sm disabled:opacity-60 transition-colors"
                    >
                        {saving
                            ? (form.country === 'Colombia' ? 'Inscribiendo…' : 'Guardando…')
                            : 'Inscribir contacto'}
                    </button>
                    </>)}
                </div>
            )}

            {/* Buscador + filtros */}
            {contacts.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Buscar por nombre, banco, cuenta o documento…"
                                className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-[#4ADE80]"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowFilters(v => !v)}
                            title="Filtros"
                            className={`relative h-11 px-3.5 rounded-xl border text-sm font-bold flex items-center gap-2 transition-colors ${showFilters || activeFilters ? 'bg-[#0F172A] text-white border-[#0F172A]' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                        >
                            <SlidersHorizontal size={16} />
                            <span className="hidden sm:inline">Filtros</span>
                            {activeFilters > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#4ADE80] text-[#0F172A] text-[10px] font-black flex items-center justify-center">{activeFilters}</span>
                            )}
                        </button>
                    </div>

                    {showFilters && (
                        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">País</p>
                                <div className="flex flex-wrap gap-2">
                                    <FilterChip active={fCountry === 'all'} onClick={() => setFCountry('all')}>Todos</FilterChip>
                                    {countryOptions.map(co => (
                                        <FilterChip key={co} active={fCountry === co} onClick={() => setFCountry(co)}>{co}</FilterChip>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Tipo de destino</p>
                                <div className="flex flex-wrap gap-2">
                                    <FilterChip active={fType === 'all'} onClick={() => setFType('all')}>Todos</FilterChip>
                                    <FilterChip active={fType === 'bank'} onClick={() => setFType('bank')}>Banco</FilterChip>
                                    <FilterChip active={fType === 'wallet'} onClick={() => setFType('wallet')}>Wallet</FilterChip>
                                </div>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Estado</p>
                                <div className="flex flex-wrap gap-2">
                                    <FilterChip active={fStatus === 'all'} onClick={() => setFStatus('all')}>Todos</FilterChip>
                                    <FilterChip active={fStatus === 'aprobada'} onClick={() => setFStatus('aprobada')}>Aprobada</FilterChip>
                                    <FilterChip active={fStatus === 'en_proceso'} onClick={() => setFStatus('en_proceso')}>En proceso</FilterChip>
                                    <FilterChip active={fStatus === 'rechazada'} onClick={() => setFStatus('rechazada')}>Rechazada</FilterChip>
                                </div>
                            </div>
                            {activeFilters > 0 && (
                                <button onClick={clearFilters} className="text-xs font-bold text-[#16A34A] hover:underline">Limpiar filtros</button>
                            )}
                        </div>
                    )}

                    <p className="text-xs text-slate-400">{filteredContacts.length} de {contacts.length} contactos</p>
                </div>
            )}

            {/* Lista */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {contacts.length === 0 && (
                    <div className="p-12 text-center text-slate-400 text-sm">
                        Aún no tienes contactos inscritos. Inscribe la primera cuenta destino para poder transferir en COP.
                    </div>
                )}
                {contacts.length > 0 && filteredContacts.length === 0 && (
                    <div className="p-12 text-center text-slate-400 text-sm">
                        Ningún contacto coincide con la búsqueda o los filtros.
                    </div>
                )}
                {filteredContacts.map(c => (
                    <div key={c.id} className="p-4 border-b border-slate-50 flex items-center justify-between gap-3 flex-wrap hover:bg-slate-50/60">
                        <button onClick={() => setDetail(c)} className="flex items-center gap-3 min-w-0 text-left flex-1 cursor-pointer" title="Ver datos de la inscripción">
                            <div className="w-10 h-10 rounded-xl bg-[#0F172A] flex items-center justify-center shrink-0">
                                {c.accountKind === 'wallet'
                                    ? <Wallet size={16} className="text-[#4ADE80]" />
                                    : <Landmark size={16} className="text-[#4ADE80]" />}
                            </div>
                            <div className="min-w-0">
                                <p className="font-bold text-slate-800 text-sm truncate">{c.name} <span className="font-normal text-slate-400 text-xs">· {c.accountKind === 'wallet' ? 'Wallet' : (c.kind === 'empresa' ? 'Empresa' : 'Persona')}</span></p>
                                <p className="text-xs text-slate-500 truncate">
                                    {c.accountKind === 'wallet'
                                        ? `${c.walletCoin ?? 'USDT'} · ${c.walletNetwork ?? 'TRC-20'} · ${mask(c.accountNumber)} · solo envíos USD`
                                        : `${(c.country && c.country !== 'Colombia') ? `${c.country} · ` : ''}${c.bank} · ${c.accountType === 'savings' ? 'Ahorros' : 'Corriente'} ${mask(c.accountNumber)} · ${c.docType} ${c.docNumber}`}
                                </p>
                            </div>
                        </button>
                        <div className="flex items-center gap-3">
                            {(() => {
                                const st = contactStatus(c);
                                if (st === 'aprobada') return (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-full">
                                        <CheckCircle size={11} /> Aprobada
                                    </span>
                                );
                                if (st === 'rechazada') return (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded-full">
                                        <X size={11} /> Rechazada
                                    </span>
                                );
                                return (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-full">
                                        <AlertTriangle size={11} /> En proceso
                                    </span>
                                );
                            })()}
                            <button onClick={() => removeContact(c.id)} className="text-slate-300 hover:text-red-500 transition-colors" title="Eliminar contacto">
                                <Trash2 size={15} />
                            </button>
                        </div>
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
                                    ['ID de inscripción', detail.finityId ?? '— aún sin ID (en proceso)'],
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
                                {(detail.country ?? 'Colombia') === 'Colombia' && (
                                    <button
                                        onClick={() => { setDetail(null); syncStatuses(false); }}
                                        disabled={syncing}
                                        className="flex-1 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-bold text-slate-600 disabled:opacity-60 transition-colors"
                                    >
                                        ↻ Actualizar estado
                                    </button>
                                )}
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
