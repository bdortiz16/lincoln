import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Plus, Send, Archive, ArchiveRestore, Pencil, Copy, Check,
  RefreshCw, Wallet, Star, ChevronDown, ChevronUp, X,
} from 'lucide-react';

interface WalletItem {
  id: string; index: number; name: string; address: string; eoa?: string;
  balance: number; archived?: boolean; order?: number; principal?: boolean;
}

interface Props {
  userId: string;
  callGasfree: (payload: Record<string, unknown>) => Promise<any>;
  showToast: (msg: string, ms?: number, type?: 'success' | 'error') => void;
  onBack: () => void;
}

const shortAddr = (a?: string) => (a && a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : (a || '—'));

export const WalletsGasfreeSection: React.FC<Props> = ({ userId, callGasfree, showToast, onBack }) => {
  const [principal, setPrincipal] = useState<WalletItem | null>(null);
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  // Crear
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  // Renombrar
  const [renaming, setRenaming] = useState<WalletItem | null>(null);
  const [renameVal, setRenameVal] = useState('');
  // Cargar (recibir)
  const [depositWallet, setDepositWallet] = useState<WalletItem | null>(null);
  // Enviar
  const [sendFrom, setSendFrom] = useState<WalletItem | null>(null);
  const [sendDest, setSendDest] = useState<'principal' | 'other'>('principal');
  const [sendAddr, setSendAddr] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await callGasfree({ action: 'my_wallets_list', userId });
      if (r?.error) { showToast(r.error, 4000, 'error'); }
      else { setPrincipal(r.principal ?? null); setWallets(Array.isArray(r.wallets) ? r.wallets : []); }
    } catch (e: any) { showToast(e?.message ?? 'Error', 4000, 'error'); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

  const copy = (a: string) => { navigator.clipboard?.writeText(a); setCopied(a); setTimeout(() => setCopied(null), 1500); };

  const createWallet = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const r = await callGasfree({ action: 'my_wallet_create', userId, name: newName.trim() });
      if (r?.error) showToast(r.error, 4000, 'error');
      else { showToast('✅ Wallet creada'); setCreateOpen(false); setNewName(''); await load(); }
    } catch (e: any) { showToast(e?.message ?? 'Error', 4000, 'error'); }
    setBusy(false);
  };

  const updateWallet = async (id: string, patch: Record<string, unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      const r = await callGasfree({ action: 'my_wallet_update', userId, id, patch });
      if (r?.error) showToast(r.error, 4000, 'error');
      else { if (okMsg) showToast(okMsg); await load(); }
    } catch (e: any) { showToast(e?.message ?? 'Error', 4000, 'error'); }
    setBusy(false);
  };

  const doRename = async () => {
    if (!renaming || !renameVal.trim()) return;
    await updateWallet(renaming.id, { name: renameVal.trim() }, 'Nombre actualizado');
    setRenaming(null); setRenameVal('');
  };

  const runSend = async () => {
    if (!sendFrom) return;
    const amt = Number(sendAmount);
    if (!amt || amt <= 0) { showToast('Monto inválido', 3000, 'error'); return; }
    const toAddress = sendDest === 'principal' ? (principal?.address ?? '') : sendAddr.trim();
    if (!toAddress) { showToast('Falta la dirección destino', 3000, 'error'); return; }
    setSending(true);
    try {
      const r = await callGasfree({ action: 'my_wallet_send', userId, id: sendFrom.id, toAddress, amount: amt });
      if (r?.error) showToast(r.error, 5000, 'error');
      else {
        showToast(`✅ Enviado ${amt} USDT · comisión ${Number(r.feeChargedUsdt ?? 0).toFixed(2)} USDT`);
        setSendFrom(null); setSendAmount(''); setSendAddr(''); setSendDest('principal');
        await load();
      }
    } catch (e: any) { showToast(e?.message ?? 'Error', 5000, 'error'); }
    setSending(false);
  };

  const active = wallets.filter((w) => !w.archived);
  const archived = wallets.filter((w) => w.archived);

  const WalletCard: React.FC<{ w: WalletItem }> = ({ w }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Icono GasFree */}
          <div className="w-9 h-9 rounded-xl bg-[#0F172A] flex items-center justify-center shrink-0">
            <span className="text-[#2DD4BF] font-black text-base leading-none">₮</span>
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm text-slate-800 truncate">{w.name}</p>
            <p className="text-[10px] font-bold text-[#0D9488] uppercase tracking-wider">GasFree · TRON</p>
          </div>
        </div>
        <button onClick={() => copy(w.address)} className="flex items-center gap-1 text-[11px] font-mono text-slate-500 shrink-0">
          {shortAddr(w.address)} {copied === w.address ? <Check size={11} className="text-[#2DD4BF]" /> : <Copy size={11} />}
        </button>
      </div>
      <p className="text-xl font-black mt-3 text-[#0F172A]">
        {w.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs font-bold text-[#2DD4BF]">USDT</span>
      </p>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={() => setDepositWallet(w)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#2DD4BF] text-[#0F172A] hover:bg-[#5EEAD4]">
          <Plus size={13} /> Cargar
        </button>
        <button onClick={() => { setSendFrom(w); setSendDest('principal'); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0F172A] text-white hover:bg-[#152e52]">
          <Send size={12} /> Enviar
        </button>
        <button onClick={() => { setRenaming(w); setRenameVal(w.name); }} title="Renombrar" className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil size={13} /></button>
        <button onClick={() => updateWallet(w.id, { archived: true }, 'Wallet archivada')} disabled={busy} title="Archivar" className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Archive size={13} /></button>
      </div>
    </div>
  );

  return (
    <div className="pt-6 space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-2 text-slate-700 hover:text-slate-900 font-bold text-sm"><ArrowLeft size={18} /> Volver</button>
          <h2 className="text-xl font-bold text-[#0F172A] flex items-center gap-2"><Wallet size={20} className="text-[#2DD4BF]" /> Wallets GasFree</h2>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50" title="Refrescar"><RefreshCw size={14} className={loading ? 'animate-spin text-[#0F172A]' : 'text-[#0F172A]'} /></button>
      </div>
      <p className="text-xs text-slate-700 font-semibold -mt-2">Crea y organiza varias wallets USDT (TRON) en un solo lugar — ideal para estudios y negocios. Para convertir en OTC, mueve los fondos a tu <b>wallet principal</b>.</p>

      {loading && !principal ? (
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="relative w-12 h-12"><div className="absolute inset-0 rounded-full border-4 border-slate-100" /><div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[#2DD4BF] animate-spin" /></div>
          <p className="text-sm font-extrabold text-slate-800">Cargando tus wallets…</p>
        </div>
      ) : (
        <>
          {/* La wallet principal (OTC) NO se muestra aquí — vive en el inicio.
              Aquí solo van las wallets adicionales del negocio. */}
          {/* Activas + crear */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">Mis wallets{active.length ? ` · ${active.length}` : ''}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {active.map((w) => <WalletCard key={w.id} w={w} />)}
              <button onClick={() => setCreateOpen(true)} className="rounded-2xl border-2 border-dashed border-slate-200 hover:border-[#2DD4BF] hover:bg-teal-50/40 p-4 flex flex-col items-center justify-center gap-2 text-slate-700 hover:text-[#0D9488] min-h-[140px] transition-colors font-bold">
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><Plus size={20} /></div>
                <span className="text-sm font-bold">Crear wallet</span>
              </button>
            </div>
          </div>

          {/* Archivadas */}
          {archived.length > 0 && (
            <div>
              <button onClick={() => setShowArchived((s) => !s)} className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">
                Archivadas · {archived.length} {showArchived ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {showArchived && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {archived.map((w) => (
                    <div key={w.id} className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-extrabold uppercase text-white bg-slate-600 px-1.5 py-0.5 rounded">Archivada</span>
                        <p className="font-bold text-sm text-slate-800 truncate">{w.name}</p>
                      </div>
                      <p className="text-[11px] font-mono text-slate-700 mt-1">{shortAddr(w.address)}</p>
                      <p className="text-lg font-black mt-2 text-[#0F172A]">{w.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-[#2DD4BF]">USDT</span></p>
                      <button onClick={() => updateWallet(w.id, { archived: false }, 'Wallet restaurada')} disabled={busy} className="mt-3 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 text-slate-700 hover:bg-white">
                        <ArchiveRestore size={12} /> Desarchivar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-700 text-center pt-2 font-semibold">Las wallets no se pueden eliminar — solo archivar, para no perder fondos que hayan llegado a esa dirección.</p>
        </>
      )}

      {/* Modal crear */}
      {createOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setCreateOpen(false)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-extrabold text-[#0F172A] text-lg">Crear wallet</h3><button onClick={() => setCreateOpen(false)}><X size={20} className="text-slate-400" /></button></div>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre (ej. Modelo Ana, Caja 2…)" maxLength={40} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]" />
            <button onClick={createWallet} disabled={busy || !newName.trim()} className="w-full h-11 bg-[#2DD4BF] hover:bg-[#5EEAD4] rounded-xl text-sm font-extrabold text-[#0F172A] disabled:opacity-60">{busy ? 'Creando…' : 'Crear wallet'}</button>
          </div>
        </div>
      )}

      {/* Modal renombrar */}
      {renaming && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setRenaming(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-extrabold text-[#0F172A] text-lg">Renombrar wallet</h3><button onClick={() => setRenaming(null)}><X size={20} className="text-slate-400" /></button></div>
            <input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} maxLength={40} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]" />
            <button onClick={doRename} disabled={busy || !renameVal.trim()} className="w-full h-11 bg-[#0F172A] hover:bg-[#152e52] rounded-xl text-sm font-extrabold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {/* Modal cargar (recibir) */}
      {depositWallet && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setDepositWallet(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-[#0F172A] text-lg">Cargar · {depositWallet.name}</h3>
              <button onClick={() => setDepositWallet(null)}><X size={20} className="text-slate-400" /></button>
            </div>
            <p className="text-sm text-slate-600">Envía <b>USDT por la red TRON (TRC-20)</b> a esta dirección. El saldo se refleja al confirmarse en la red.</p>
            <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 flex flex-col items-center gap-3">
              {depositWallet.address && (
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(depositWallet.address)}&color=0B1B32&margin=8`} alt="QR" className="w-44 h-44 rounded-lg bg-white p-1" />
              )}
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Dirección USDT (TRC-20)</p>
              <p className="font-mono text-xs break-all text-[#0F172A] text-center">{depositWallet.address}</p>
              <button onClick={() => { copy(depositWallet.address); showToast('Dirección copiada'); }} className="text-[#0D9488] font-bold text-sm flex items-center gap-1">
                {copied === depositWallet.address ? <Check size={14} /> : <Copy size={14} />} Copiar dirección
              </button>
            </div>
            <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">⚠️ Envía únicamente <b>USDT · TRON (TRC-20)</b>. Otra moneda u otra red puede perder los fondos.</div>
          </div>
        </div>
      )}

      {/* Modal enviar */}
      {sendFrom && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => setSendFrom(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-extrabold text-[#0F172A] text-lg">Enviar USDT</h3><button onClick={() => setSendFrom(null)}><X size={20} className="text-slate-400" /></button></div>
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
              <p className="text-[10px] uppercase font-bold text-slate-400">Desde</p>
              <p className="text-sm font-bold text-slate-800">{sendFrom.name}</p>
              <p className="text-[11px] text-slate-400">Saldo: {sendFrom.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</p>
            </div>
            {/* Destino */}
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">Enviar a</p>
              <div className="space-y-2">
                {principal && sendFrom.id !== 'principal' && (
                  <button onClick={() => setSendDest('principal')} className={`w-full text-left rounded-xl border p-3 flex items-center gap-2 ${sendDest === 'principal' ? 'border-[#2DD4BF] bg-teal-50' : 'border-slate-200'}`}>
                    <Star size={15} className="text-[#2DD4BF]" fill="#2DD4BF" />
                    <div className="min-w-0"><p className="text-sm font-bold text-slate-800">Mi wallet principal (OTC)</p><p className="text-[11px] font-mono text-slate-400 truncate">{shortAddr(principal.address)}</p></div>
                  </button>
                )}
                <button onClick={() => setSendDest('other')} className={`w-full text-left rounded-xl border p-3 ${sendDest === 'other' ? 'border-[#2DD4BF] bg-teal-50' : 'border-slate-200'}`}>
                  <p className="text-sm font-bold text-slate-800">Otra dirección / cuenta</p>
                  <p className="text-[11px] text-slate-400">Envía a otra wallet TRON (TRC-20)</p>
                </button>
                {sendDest === 'other' && (
                  <input value={sendAddr} onChange={(e) => setSendAddr(e.target.value)} placeholder="Dirección USDT (TRC-20)" className="w-full px-3 py-2.5 text-xs font-mono border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]" />
                )}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">Monto (USDT)</p>
              <input value={sendAmount} onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2DD4BF]" />
              <p className="text-[10px] text-slate-400 mt-1">La comisión de red GasFree se cobra aparte (en USDT).</p>
            </div>
            <button onClick={runSend} disabled={sending} className="w-full h-11 bg-[#2DD4BF] hover:bg-[#5EEAD4] rounded-xl text-sm font-extrabold text-[#0F172A] disabled:opacity-60 flex items-center justify-center gap-2">
              {sending ? 'Enviando…' : <><Send size={15} /> Enviar</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
