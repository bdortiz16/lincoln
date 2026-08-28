import React, { useState } from 'react';
import { X, Ban, ShieldAlert, FileText, ShieldOff } from 'lucide-react';
import { NAVY, TEAL } from './shared';

// ─────────────────────────────────────────────
// BlockUserModal — flujo de bloqueo con 2 modos:
//
//   • TEMPORAL: motivo + notas + checklist de docs que el user debe
//     subir para desbloquearse. La app mobile ComplianceBanner rojo
//     muestra la checklist y permite subir docs.
//
//   • PERMANENTE: motivo + notas + textarea libre "otros / info
//     requerida" (sin checklist — el user no puede autodesbloquearse).
//     Aplica cuando los docs ya subidos NO justifican los movimientos
//     y el admin decide cerrar la cuenta indefinidamente.
//
// Persiste en public.users.{block_type, block_reason, block_notes,
// required_documents}. block_type = 'temporary' | 'permanent'.
// Ver migrations 2026_user_block_reason.sql + 2026_user_block_type.sql.
// ─────────────────────────────────────────────

export type BlockType = 'temporary' | 'permanent';

export interface BlockPayload {
    type:        BlockType;
    reason:      string;      // uno de REASONS
    notes:       string;      // libre
    required:    string[];    // vacío si type='permanent'
    customInfo?: string;      // "otros" — solo en permanente
}

interface Props {
    userLabel: string;         // "Kevin (kevineuropa189@gmail.com)"
    /** Si viene, arranca preseteado en ese modo (ej. desde el
     *  ReviewModal de Documentación al escalar a permanente). */
    initialType?: BlockType;
    onCancel: () => void;
    onConfirm: (payload: BlockPayload) => void;
    saving?: boolean;
}

const REASONS: Array<{ value: string; label: string }> = [
    { value: 'aml_infringement',    label: 'Infracción de norma AML' },
    { value: 'suspicious_activity', label: 'Actividad sospechosa' },
    { value: 'pep_mismatch',        label: 'PEP / lista de sanciones' },
    { value: 'identity_unverified', label: 'Identidad no verificada' },
    { value: 'fraud_suspected',     label: 'Sospecha de fraude' },
    { value: 'duplicate_account',   label: 'Cuenta duplicada' },
    { value: 'court_order',         label: 'Orden judicial / regulatoria' },
    { value: 'other',               label: 'Otro (ver notas)' },
];

const REQUIRED_DOCS: Array<{ value: string; label: string; hint?: string }> = [
    { value: 'cedula_front',    label: 'Cédula / ID (frente)' },
    { value: 'cedula_back',     label: 'Cédula / ID (dorso)' },
    { value: 'selfie',          label: 'Selfie con documento' },
    { value: 'proof_address',   label: 'Comprobante de dirección', hint: 'Factura de servicios <90 días' },
    { value: 'proof_income',    label: 'Comprobante de ingresos', hint: 'Liquidación de sueldo o extracto' },
    { value: 'bank_statement',  label: 'Extracto bancario' },
    { value: 'source_of_funds', label: 'Declaración de origen de fondos' },
    { value: 'tax_return',      label: 'Declaración de impuestos' },
];

export const BlockUserModal: React.FC<Props> = ({ userLabel, initialType, onCancel, onConfirm, saving }) => {
    const [type, setType]         = useState<BlockType>(initialType ?? 'temporary');
    const [reason, setReason]     = useState<string>('aml_infringement');
    const [notes, setNotes]       = useState<string>('');
    const [required, setRequired] = useState<Set<string>>(new Set(['cedula_front', 'selfie']));
    const [customInfo, setCustomInfo] = useState<string>('');

    const isPermanent = type === 'permanent';

    const toggleDoc = (v: string) => {
        setRequired(prev => {
            const next = new Set(prev);
            if (next.has(v)) next.delete(v); else next.add(v);
            return next;
        });
    };

    // Reglas de submit:
    //   - Motivo siempre requerido
    //   - Si motivo=other → notas obligatorias
    //   - Si type=permanent → customInfo obligatorio (el admin tiene que
    //     dejar por escrito por qué el bloqueo es indefinido)
    const canSubmit =
        !!reason
        && (reason !== 'other' || notes.trim().length > 0)
        && (!isPermanent || customInfo.trim().length > 0);

    return (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onCancel}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-slate-200">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isPermanent ? 'bg-red-900' : 'bg-red-100'}`}>
                            {isPermanent
                                ? <ShieldOff size={18} className="text-white" />
                                : <Ban size={18} className="text-red-600" />}
                        </div>
                        <div className="min-w-0">
                            <p className={`text-[10px] uppercase font-bold tracking-wider ${isPermanent ? 'text-red-900' : 'text-red-600'}`}>
                                {isPermanent ? 'Bloqueo permanente' : 'Bloqueo temporal'}
                            </p>
                            <p className="font-bold truncate" style={{ color: NAVY }}>{userLabel}</p>
                        </div>
                    </div>
                    <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg shrink-0">
                        <X size={18} className="text-slate-500" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                    {/* Toggle Temporal / Permanente — segmented control */}
                    <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
                        <button
                            type="button"
                            onClick={() => setType('temporary')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-colors ${
                                type === 'temporary'
                                    ? 'bg-white text-red-700 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <Ban size={12} /> Temporal
                        </button>
                        <button
                            type="button"
                            onClick={() => setType('permanent')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold transition-colors ${
                                type === 'permanent'
                                    ? 'bg-white text-red-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <ShieldOff size={12} /> Permanente
                        </button>
                    </div>

                    {isPermanent && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-[11px] text-red-800">
                            <p className="font-semibold mb-0.5">Bloqueo indefinido</p>
                            <p>El usuario no podrá autodesbloquearse desde la app. Solo se levanta manualmente desde acá.</p>
                        </div>
                    )}

                    {/* Motivo */}
                    <div>
                        <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                            <ShieldAlert size={12} /> Motivo del bloqueo *
                        </label>
                        <select
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:border-green-500 outline-none"
                        >
                            {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                    </div>

                    {/* Notas */}
                    <div>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5 block">
                            Notas {reason === 'other' && <span className="text-red-600">(requerido)</span>}
                        </label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={3}
                            placeholder="Contexto que verá el usuario en la app y quedará en el audit log…"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-green-500 outline-none resize-none"
                        />
                    </div>

                    {/* Documentos requeridos — solo en TEMPORAL */}
                    {!isPermanent && (
                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                                <FileText size={12} /> Documentos para levantar el bloqueo
                                <span className="ml-auto text-slate-400 font-mono">{required.size} seleccionado{required.size === 1 ? '' : 's'}</span>
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {REQUIRED_DOCS.map(d => {
                                    const checked = required.has(d.value);
                                    return (
                                        <label
                                            key={d.value}
                                            className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                                                checked
                                                    ? 'border-green-500 bg-green-50'
                                                    : 'border-slate-200 bg-white hover:bg-slate-50'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleDoc(d.value)}
                                                className="mt-0.5 accent-green-600 shrink-0"
                                            />
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold" style={{ color: NAVY }}>{d.label}</p>
                                                {d.hint && <p className="text-[10px] text-slate-500">{d.hint}</p>}
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                            {required.size === 0 && (
                                <p className="text-[11px] text-amber-700 mt-2">
                                    Sin documentos, el usuario no tendrá forma de desbloquearse desde la app.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Textarea "otros" — solo en PERMANENTE */}
                    {isPermanent && (
                        <div>
                            <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                                <FileText size={12} /> Información / justificativos requeridos
                                <span className="text-red-600">*</span>
                            </label>
                            <textarea
                                value={customInfo}
                                onChange={e => setCustomInfo(e.target.value)}
                                rows={4}
                                placeholder="Detallá qué otra info o documentación se requiere para reconsiderar el bloqueo (ej: contrato de trabajo, certificados AFIP, extractos de otras cuentas…). Quedará como registro en el audit log."
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-red-500 outline-none resize-none"
                            />
                            <p className="text-[11px] text-slate-500 mt-1">
                                Este texto se envía al mobile como razón del bloqueo indefinido y queda en el audit log.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                    <button
                        onClick={onCancel}
                        disabled={saving}
                        className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => canSubmit && onConfirm({
                            type,
                            reason,
                            notes: notes.trim(),
                            required: isPermanent ? [] : Array.from(required),
                            customInfo: isPermanent ? customInfo.trim() : undefined,
                        })}
                        disabled={!canSubmit || saving}
                        className={`ml-auto px-4 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-2 disabled:opacity-50 ${
                            isPermanent
                                ? 'bg-red-900 hover:bg-black'
                                : 'bg-red-600 hover:bg-red-700'
                        }`}
                    >
                        {isPermanent ? <ShieldOff size={14} /> : <Ban size={14} />}
                        {saving
                            ? 'Bloqueando…'
                            : isPermanent
                                ? 'Bloquear permanentemente'
                                : 'Bloquear temporalmente'}
                    </button>
                </div>
            </div>
        </div>
    );
};
