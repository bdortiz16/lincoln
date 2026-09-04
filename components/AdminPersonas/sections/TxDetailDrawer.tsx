import React, { useEffect, useState } from 'react';
import {
    X, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
    User as UserIcon, Building2, Hash, FileText, Receipt, Shield
} from 'lucide-react';
import { supabasePersonas } from '../../../lib/supabaseClient';
import { logAdminAction, PERMISSIONS, type AdminProfile } from '../lib/adminAuth';
import { useConfirm } from '../lib/useConfirm';
import { NAVY, TEAL, formatDate, formatAmount, StatusBadge } from './shared';
import { normalizeTx, tryUpdateTxStatus, type TxRow } from './TransactionsSection';
import { Step2FAModal } from './Step2FAModal';

interface Props {
    txId: string;
    onClose: () => void;
    onUpdated?: () => void;
    profile: AdminProfile;
}

export const TxDetailDrawer: React.FC<Props> = ({ txId, onClose, onUpdated, profile }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [tx, setTx] = useState<TxRow | null>(null);
    const [rawRow, setRawRow] = useState<any>(null);   // fila completa con todas las columnas
    const [user, setUser] = useState<any>(null);
    const [contact, setContact] = useState<any>(null);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [approvals, setApprovals] = useState<any[]>([]);
    const [needsDual, setNeedsDual] = useState(false);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [comment, setComment] = useState('');
    // Step-up 2FA antes de aprobar/rechazar
    const [pendingDecision, setPendingDecision] = useState<'approve' | 'reject' | null>(null);
    // Historial del cliente (TX agregadas por mes)
    const [clientHistory, setClientHistory] = useState<Array<{ month: string; total_in: number; total_out: number; count: number }>>([]);
    // Cantidad de comprobantes de respaldo (interno) subidos para esta TX
    const [adminReceiptCount, setAdminReceiptCount] = useState(0);
    // Saldo en sistema de la cuenta en la moneda del pago (null = no verificable)
    const [acctBalance, setAcctBalance] = useState<number | null>(null);

    const canApprove = PERMISSIONS.canApproveTx(profile.role);

    // Envío/pago al cliente: requiere comprobante de respaldo antes de aprobar.
    const txKind = String(tx?.raw?.kind ?? tx?.type ?? '').toLowerCase();
    const isSendTx = ['send', 'envio', 'envío', 'pago', 'payment', 'withdraw', 'retiro'].includes(txKind);
    const receiptRequired = isSendTx;
    const receiptMissing = receiptRequired && adminReceiptCount === 0;

    // Protocolo de saldo: el monto que sale de tesorería para pagarle al cliente.
    const payoutCurrency = String(tx?.to_currency ?? tx?.from_currency ?? '').toUpperCase();
    const payoutAmount = Number(tx?.to_amount ?? tx?.from_amount ?? 0) || 0;
    const fundsKnown = acctBalance !== null;
    // Sólo bloqueamos por saldo en envíos, cuando SÍ pudimos leer el saldo del sistema.
    const fundsInsufficient = isSendTx && fundsKnown && (acctBalance as number) < payoutAmount;

    const load = async () => {
        setLoading(true);
        const txRes = await supabasePersonas.from('transactions').select('*').eq('id', txId).maybeSingle();
        const row = txRes.data as any;
        setRawRow(row);
        const t = row ? normalizeTx(row) : null;
        setTx(t);

        if (t) {
            const [u, c, a, ap, nd] = await Promise.all([
                t.user_id ? supabasePersonas.from('users').select('id, email, full_name, cuypay_id, country, flag, kyc_status').eq('id', t.user_id).maybeSingle() : Promise.resolve({ data: null } as any),
                row.contact_id ? supabasePersonas.from('contacts').select('*').eq('id', row.contact_id).maybeSingle() : Promise.resolve({ data: null } as any),
                supabasePersonas.from('compliance_alerts').select('*').eq('transaction_id', txId).then(r => r).catch(() => ({ data: [] } as any)),
                supabasePersonas.from('tx_approvals').select('*').eq('transaction_id', txId).order('created_at', { ascending: true }).then(r => r).catch(() => ({ data: [] } as any)),
                supabasePersonas.rpc('tx_needs_dual_approval', { p_tx_id: txId }).then(r => r).catch(() => ({ data: false } as any)),
            ]);
            setUser(u.data);
            setContact(c.data);
            setAlerts((a.data as any[]) ?? []);
            setApprovals((ap.data as any[]) ?? []);
            setNeedsDual(Boolean(nd.data));

            // Historial del cliente: TX agregadas por mes (últimos 12)
            if (t.user_id) {
                const since = new Date();
                since.setMonth(since.getMonth() - 12);
                const hist = await supabasePersonas
                    .from('transactions')
                    .select('amount, currency, kind, status, created_at')
                    .eq('owner_user_id', t.user_id)
                    .gte('created_at', since.toISOString())
                    .order('created_at', { ascending: false })
                    .limit(2000);
                // Agrupar por YYYY-MM
                const buckets: Record<string, { total_in: number; total_out: number; count: number }> = {};
                for (const r of (hist.data ?? []) as any[]) {
                    const status = String(r.status ?? '').toLowerCase();
                    // Sólo contamos TX terminadas (completed/approved) en los totales
                    const isFinal = ['completed','approved','aprobada','completado','aprobado'].includes(status);
                    if (!isFinal) continue;
                    const d = new Date(r.created_at);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
                    const bucket = (buckets[key] ??= { total_in: 0, total_out: 0, count: 0 });
                    const amount = Number(r.amount || 0);
                    if (r.kind === 'load') bucket.total_in += amount;
                    else if (r.kind === 'send') bucket.total_out += amount;
                    bucket.count += 1;
                }
                const arr = Object.entries(buckets)
                    .map(([month, v]) => ({ month, ...v }))
                    .sort((a, b) => b.month.localeCompare(a.month));
                setClientHistory(arr);
            }

            // Saldo de tesorería en la moneda del pago (sin billetera de utilidades).
            // Aunque el banco real tenga plata, si no está reportada en el sistema
            // la cuenta aparece en cero o con menos del monto a pagar → no se paga.
            const payoutCcy = String(t.to_currency ?? t.from_currency ?? '').toUpperCase();
            if (payoutCcy) {
                const taRes = await supabasePersonas
                    .from('treasury_accounts')
                    .select('currency, balance, is_profit')
                    .then(r => r)
                    .catch(() => ({ data: null, error: { message: 'no table' } } as any));
                if (taRes.error || !taRes.data) {
                    setAcctBalance(null);   // no se pudo verificar (¿migración pendiente?)
                } else {
                    let bal = 0;
                    for (const a of taRes.data as any[]) {
                        if (a.is_profit) continue;
                        if (String(a.currency).toUpperCase() === payoutCcy) bal += Number(a.balance) || 0;
                    }
                    setAcctBalance(bal);
                }
            } else {
                setAcctBalance(null);
            }
        }
        setLoading(false);
    };

    useEffect(() => { load(); }, [txId]);

    const decide = async (decision: 'approve' | 'reject') => {
        if (!canApprove || !tx) return;
        if (decision === 'approve') {
            // Candado 1: saldo del sistema en la moneda del pago.
            if (fundsInsufficient) {
                await confirm({
                    title: 'Saldo insuficiente',
                    message: `No hay saldo suficiente reportado en cuentas ${payoutCurrency}.\nDisponible: ${formatAmount(acctBalance ?? 0, payoutCurrency)} · Necesario: ${formatAmount(payoutAmount, payoutCurrency)}.\n\nReporta el saldo de la cuenta o cruza/compra fondos en Tesorería antes de pagar.`,
                    variant: 'warning',
                    alertOnly: true,
                });
                return;
            }
            // Candado 2: comprobante de respaldo del pago.
            if (receiptMissing) {
                await confirm({
                    title: 'Falta comprobante',
                    message: 'Debes subir el comprobante de respaldo del pago antes de aprobar este envío.',
                    variant: 'warning',
                    alertOnly: true,
                });
                return;
            }
        }
        setProcessing(true);
        try {
            // Intento de doble aprobación (puede fallar si la tabla no existe)
            const { error: voteErr } = await supabasePersonas.from('tx_approvals').insert({
                transaction_id: txId,
                approver_id: profile.id,
                approver_email: profile.email,
                approver_role: profile.role,
                decision,
                comment: comment.trim() || null,
            });
            const voteFailed = voteErr && !voteErr.message.includes('duplicate');

            // Decidir si aplicamos status final ahora
            const intent: 'approved' | 'rejected' = decision === 'reject' ? 'rejected' : 'approved';
            let applyFinal = decision === 'reject' || voteFailed;
            if (decision === 'approve' && !voteFailed) {
                if (needsDual) {
                    const { data: hasDual } = await supabasePersonas.rpc('tx_has_dual_approval', { p_tx_id: txId });
                    applyFinal = Boolean(hasDual);
                } else {
                    applyFinal = true;
                }
            }

            let appliedStatus: string | null = null;
            if (applyFinal) {
                const r = await tryUpdateTxStatus(txId, intent, profile.id);
                if (!r.ok) {
                    await confirm({
                        title: 'Error de constraint',
                        message: `Error: ${r.error}\n\nLa columna "status" tiene un CHECK constraint que no acepta los valores probados. Corre este SQL en Supabase:\n\nSELECT pg_get_constraintdef(c.oid)\nFROM pg_constraint c\nJOIN pg_class t ON c.conrelid = t.oid\nWHERE t.relname = 'transactions'\nAND conname = 'transactions_status_check';`,
                        variant: 'danger',
                        alertOnly: true,
                        confirmLabel: 'Cerrar',
                    });
                    setProcessing(false);
                    return;
                }
                appliedStatus = r.appliedStatus;
            }

            await logAdminAction({
                admin: profile,
                action: decision === 'approve' ? 'tx_approve' : 'tx_reject',
                targetType: 'transaction',
                targetId: txId,
                metadata: { amount: tx.from_amount, currency: tx.from_currency, comment: comment.trim() || null, applied_status: appliedStatus },
            });
            setComment('');
            await load();
            onUpdated?.();
        } catch (e: any) {
            await confirm({
                title: 'Error',
                message: e?.message ?? 'Error',
                variant: 'danger',
                alertOnly: true,
                confirmLabel: 'Cerrar',
            });
        } finally {
            setProcessing(false);
        }
    };

    const fee = Number(rawRow?.fee ?? rawRow?.raw_data?.fee) || 0;
    const totalDebit = (tx?.from_amount ?? 0) + fee;
    const myVote = approvals.find(a => a.approver_id === profile.id);
    const distinctApprovers = new Set(approvals.filter(a => a.decision === 'approve').map(a => a.approver_id)).size;

    // raw_data del Android — donde realmente vienen los detalles
    const rd = rawRow?.raw_data ?? {};
    // Campos típicos que puede traer la app Android
    const description = rawRow?.description ?? rd.description ?? rd.title ?? null;
    const senderName = rd.senderName ?? rd.sender_name ?? rd.from ?? null;
    const receiverName = rd.receiverName ?? rd.receiver_name ?? rd.to ?? null;
    const initials = rd.initials ?? null;

    // Lista de columnas a destacar (todo lo que tenga valor en la fila ó en raw_data)
    const detailEntries: Array<[string, any]> = [];
    if (rawRow) {
        for (const [k, v] of Object.entries(rawRow)) {
            if (v === null || v === undefined || v === '') continue;
            if (['id', 'raw_data', 'created_at', 'user_id', 'status', 'type'].includes(k)) continue;
            detailEntries.push([k, v]);
        }
        for (const [k, v] of Object.entries(rd)) {
            if (v === null || v === undefined || v === '') continue;
            if (detailEntries.some(([kk]) => kk === k)) continue;
            detailEntries.push([`raw_data.${k}`, v]);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {confirmDialog}
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div
                className="relative bg-white w-full max-w-3xl max-h-[92vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-3 bg-white">
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-semibold">Transacción</p>
                        <div className="flex items-center gap-2 mt-1">
                            <p className="font-bold text-base" style={{ color: NAVY }}>
                                {tx?.id ? `#${tx.id.slice(0, 8).toUpperCase()}` : '—'}
                            </p>
                            <StatusBadge status={tx?.statusKey === 'other' ? tx.statusRaw : (tx?.statusKey ?? null)} />
                            {needsDual && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-bold border border-amber-200">
                                    DOBLE APROB.
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100" title="Refrescar">
                            <RefreshCw size={16} className={loading ? 'animate-spin text-slate-400' : 'text-slate-500'} />
                        </button>
                        <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" title="Cerrar">
                            <X size={18} className="text-slate-500" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-auto p-5 space-y-4">
                    {loading && <p className="text-slate-400">Cargando...</p>}

                    {!loading && tx && (
                        <>
                            {/* Operación — card principal con acciones inline */}
                            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                                <div className="px-5 pt-5 pb-4">
                                    <div className="flex items-start justify-between gap-3 mb-4">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500 font-semibold">Monto de la operación</p>
                                            <p className="text-3xl font-bold font-mono mt-1" style={{ color: NAVY, letterSpacing: '-0.01em' }}>
                                                {formatAmount(tx.from_amount, tx.from_currency)}
                                            </p>
                                            {tx.to_currency && tx.to_currency !== tx.from_currency && (
                                                <p className="text-sm text-slate-600 mt-1.5 font-mono">
                                                    → {formatAmount(tx.to_amount, tx.to_currency)}
                                                </p>
                                            )}
                                            <p className="text-[11px] text-slate-500 mt-2 capitalize">
                                                {tx.type} · {new Date(tx.created_at).toLocaleString('es-CO')}
                                            </p>
                                        </div>
                                    </div>

                                    {(fee > 0) && (
                                        <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4 text-sm">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Comisión</p>
                                                <p className="font-mono font-semibold mt-0.5" style={{ color: NAVY }}>{fee.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total débito</p>
                                                <p className="font-mono font-semibold mt-0.5" style={{ color: NAVY }}>{totalDebit.toLocaleString('es-CO', { minimumFractionDigits: 2 })}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Acciones — adentro de la card de la operación */}
                                {tx.statusKey === 'pending' && canApprove && (
                                    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
                                        {!myVote ? (
                                            <>
                                                <textarea
                                                    value={comment}
                                                    onChange={e => setComment(e.target.value)}
                                                    placeholder="Comentario (opcional) — quedará en el audit log"
                                                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:border-green-500 outline-none mb-3"
                                                    rows={2}
                                                />
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        onClick={() => setPendingDecision('reject')}
                                                        disabled={processing}
                                                        className="py-2.5 rounded-xl bg-white border-2 border-red-200 text-red-700 font-bold text-sm flex items-center justify-center gap-2 hover:bg-red-50 disabled:opacity-50 transition-colors"
                                                    >
                                                        <XCircle size={16} /> Rechazar
                                                    </button>
                                                    <button
                                                        onClick={() => setPendingDecision('approve')}
                                                        disabled={processing || receiptMissing || fundsInsufficient}
                                                        title={fundsInsufficient ? 'Saldo insuficiente reportado en el sistema' : receiptMissing ? 'Sube el comprobante de respaldo del pago antes de aprobar' : undefined}
                                                        style={{ backgroundColor: NAVY }}
                                                        className="py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                                                    >
                                                        <CheckCircle2 size={16} /> Aprobar
                                                    </button>
                                                </div>
                                                {fundsInsufficient ? (
                                                    <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 mt-2 text-[11px] text-red-800 leading-snug">
                                                        <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={12} /> Saldo insuficiente en cuentas {payoutCurrency}</p>
                                                        <p className="mt-1">Disponible en sistema: <b>{formatAmount(acctBalance ?? 0, payoutCurrency)}</b> · Necesario: <b>{formatAmount(payoutAmount, payoutCurrency)}</b>.</p>
                                                        <p className="mt-1">Aunque el banco real tenga fondos, si no están reportados en el sistema no se puede pagar. Reporta el saldo o cruza/compra fondos en Tesorería.</p>
                                                    </div>
                                                ) : receiptMissing && (
                                                    <p className="text-[11px] text-amber-700 text-center mt-2 font-medium flex items-center justify-center gap-1.5">
                                                        <AlertTriangle size={11} />
                                                        Sube el comprobante de respaldo del pago (abajo) para poder aprobar
                                                    </p>
                                                )}
                                                {needsDual && (
                                                    <p className="text-[11px] text-amber-700 text-center mt-2 font-medium">
                                                        Requiere 2 aprobadores distintos · Tu voto es el {approvals.length === 0 ? '1°' : '2°'} de 2
                                                    </p>
                                                )}
                                                <p className="text-[11px] text-slate-500 text-center mt-2 flex items-center justify-center gap-1.5">
                                                    <Shield size={11} />
                                                    Confirmación con 2FA requerida
                                                </p>
                                            </>
                                        ) : (
                                            <p className="text-sm text-center text-slate-600 py-2">
                                                Tu voto: <strong style={{ color: NAVY }}>{myVote.decision === 'approve' ? 'Aprobado ✓' : 'Rechazado ✗'}</strong>
                                                {needsDual && distinctApprovers < 2 && ' · esperando otro aprobador'}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Parties */}
                            <Section title="Partes">
                                <KvItem icon={UserIcon} label="Origen (usuario)" value={
                                    user ? `${user.full_name ?? '—'} · ${user.cuypay_id ?? '—'} (${user.email})` : (tx.user_id ?? '—')
                                } />
                                {senderName && <KvItem icon={UserIcon} label="Remitente" value={senderName} />}
                                {receiverName && <KvItem icon={UserIcon} label="Destinatario" value={receiverName} />}
                                {rawRow?.source_type === 'SELF' && (
                                    <KvItem icon={UserIcon} label="Destino" value="A sí mismo" />
                                )}
                                {contact && (
                                    <KvItem icon={UserIcon} label="Destino (contacto)" value={`${contact.name} · ${contact.email ?? '—'}`} />
                                )}
                                {tx.bank_name && (
                                    <KvItem icon={Building2} label="Banco destino" value={
                                        `${tx.bank_name} · ${rawRow?.account_type ?? rd.account_type ?? ''} ${tx.account_number ?? ''}`.trim()
                                    } />
                                )}
                            </Section>

                            {/* Timeline */}
                            <Section title="Línea de tiempo">
                                <Timeline items={[
                                    { label: 'Creada', at: tx.created_at, done: true },
                                    { label: tx.statusKey === 'approved' ? 'Aprobada' : tx.statusKey === 'rejected' ? 'Rechazada' : 'Pendiente de aprobación', at: rawRow?.approved_at ?? null, done: tx.statusKey !== 'pending' },
                                    { label: 'Completada', at: tx.statusKey === 'completed' ? (rawRow?.approved_at ?? null) : null, done: tx.statusKey === 'completed' },
                                ]} />
                            </Section>

                            {/* Detalles completos (raw_data + columnas extra) */}
                            <Section title={`Detalles (${detailEntries.length})`}>
                                {detailEntries.length === 0 ? (
                                    <p className="text-sm text-slate-500 italic">Sin detalles adicionales</p>
                                ) : (
                                    <div className="bg-slate-50 rounded-xl overflow-hidden">
                                        {detailEntries.map(([k, v]) => (
                                            <div key={k} className="px-3 py-2 border-b border-white last:border-b-0 flex items-start gap-3">
                                                <p className="text-xs font-semibold text-slate-500 w-40 shrink-0 font-mono">{k}</p>
                                                <p className="text-sm text-slate-900 break-all flex-1">
                                                    {typeof v === 'object' ? <code className="text-xs font-mono">{JSON.stringify(v)}</code> : String(v)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </Section>

                            {/* Comprobante adjunto por el usuario */}
                            {(rawRow?.receipt_url || rd.receipt_url) && (
                                <Section title="Comprobante adjunto">
                                    <ReceiptViewer url={rawRow?.receipt_url ?? rd.receipt_url} />
                                </Section>
                            )}

                            {/* Comprobante de respaldo del pago (interno — no se muestra al cliente) */}
                            <Section title={`Comprobante de respaldo (interno)${receiptRequired ? ' · requerido para aprobar' : ''}`}>
                                <AdminReceiptUploader
                                    txId={txId}
                                    profile={profile}
                                    onCountChange={setAdminReceiptCount}
                                    uploadBlockedReason={fundsInsufficient
                                        ? `No puedes subir el comprobante: no hay saldo suficiente reportado en cuentas ${payoutCurrency} (disponible ${formatAmount(acctBalance ?? 0, payoutCurrency)} · necesario ${formatAmount(payoutAmount, payoutCurrency)}). Reporta el saldo o cruza fondos en Tesorería primero.`
                                        : null}
                                />
                            </Section>

                            {/* Historial del cliente (últimos 12 meses) */}
                            {clientHistory.length > 0 && (
                                <Section title={`Historial del cliente · ${clientHistory.length} mes${clientHistory.length === 1 ? '' : 'es'}`}>
                                    <ClientHistoryTable rows={clientHistory} currency={tx.from_currency ?? ''} />
                                </Section>
                            )}

                            {/* Compliance */}
                            {alerts.length > 0 && (
                                <Section title={`Alertas de compliance (${alerts.length})`}>
                                    {alerts.map(a => (
                                        <div key={a.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <AlertTriangle size={14} className="text-amber-700" />
                                                <span className="text-sm font-bold text-amber-900">{a.rule_name}</span>
                                                <span className="text-xs uppercase font-bold text-amber-700">{a.severity}</span>
                                            </div>
                                            <p className="text-xs text-amber-900">{a.description}</p>
                                        </div>
                                    ))}
                                </Section>
                            )}

                            {/* Doble aprobación */}
                            {needsDual && (
                                <Section title={`Aprobaciones (${approvals.length} votos · ${distinctApprovers}/2 únicos)`}>
                                    {approvals.length === 0 && <p className="text-sm text-slate-500 italic">Sin votos aún</p>}
                                    {approvals.map(a => (
                                        <div key={a.id} className="bg-slate-50 rounded-xl p-3 flex items-center gap-2 text-sm">
                                            {a.decision === 'approve' ? <CheckCircle2 size={14} className="text-green-600" /> : <XCircle size={14} className="text-red-600" />}
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-slate-900 truncate">{a.approver_email}</p>
                                                {a.comment && <p className="text-xs text-slate-500 italic truncate">"{a.comment}"</p>}
                                            </div>
                                            <span className="text-xs text-slate-400 shrink-0">{formatDate(a.created_at)}</span>
                                        </div>
                                    ))}
                                </Section>
                            )}

                            <KvItem icon={Hash} label="TX ID" value={tx.id} mono />
                            {description && <KvItem icon={FileText} label="Descripción" value={description} />}

                        </>
                    )}

                    {!loading && !tx && (
                        <div className="text-center text-slate-500 py-10">
                            <p>No se encontró la transacción</p>
                            <p className="text-xs mt-1 font-mono">ID: {txId}</p>
                        </div>
                    )}
                </div>

            </div>

            {/* Step-up 2FA antes de aprobar / rechazar */}
            {pendingDecision && tx && (
                <Step2FAModal
                    action={pendingDecision === 'approve'
                        ? `aprobar la TX de ${formatAmount(tx.from_amount, tx.from_currency)}`
                        : `rechazar la TX de ${formatAmount(tx.from_amount, tx.from_currency)}`}
                    onConfirmed={() => decide(pendingDecision)}
                    onClose={() => setPendingDecision(null)}
                />
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Comprobante de respaldo del pago (INTERNO)
//
// Cuando el admin paga al cliente (envío) y marca completado, sube aquí el
// soporte del pago. Este comprobante es SOLO interno: se guarda en el bucket
// privado `admin-receipts` y NO se le muestra al cliente en la app.
// ─────────────────────────────────────────────
const ADMIN_RECEIPTS_BUCKET = 'admin-receipts';

const AdminReceiptUploader: React.FC<{ txId: string; profile: AdminProfile; onCountChange?: (n: number) => void; uploadBlockedReason?: string | null }> = ({ txId, profile, onCountChange, uploadBlockedReason }) => {
    const { confirm, dialog: confirmDialog } = useConfirm();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState('');
    const [urls, setUrls] = useState<Record<string, string>>({});

    const canUpload = PERMISSIONS.canApproveTx(profile.role) || PERMISSIONS.canManageBankAccounts(profile.role);

    const load = async () => {
        setLoading(true);
        const { data, error: e } = await supabasePersonas
            .from('tx_admin_receipts')
            .select('*')
            .eq('transaction_id', txId)
            .order('created_at', { ascending: false });
        if (e) {
            // Tabla puede no existir todavía (migración pendiente)
            setError(/relation .* does not exist|tx_admin_receipts/i.test(e.message)
                ? 'Falta correr la migración 2026_admin_receipts.sql en Supabase.'
                : e.message);
            setItems([]);
            onCountChange?.(0);
            setLoading(false);
            return;
        }
        setError(null);
        const rows = (data as any[]) ?? [];
        setItems(rows);
        onCountChange?.(rows.length);
        // Firmar URLs (bucket privado)
        const signed: Record<string, string> = {};
        await Promise.all(rows.map(async r => {
            try {
                const s = await supabasePersonas.storage.from(ADMIN_RECEIPTS_BUCKET).createSignedUrl(r.file_path, 60 * 60);
                if (s.data?.signedUrl) signed[r.id] = s.data.signedUrl;
            } catch { /* sin permiso o no existe */ }
        }));
        setUrls(signed);
        setLoading(false);
    };

    useEffect(() => { load(); }, [txId]);

    const handleFile = async (file: File | null) => {
        if (!file) return;
        if (uploadBlockedReason) { setError(uploadBlockedReason); return; }
        setUploading(true);
        setError(null);
        try {
            const safeName = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${txId}/${Date.now()}_${safeName}`;
            const up = await supabasePersonas.storage
                .from(ADMIN_RECEIPTS_BUCKET)
                .upload(path, file, { upsert: false, contentType: file.type || undefined });
            if (up.error) {
                setError(/Bucket not found/i.test(up.error.message)
                    ? 'El bucket admin-receipts no existe. Corre la migración 2026_admin_receipts.sql.'
                    : up.error.message);
                setUploading(false);
                return;
            }
            const ins = await supabasePersonas.from('tx_admin_receipts').insert({
                transaction_id: txId,
                file_path: path,
                note: note.trim() || null,
                uploaded_by: profile.id,
                uploaded_email: profile.email,
            });
            if (ins.error) { setError(ins.error.message); setUploading(false); return; }
            await logAdminAction({
                admin: profile,
                action: 'tx_admin_receipt_upload',
                targetType: 'transaction',
                targetId: txId,
                metadata: { file_path: path },
            }).catch(() => {});
            setNote('');
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Error al subir el comprobante.');
        } finally {
            setUploading(false);
        }
    };

    const remove = async (item: any) => {
        const ok = await confirm({
            title: 'Eliminar comprobante',
            message: '¿Eliminar este comprobante interno?',
            variant: 'danger',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        try {
            await supabasePersonas.storage.from(ADMIN_RECEIPTS_BUCKET).remove([item.file_path]).catch(() => {});
            await supabasePersonas.from('tx_admin_receipts').delete().eq('id', item.id);
            await logAdminAction({
                admin: profile,
                action: 'tx_admin_receipt_delete',
                targetType: 'transaction',
                targetId: txId,
                metadata: { file_path: item.file_path },
            }).catch(() => {});
            await load();
        } catch (e: any) {
            setError(e?.message ?? 'Error al eliminar.');
        }
    };

    return (
        <div className="space-y-3">
            {confirmDialog}
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                <Shield size={14} className="text-amber-700 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-900 leading-snug">
                    Soporte del pago que <b>tú</b> le hiciste al cliente. Es de uso <b>interno</b> —
                    el cliente <b>no</b> lo ve en la app. Se guarda en un bucket privado.
                </p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">{error}</div>
            )}

            {/* Lista de comprobantes ya subidos */}
            {loading ? (
                <p className="text-xs text-slate-400 italic">Cargando comprobantes...</p>
            ) : items.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Aún no hay comprobante de respaldo.</p>
            ) : (
                <div className="space-y-2">
                    {items.map(it => {
                        const u = urls[it.id];
                        const fname = String(it.file_path).split('/').pop() ?? 'comprobante';
                        const isImg = /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(fname);
                        return (
                            <div key={it.id} className="bg-slate-50 rounded-xl p-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <Receipt size={14} className="text-slate-500" />
                                    <p className="text-xs font-semibold text-slate-700 flex-1 truncate" title={fname}>{fname}</p>
                                    {u && (
                                        <a href={u} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-green-700 hover:underline shrink-0">Abrir ↗</a>
                                    )}
                                    {PERMISSIONS.canManageBankAccounts(profile.role) && (
                                        <button onClick={() => remove(it)} className="text-xs font-semibold text-red-600 hover:underline shrink-0">Eliminar</button>
                                    )}
                                </div>
                                {it.note && <p className="text-xs text-slate-600 mb-1.5">{it.note}</p>}
                                {u && isImg && (
                                    <a href={u} target="_blank" rel="noopener noreferrer">
                                        <img src={u} alt="Comprobante interno" className="w-full rounded-lg border border-slate-200 max-h-56 object-contain bg-white" />
                                    </a>
                                )}
                                <p className="text-[10px] text-slate-400 mt-1">
                                    {it.uploaded_email ?? 'admin'} · {formatDate(it.created_at)}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Bloqueado por saldo insuficiente reportado en el sistema */}
            {uploadBlockedReason ? (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 leading-snug flex items-start gap-2">
                    <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
                    <span>{uploadBlockedReason}</span>
                </div>
            ) : canUpload && (
                <div className="bg-white border border-dashed border-slate-300 rounded-xl p-3 space-y-2">
                    <input
                        type="text"
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Nota (opcional): banco, referencia, etc."
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-400"
                    />
                    <label className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold cursor-pointer transition ${uploading ? 'bg-slate-100 text-slate-400' : 'bg-green-600 text-white hover:bg-green-700'}`}>
                        <FileText size={15} />
                        {uploading ? 'Subiendo...' : 'Subir comprobante de respaldo'}
                        <input
                            type="file"
                            accept="image/*,application/pdf"
                            className="hidden"
                            disabled={uploading}
                            onChange={e => handleFile(e.target.files?.[0] ?? null)}
                        />
                    </label>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Comprobante: si es imagen, muestra preview; si no, link
//
// La app Android puede guardar receipt_url como:
//   • URL absoluta (https://xxx.supabase.co/storage/v1/object/public/receipts/abc.png)
//   • Path relativo del bucket (receipts/abc.png ó abc.png)
//   • Path con bucket explícito (receipts/abc.png)
//
// Si el href es relativo, el navegador lo resuelve contra lincoin.me y manda
// al user a la landing. Esto resuelve siempre a una URL absoluta del bucket
// de Supabase Storage para que abra el archivo real.
// ─────────────────────────────────────────────

// Buckets típicos donde la app puede guardar comprobantes. Además de esta
// lista, intentamos descubrir los buckets reales con listBuckets().
const RECEIPT_BUCKET_CANDIDATES = [
    'receipts', 'comprobantes', 'tx-receipts', 'transaction-receipts',
    'transactions', 'load-receipts', 'soportes', 'vouchers', 'payments',
    'kyc', 'documents', 'uploads', 'media', 'public',
];

const ReceiptViewer: React.FC<{ url: string }> = ({ url }) => {
    const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [triedBuckets, setTriedBuckets] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setResolvedUrl(null);
            setError(null);

            // Caso 1: URL absoluta — usar directo
            if (/^https?:\/\//i.test(url)) {
                if (!cancelled) setResolvedUrl(url);
                return;
            }

            const rawPath = url.replace(/^\/+/, '');

            // Lista de buckets a probar: los reales del proyecto + candidatos.
            // 'receipts' primero porque es el bucket confirmado de Lincoin.
            let buckets: string[] = ['receipts'];
            try {
                const { data: realBuckets } = await supabasePersonas.storage.listBuckets();
                if (realBuckets?.length) for (const b of realBuckets) if (!buckets.includes(b.name)) buckets.push(b.name);
            } catch { /* listBuckets puede requerir permisos */ }
            for (const c of RECEIPT_BUCKET_CANDIDATES) if (!buckets.includes(c)) buckets.push(c);

            // Construir todas las URLs públicas candidatas (getPublicUrl NO hace
            // request — solo arma el string). El bucket receipts es público,
            // así que la URL pública carga directo.
            const candidates: string[] = [];
            for (const bucket of buckets) {
                const variants = [rawPath];
                if (rawPath.startsWith(`${bucket}/`)) variants.push(rawPath.slice(bucket.length + 1));
                for (const p of variants) {
                    const pub = supabasePersonas.storage.from(bucket).getPublicUrl(p);
                    if (pub.data?.publicUrl) candidates.push(pub.data.publicUrl);
                }
            }

            // Verificar cuál existe con HEAD en paralelo → tomar el primero 200.
            const checks = candidates.map(u =>
                fetch(u, { method: 'HEAD' })
                    .then(r => (r.ok ? u : Promise.reject(new Error('not found'))))
                    .catch(() => Promise.reject(new Error('not found')))
            );
            try {
                // Promise.any toma el primero que resuelve (existe)
                const found = await Promise.any(checks);
                if (!cancelled) setResolvedUrl(found);
                return;
            } catch {
                // Ninguna URL pública dio 200 — intentar signed URL (buckets privados)
                for (const bucket of buckets) {
                    const variants = [rawPath];
                    if (rawPath.startsWith(`${bucket}/`)) variants.push(rawPath.slice(bucket.length + 1));
                    for (const p of variants) {
                        try {
                            const signed = await supabasePersonas.storage.from(bucket).createSignedUrl(p, 60 * 60);
                            if (signed.data?.signedUrl) {
                                if (!cancelled) setResolvedUrl(signed.data.signedUrl);
                                return;
                            }
                        } catch { /* siguiente */ }
                    }
                }
            }

            // No se encontró en ningún bucket (ni público ni privado)
            if (!cancelled) {
                setTriedBuckets(buckets);
                setError('No se encontró el comprobante en ningún bucket de Storage.');
            }
        })();
        return () => { cancelled = true; };
    }, [url]);

    const finalUrl = resolvedUrl ?? url;
    const isImage = /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(finalUrl);
    const filename = url.split('/').pop() || 'comprobante';

    return (
        <div className="bg-slate-50 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-2">
                <Receipt size={14} className="text-slate-500" />
                <p className="text-xs text-slate-600 font-semibold flex-1 truncate" title={url}>{filename}</p>
                {resolvedUrl && (
                    <a
                        href={resolvedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-green-700 hover:underline shrink-0"
                    >
                        Abrir ↗
                    </a>
                )}
            </div>
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
                    {error}
                    <div className="mt-1 text-[10px] text-red-700 font-mono break-all">path: {url}</div>
                    {triedBuckets.length > 0 && (
                        <div className="mt-1 text-[10px] text-red-600">
                            Buckets probados: {triedBuckets.join(', ')}.
                            Si tu bucket no está en la lista, dime el nombre y lo agrego.
                        </div>
                    )}
                </div>
            )}
            {!error && resolvedUrl && isImage && (
                <a href={resolvedUrl} target="_blank" rel="noopener noreferrer">
                    <img
                        src={resolvedUrl}
                        alt="Comprobante"
                        className="w-full rounded-lg border border-slate-200 max-h-64 object-contain bg-white"
                        onError={() => setError('La imagen no se pudo cargar (¿el bucket es privado y la URL firmada falló?)')}
                    />
                </a>
            )}
            {!error && resolvedUrl && !isImage && (
                <a
                    href={resolvedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block bg-white border border-slate-200 rounded-lg p-3 text-center text-sm font-semibold text-green-700 hover:bg-slate-50"
                >
                    Abrir comprobante
                </a>
            )}
            {!error && !resolvedUrl && (
                <p className="text-xs text-slate-400 italic p-2">Cargando comprobante...</p>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// Tabla de historial mensual del cliente
// ─────────────────────────────────────────────
const ClientHistoryTable: React.FC<{
    rows: Array<{ month: string; total_in: number; total_out: number; count: number }>;
    currency: string;
}> = ({ rows, currency }) => {
    const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const totalIn = rows.reduce((s, r) => s + r.total_in, 0);
    const totalOut = rows.reduce((s, r) => s + r.total_out, 0);
    const totalCount = rows.reduce((s, r) => s + r.count, 0);
    return (
        <div className="bg-slate-50 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-100 border-b border-white grid grid-cols-4 gap-2 text-[10px] uppercase font-semibold text-slate-500 tracking-wider">
                <span>Mes</span>
                <span className="text-right">Cargas</span>
                <span className="text-right">Pagos</span>
                <span className="text-right">TX</span>
            </div>
            {rows.map(r => {
                const [y, m] = r.month.split('-');
                const label = `${MONTHS_ES[Number(m) - 1] ?? m} ${y}`;
                return (
                    <div key={r.month} className="px-3 py-2 border-b border-white last:border-b-0 grid grid-cols-4 gap-2 text-xs">
                        <span className="font-semibold text-slate-700">{label}</span>
                        <span className="text-right font-mono text-emerald-700">{formatAmount(r.total_in, currency)}</span>
                        <span className="text-right font-mono text-red-700">{formatAmount(r.total_out, currency)}</span>
                        <span className="text-right text-slate-600">{r.count}</span>
                    </div>
                );
            })}
            <div className="px-3 py-2 bg-slate-100 grid grid-cols-4 gap-2 text-xs font-bold">
                <span className="text-slate-700">Total 12m</span>
                <span className="text-right font-mono text-emerald-800">{formatAmount(totalIn, currency)}</span>
                <span className="text-right font-mono text-red-800">{formatAmount(totalOut, currency)}</span>
                <span className="text-right text-slate-700">{totalCount}</span>
            </div>
        </div>
    );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{title}</p>
        <div className="space-y-2">{children}</div>
    </div>
);

const KvItem: React.FC<{ icon: any; label: string; value: any; mono?: boolean }> = ({ icon: Icon, label, value, mono }) => (
    <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
        <Icon size={16} className="text-slate-400 shrink-0" />
        <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`text-sm break-all ${mono ? 'font-mono' : 'font-semibold'}`} style={{ color: NAVY }}>
                {value || '—'}
            </p>
        </div>
    </div>
);

const Timeline: React.FC<{ items: Array<{ label: string; at: string | null; done: boolean }> }> = ({ items }) => (
    <div className="bg-slate-50 rounded-xl p-4 space-y-3">
        {items.map((it, i) => (
            <div key={i} className="flex items-start gap-3">
                <div className="relative">
                    <div className="w-3 h-3 rounded-full mt-1" style={{ backgroundColor: it.done ? TEAL : '#CBD5E1' }} />
                    {i < items.length - 1 && (
                        <div className="absolute left-1/2 top-4 -ml-px w-0.5 h-8" style={{ backgroundColor: it.done ? TEAL : '#E2E8F0' }} />
                    )}
                </div>
                <div className="flex-1 pb-4">
                    <p className="text-sm font-semibold" style={{ color: NAVY }}>{it.label}</p>
                    <p className="text-xs text-slate-500">{it.at ? formatDate(it.at) : '—'}</p>
                </div>
            </div>
        ))}
    </div>
);
