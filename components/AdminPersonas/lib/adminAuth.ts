import { supabasePersonas } from '../../../lib/supabaseClient';

export type AdminRole = 'super_admin' | 'compliance' | 'treasury' | 'audit' | 'support';

// Las 5 monedas LATAM en las que CuyPay opera. Una persona de tesorería
// se puede asignar a UNA de estas para que solo vea ese mercado.
export type AssignedCurrency = 'COP' | 'CLP' | 'PEN' | 'MXN' | 'BRL';
export const TREASURY_CURRENCIES: AssignedCurrency[] = ['COP', 'CLP', 'PEN', 'MXN', 'BRL'];

// País ↔ moneda — usado para filtrar cuentas bancarias por country_code
// si el admin tiene una moneda asignada.
export const COUNTRY_TO_CURRENCY: Record<string, AssignedCurrency> = {
    CO: 'COP', CL: 'CLP', PE: 'PEN', MX: 'MXN', BR: 'BRL',
};

export interface AdminProfile {
    id: string;
    email: string;
    fullName: string;
    role: AdminRole;
    /** Si está seteado, el admin solo ve TX/cuentas/pares de esta moneda. */
    assignedCurrency: AssignedCurrency | null;
}

/** Trae el perfil del admin actualmente logueado (con su rol). */
export async function fetchCurrentAdminProfile(): Promise<AdminProfile | null> {
    const { data: { user } } = await supabasePersonas.auth.getUser();
    if (!user) return null;

    // Intento 1: con assigned_currency (esquema nuevo)
    let { data, error } = await supabasePersonas
        .from('users')
        .select('id, email, full_name, admin_role, assigned_currency')
        .eq('id', user.id)
        .maybeSingle();

    // Si la columna assigned_currency aún no existe (migración no aplicada),
    // reintentar sin ella para no romper el login.
    if (error && /assigned_currency/.test(error.message)) {
        const retry = await supabasePersonas
            .from('users')
            .select('id, email, full_name, admin_role')
            .eq('id', user.id)
            .maybeSingle();
        data = retry.data as any;
        error = retry.error;
    }

    if (error || !data || !data.admin_role) return null;

    return {
        id: data.id,
        email: data.email,
        fullName: data.full_name ?? data.email,
        role: data.admin_role as AdminRole,
        assignedCurrency: ((data as any).assigned_currency ?? null) as AssignedCurrency | null,
    };
}

/**
 * Registra una acción del admin en el audit log.
 * Llamar SIEMPRE después de una acción importante.
 */
export async function logAdminAction(params: {
    admin: AdminProfile;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    try {
        await supabasePersonas.from('admin_actions').insert({
            admin_id: params.admin.id,
            admin_email: params.admin.email,
            admin_role: params.admin.role,
            action: params.action,
            target_type: params.targetType ?? null,
            target_id: params.targetId ?? null,
            metadata: params.metadata ?? null,
        });
    } catch (e) {
        // No bloqueamos la UI si el log falla
        console.error('Failed to log admin action', e);
    }
}

// ─────────────────────────────────────────────
// Permisos por rol
// ─────────────────────────────────────────────

export type Section =
    | 'overview'
    | 'users'
    | 'compliance'
    | 'accounting'   // Contabilidad — utilidades por país + IVA (encima de Tesorería)
    | 'treasury'
    | 'fx'           // Tasas FX (sacado de Tesorería como entrada propia)
    | 'promotions'   // Referidos + Correo + Notificaciones push (campañas)
    | 'support'      // Soporte — hub de Crisp (bandeja, contactos, KB, analíticas)
    | 'legal'        // Legal — editores de los textos legales/páginas (app_settings)
    | 'audit-log'
    | 'security';

// Administradores vive como tab dentro de Seguridad (solo super_admin lo ve)
const ROLE_SECTIONS: Record<AdminRole, Section[]> = {
    super_admin: ['overview', 'users', 'compliance', 'accounting', 'treasury', 'fx', 'promotions', 'support', 'legal', 'audit-log', 'security'],
    compliance:  ['overview', 'users', 'compliance', 'treasury', 'promotions', 'support', 'legal', 'audit-log', 'security'],
    treasury:    ['overview', 'accounting', 'treasury', 'fx', 'audit-log', 'security'],
    audit:       ['overview', 'users', 'accounting', 'treasury', 'fx', 'audit-log', 'security'],
    support:     ['overview', 'users', 'treasury', 'promotions', 'support', 'security'],
};

export function canAccess(role: AdminRole, section: Section): boolean {
    return ROLE_SECTIONS[role]?.includes(section) ?? false;
}

export function getDefaultSection(role: AdminRole): Section {
    return ROLE_SECTIONS[role]?.[0] ?? 'overview';
}

// Permisos de mutación
export const PERMISSIONS = {
    canApproveKyc: (role: AdminRole) => role === 'super_admin' || role === 'compliance',
    canApproveTx: (role: AdminRole) => role === 'super_admin' || role === 'treasury',
    canManageBankAccounts: (role: AdminRole) => role === 'super_admin' || role === 'treasury',
    canManageAdmins: (role: AdminRole) => role === 'super_admin',
    canExportData: (role: AdminRole) => role !== 'support',
};

// Labels en español para mostrar en UI
export const ROLE_LABELS: Record<AdminRole, string> = {
    super_admin: 'Super Admin',
    compliance:  'Compliance',
    treasury:    'Tesorería',
    audit:       'Auditoría',
    support:     'Soporte',
};

export const ROLE_COLORS: Record<AdminRole, string> = {
    super_admin: '#2DD4BF',
    compliance:  '#A78BFA',
    treasury:    '#FBBF24',
    audit:       '#60A5FA',
    support:     '#34D399',
};

// ─────────────────────────────────────────────
// Scope por moneda (tesorería delegada)
// ─────────────────────────────────────────────

/** ¿Este admin tiene acceso TOTAL sin restricción de moneda? */
export function hasFullCurrencyAccess(profile: AdminProfile | null): boolean {
    if (!profile) return false;
    if (profile.role === 'super_admin') return true;
    if (profile.role === 'compliance' || profile.role === 'audit') return true;
    // treasury sin moneda asignada = "tesorería global"
    if (profile.role === 'treasury' && profile.assignedCurrency === null) return true;
    return false;
}

/** ¿El admin puede ver datos de esta moneda? */
export function canSeeCurrency(profile: AdminProfile | null, currency: string | null | undefined): boolean {
    if (!profile || !currency) return false;
    if (hasFullCurrencyAccess(profile)) return true;
    return profile.assignedCurrency === currency;
}

/** ¿El admin puede ver una transacción? (mira las dos monedas) */
export function canSeeTransaction(
    profile: AdminProfile | null,
    tx: { from_currency?: string | null; to_currency?: string | null; currency?: string | null },
): boolean {
    if (!profile) return false;
    if (hasFullCurrencyAccess(profile)) return true;
    if (!profile.assignedCurrency) return false;
    const c = profile.assignedCurrency;
    return tx.from_currency === c || tx.to_currency === c || tx.currency === c;
}

/** ¿El admin puede ver/usar este par FX? */
export function canSeePair(
    profile: AdminProfile | null,
    fromCurrency: string,
    toCurrency: string,
): boolean {
    if (!profile) return false;
    if (hasFullCurrencyAccess(profile)) return true;
    if (!profile.assignedCurrency) return false;
    return fromCurrency === profile.assignedCurrency || toCurrency === profile.assignedCurrency;
}

/** ¿El admin puede ver esta cuenta bancaria (mapeada vía país→moneda)? */
export function canSeeBankAccount(
    profile: AdminProfile | null,
    countryCode: string | null | undefined,
): boolean {
    if (!profile || !countryCode) return false;
    if (hasFullCurrencyAccess(profile)) return true;
    if (!profile.assignedCurrency) return false;
    const accountCurrency = COUNTRY_TO_CURRENCY[countryCode.toUpperCase()];
    return accountCurrency === profile.assignedCurrency;
}

/** ¿Puede aprobar/rechazar esta transacción específica? */
export function canApproveSpecificTx(
    profile: AdminProfile | null,
    tx: { from_currency?: string | null; to_currency?: string | null; currency?: string | null },
): boolean {
    if (!profile) return false;
    // super_admin aprueba todo
    if (profile.role === 'super_admin') return true;
    // treasury global aprueba todo
    if (profile.role === 'treasury' && profile.assignedCurrency === null) return true;
    // treasury con moneda → solo si la TX toca su moneda
    if (profile.role === 'treasury' && profile.assignedCurrency) {
        const c = profile.assignedCurrency;
        return tx.from_currency === c || tx.to_currency === c || tx.currency === c;
    }
    return false;
}
