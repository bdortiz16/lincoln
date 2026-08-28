import { supabasePersonas } from '../../../lib/supabaseClient';

/** Convierte un array de objetos a CSV y lo descarga en el navegador. */
export function downloadCsv(filename: string, rows: Record<string, any>[]) {
    if (rows.length === 0) {
        alert('No hay datos para exportar');
        return;
    }
    const headers = Object.keys(rows[0]);
    const escape = (v: any) => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const csv = [
        headers.join(','),
        ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
    ].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function fetchTransactionsReport(from: string, to: string) {
    const { data } = await supabasePersonas
        .from('transactions')
        .select('id, type, status, from_currency, to_currency, from_amount, to_amount, fee, created_at, approved_at, bank_name')
        .gte('created_at', from)
        .lte('created_at', to)
        .order('created_at', { ascending: false });
    return data ?? [];
}

export async function fetchMonthlyVolumeReport(months: number = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const { data } = await supabasePersonas
        .from('transactions')
        .select('from_currency, from_amount, type, status, created_at')
        .gte('created_at', since.toISOString())
        .in('status', ['approved', 'completed']);
    const grouped = new Map<string, { month: string; currency: string; volume: number; count: number }>();
    for (const t of (data ?? [])) {
        const r: any = t;
        const month = r.created_at.slice(0, 7);
        const cur = r.from_currency ?? 'UNK';
        const key = `${month}_${cur}`;
        const existing = grouped.get(key) ?? { month, currency: cur, volume: 0, count: 0 };
        existing.volume += Number(r.from_amount) || 0;
        existing.count += 1;
        grouped.set(key, existing);
    }
    return Array.from(grouped.values()).sort((a, b) => a.month.localeCompare(b.month));
}

export async function fetchKycFunnelReport() {
    const { data } = await supabasePersonas.from('users').select('kyc_status');
    const counts: Record<string, number> = {};
    for (const r of (data ?? [])) {
        const k = (r as any).kyc_status ?? 'none';
        counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
}
