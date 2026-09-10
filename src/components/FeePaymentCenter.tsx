import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { X, Search, CheckCircle2, CreditCard, Receipt, AlertCircle, ChevronLeft, ChevronDown, Wallet, ArrowRight, CalendarDays, BadgeCheck, Banknote } from 'lucide-react';
import { StudentFeeData, Student } from '../types';
import { MONTHS, getDueRemaining, getDuePaid } from '../lib/feeEngine';

// ===== Month parsing helpers (mirror of PrincipalDashboard's parseMonthKey) =====
export const MONTH_ALIAS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};

export const parseMonthKey = (raw: unknown, fallbackYear: number): { idx: number; year: number } => {
  const s = String(raw ?? '').trim();
  const m = s.match(/^([A-Za-z]+)\s*,?\s*(\d{4})?$/);
  if (!m) return { idx: -1, year: fallbackYear };
  const idx = MONTH_ALIAS[m[1].toLowerCase()];
  return { idx: idx === undefined ? -1 : idx, year: m[2] ? Number(m[2]) : fallbackYear };
};

const TUITION_FEE_TYPES = /^(tuition|school|monthly)\s*(nsb\s*)?fee$/i;
const isTuitionFeeType = (t: string) => TUITION_FEE_TYPES.test(String(t || '').trim()) || /school\s*(nsb\s*)?fee/i.test(String(t || ''));

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'JazzCash', 'EasyPaisa', 'Online'];

export interface FeePaymentCenterProps {
  open: boolean;
  onClose: () => void;
  feeStudents: StudentFeeData[];
  students: Student[];
  initialStudentId?: string;
  onPayMonth: (studentId: string | number, month: string, year: number, amount: number, method: string) => void;
  onCollectDue: (studentId: string | number, dueId: string, amount: number, method: string) => void;
  onPayAutoSpread: (studentId: string | number, amount: number, method: string) => void;
}

/**
 * FEE PAYMENT CENTER - complete, month-wise fee & dues payment in one place.
 * Step 1: Student select karo (search + pending badges)
 * Step 2: Account view - Dues/Other Funds cards + Month-wise fee rows,
 *         har row pe Pay button -> inline amount+method panel -> confirm.
 */
export function FeePaymentCenter({ open, onClose, feeStudents, students, initialStudentId, onPayMonth, onCollectDue, onPayAutoSpread }: FeePaymentCenterProps) {
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [panel, setPanel] = useState<{ kind: 'month' | 'due' | 'all'; key: string; remaining: number } | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [showPaidDues, setShowPaidDues] = useState(false);

  // Open hote waqt reset + initial student select
  useEffect(() => {
    if (open) {
      const ok = initialStudentId && feeStudents.some(f => String(f.id) === String(initialStudentId));
      setSelectedId(ok ? String(initialStudentId) : '');
      setSearch('');
      setPanel(null);
      setAmount('');
      setMethod('Cash');
      setShowPaidDues(false);
      setYear(new Date().getFullYear());
    }
  }, [open, initialStudentId, feeStudents]);

  // Har student ke liye month-wise rows compute karo (enrollment month se start, current year)
  const computeRows = (f: StudentFeeData, yr: number) => {
    const prof = students.find(s => String(s.id) === String(f.id));
    const b = Math.max(0, Number(prof?.baseFee ?? f.monthlyFee ?? 0));
    const alias = String(f.enrollmentMonth || '').trim().toLowerCase();
    const ev = MONTH_ALIAS[alias];
    const eIdx = typeof ev === 'number' ? ev : -1;
    const nowY = new Date().getFullYear();
    const startIdx = Number(yr) === nowY && eIdx >= 0 ? eIdx : 0;
    return MONTHS.slice(startIdx).map(m => {
      const mi = MONTHS.indexOf(m);
      const monthPayments = (f.payments || []).filter(p => {
        const k = parseMonthKey(p.month, Number(p.year) || yr);
        return k.idx === mi && k.year === Number(yr);
      });
      const paid = monthPayments
        .filter(p => !p.feeType || isTuitionFeeType(p.feeType))
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const monthDues = (f.dues || []).filter(d => {
        const k = parseMonthKey(d.month, d.year || yr);
        return k.idx === mi && k.year === Number(yr) && d.status !== 'waived';
      });
      const duesPending = monthDues.reduce((s, d) => s + getDueRemaining(d), 0);
      const tuitionRemaining = Math.max(0, b - paid);
      return { m, base: b, paid, tuitionRemaining, duesPending, monthDues };
    });
  };

  // ===== Student list (Step 1) =====
  const listRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cy = new Date().getFullYear();
    const rows = feeStudents
      .filter(f => !q || String(f.name || '').toLowerCase().includes(q) || String(f.id).includes(q) || String(f.class || '').toLowerCase().includes(q))
      .map(f => {
        const r = computeRows(f, cy);
        const tuitionPending = r.reduce((s, x) => s + x.tuitionRemaining, 0);
        const duesPending = (f.dues || []).filter(d => d.status !== 'waived').reduce((s, d) => s + getDueRemaining(d), 0);
        return { f, tuitionPending, duesPending, total: tuitionPending + duesPending };
      });
    rows.sort((x, y) => y.total - x.total || String(x.f.name || '').localeCompare(String(y.f.name || '')));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeStudents, students, search]);

  // ===== Selected student data (Step 2) =====
  const fs = feeStudents.find(f => String(f.id) === String(selectedId));
  const monthRows = fs ? computeRows(fs, year) : [];
  const tuitionPendingTotal = monthRows.reduce((s, r) => s + r.tuitionRemaining, 0);
  const duesPendingTotal = fs ? (fs.dues || []).filter(d => d.status !== 'waived').reduce((s, d) => s + getDueRemaining(d), 0) : 0;
  const paidTotal = fs ? (fs.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0;
  const grandPayable = tuitionPendingTotal + duesPendingTotal;

  const pendingDues = fs
    ? (fs.dues || [])
        .filter(d => d.status !== 'waived' && getDueRemaining(d) > 0)
        .sort((a, b) => {
          const ka = parseMonthKey(a.month, a.year || year);
          const kb = parseMonthKey(b.month, b.year || year);
          return (ka.idx < 0 ? 99 : ka.idx) - (kb.idx < 0 ? 99 : kb.idx);
        })
    : [];
  const paidDues = fs ? (fs.dues || []).filter(d => d.status !== 'waived' && getDueRemaining(d) === 0) : [];
  const recentPayments = fs ? [...(fs.payments || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 8) : [];

  // ===== Pay panel helpers =====
  const openMonthPanel = (m: string, remaining: number) => {
    setPanel({ kind: 'month', key: `${m} ${year}`, remaining });
    setAmount(String(remaining));
    setMethod('Cash');
  };
  const openDuePanel = (d: { id: string }) => {
    const due = (fs?.dues || []).find(x => x.id === d.id);
    if (!due) return;
    const rem = getDueRemaining(due);
    if (!(rem > 0)) { toast.info('Yeh due already paid hai.'); return; }
    setPanel({ kind: 'due', key: due.id, remaining: rem });
    setAmount(String(rem));
    setMethod('Cash');
  };
  const openAllPanel = () => {
    if (!(tuitionPendingTotal > 0)) { toast.info('No tuition pending — all clear'); return; }
    setPanel({ kind: 'all', key: 'all', remaining: tuitionPendingTotal });
    setAmount(String(tuitionPendingTotal));
    setMethod('Cash');
  };

  const confirmPay = () => {
    const amt = Number(amount) || 0;
    if (!(amt > 0)) { toast.error('Sahi amount enter karein (PKR).'); return; }
    if (!selectedId || !panel) return;
    if (panel.kind === 'month') onPayMonth(selectedId, panel.key, year, amt, method);
    else if (panel.kind === 'due') onCollectDue(selectedId, panel.key, amt, method);
    else onPayAutoSpread(selectedId, amt, method);
    setPanel(null);
    setAmount('');
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-slate-950/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[94vh] flex flex-col"
          >
            {/* ===== Header ===== */}
            <div className="bg-amber-600 p-4 sm:p-5 text-white flex justify-between items-center gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <CreditCard size={22} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-black uppercase tracking-tight">Fee Payment Center</h2>
                  <p className="text-[10px] uppercase font-bold text-amber-100 truncate">
                    {fs ? `${fs.name} - ${fs.class} - ${year}` : 'Month-wise Fee - Paper Fund - Other Funds - Dues'}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-full transition-colors shrink-0">
                <X size={20} />
              </button>
            </div>

            {/* ===== Body ===== */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
              {!fs ? (
                /* ================= STEP 1 - STUDENT SELECT ================= */
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Search student by name, class or ID..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-amber-500 outline-none"
                      autoFocus
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                      {listRows.length} Students - jis student ki fee/dues pay karni hai us par click karein (pending wale upar)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {listRows.map(r => (
                        <button
                          key={String(r.f.id)}
                          onClick={() => { setSelectedId(String(r.f.id)); setPanel(null); }}
                          className="text-left p-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50/40 transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-black text-slate-900 truncate">{r.f.name}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                {r.f.class} - Fee: PKR {Number(r.f.monthlyFee || 0).toLocaleString()}/mo
                              </p>
                            </div>
                            <ArrowRight size={14} className="text-slate-300 shrink-0" />
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {r.tuitionPending > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[9px] font-black uppercase tracking-wide">Tuition: {r.tuitionPending.toLocaleString()}</span>
                            )}
                            {r.duesPending > 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-wide">Dues: {r.duesPending.toLocaleString()}</span>
                            )}
                            {r.tuitionPending === 0 && r.duesPending === 0 && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-wide">All Clear</span>
                            )}
                          </div>
                        </button>
                      ))}
                      {listRows.length === 0 && (
                        <p className="col-span-full text-center text-xs font-bold text-slate-400 py-8">Koi student match nahi hua.</p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                /* ================= STEP 2 - ACCOUNT VIEW ================= */
                <>
                  {/* Summary strip */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-100">
                      <span className="block text-[9px] font-black text-teal-400 uppercase tracking-widest">Total Paid</span>
                      <span className="block text-sm font-black text-teal-700">PKR {paidTotal.toLocaleString()}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-50/70 border border-rose-100">
                      <span className="block text-[9px] font-black text-rose-400 uppercase tracking-widest">Tuition Remaining</span>
                      <span className="block text-sm font-black text-rose-600">{tuitionPendingTotal > 0 ? `PKR ${tuitionPendingTotal.toLocaleString()}` : 'Clear'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-100">
                      <span className="block text-[9px] font-black text-amber-500 uppercase tracking-widest">Dues / Funds Pending</span>
                      <span className="block text-sm font-black text-amber-700">{duesPendingTotal > 0 ? `PKR ${duesPendingTotal.toLocaleString()}` : 'Clear'}</span>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Grand Payable</span>
                      <span className="block text-sm font-black text-slate-900">PKR {grandPayable.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* ===== SECTION 1 - DUES AND OTHER FUNDS (Paper Fund etc.) ===== */}
                  <div>
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <AlertCircle size={12} className="text-amber-500" /> Dues and Other Funds - Paper Fund, Exam Fee, Summer Pack etc.
                      </h4>
                      {paidDues.length > 0 && (
                        <button onClick={() => setShowPaidDues(v => !v)} className="text-[9px] font-black text-amber-600 uppercase tracking-widest hover:underline cursor-pointer flex items-center gap-1">
                          <ChevronDown size={10} className={showPaidDues ? 'rotate-180' : ''} /> Paid ({paidDues.length})
                        </button>
                      )}
                    </div>
                    {pendingDues.length > 0 ? (
                      <div className="space-y-2">
                        {pendingDues.map(d => {
                          const rem = getDueRemaining(d);
                          const pd = getDuePaid(d);
                          return (
                            <div key={d.id} className="p-3 rounded-xl border border-amber-100 bg-amber-50/50">
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="min-w-0">
                                  <p className="text-sm font-black text-slate-900 flex items-center gap-2 flex-wrap">
                                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest">{d.desc}</span>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{d.month} {d.year}</span>
                                  </p>
                                  <p className="text-[10px] font-bold text-slate-400 mt-1">
                                    Total: PKR {Number(d.amount || 0).toLocaleString()}
                                    {pd > 0 && <> - Paid: <span className="text-amber-600 font-black">PKR {pd.toLocaleString()}</span></>}
                                    {' '}- Remaining: <span className="text-rose-600 font-black">PKR {rem.toLocaleString()}</span>
                                  </p>
                                </div>
                                <button
                                  onClick={() => openDuePanel(d)}
                                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                                >
                                  <Banknote size={13} /> Pay Now
                                </button>
                              </div>
                              {panel?.kind === 'due' && panel.key === d.id && (
                                <PayPanel
                                  amount={amount} setAmount={setAmount} method={method} setMethod={setMethod}
                                  remaining={panel.remaining} onConfirm={confirmPay}
                                  onCancel={() => { setPanel(null); setAmount(''); }}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl border border-amber-100 bg-amber-50/50 flex items-center gap-2">
                        <BadgeCheck size={16} className="text-amber-600" />
                        <span className="text-xs font-black text-amber-700 uppercase tracking-wide">Koi pending due nahi - sab clear</span>
                      </div>
                    )}
                    {showPaidDues && paidDues.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {paidDues.map(d => (
                          <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{d.desc} - {d.month} {d.year}</span>
                            <span className="text-[10px] font-black text-amber-600">PAID - PKR {Number(d.amount || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ===== SECTION 2 - MONTH-WISE FEE ===== */}
                  <div>
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setYear(y => y - 1)} className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-md text-xs font-black text-slate-500 hover:border-amber-400 hover:text-amber-600 transition-colors cursor-pointer">&#8249;</button>
                        <span className="text-xs font-black text-amber-600 uppercase">{year}</span>
                        <button onClick={() => setYear(y => y + 1)} className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-md text-xs font-black text-slate-500 hover:border-amber-400 hover:text-amber-600 transition-colors cursor-pointer">&#8250;</button>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                          <CalendarDays size={12} className="text-amber-500" /> Month-wise Fee - Base / Paid / Remaining
                        </h4>
                      </div>
                      {tuitionPendingTotal > 0 && (
                        <button onClick={openAllPanel} className="px-3 py-1.5 bg-slate-900 hover:bg-slate-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-1.5 cursor-pointer">
                          <Wallet size={11} /> Pay All Remaining (Auto-Spread)
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      {monthRows.map(r => (
                        <div key={r.m} className={`p-2.5 rounded-xl border ${r.tuitionRemaining === 0 && r.duesPending === 0 ? 'bg-amber-50/50 border-amber-100' : 'bg-white border-slate-200'}`}>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="w-11 text-[11px] font-black text-slate-700 uppercase shrink-0">{r.m}</span>
                              <div className="text-[9px] font-bold text-slate-400 uppercase leading-tight">
                                <span>Base: PKR {r.base.toLocaleString()} - Paid: <span className="text-amber-600 font-black">PKR {r.paid.toLocaleString()}</span></span>
                                {r.tuitionRemaining > 0 && <span className="block">Remaining: <span className="text-rose-600 font-black">PKR {r.tuitionRemaining.toLocaleString()}</span></span>}
                                {r.duesPending > 0 && <span className="block">Dues (Pending): <span className="text-amber-600 font-black">PKR {r.duesPending.toLocaleString()}</span></span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {r.tuitionRemaining === 0 && r.duesPending === 0 ? (
                                <span className="px-2 py-1 rounded-lg bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest flex items-center gap-1"><CheckCircle2 size={10} /> Clear</span>
                              ) : (
                                <button
                                  onClick={() => openMonthPanel(r.m, r.tuitionRemaining)}
                                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                                >
                                  <Banknote size={11} /> {r.tuitionRemaining > 0 ? 'Pay' : 'Advance'}
                                </button>
                              )}
                            </div>
                          </div>
                          {panel?.kind === 'month' && panel.key === `${r.m} ${year}` && (
                            <PayPanel
                              amount={amount} setAmount={setAmount} method={method} setMethod={setMethod}
                              remaining={panel.remaining} onConfirm={confirmPay}
                              onCancel={() => { setPanel(null); setAmount(''); }}
                            />
                          )}
                        </div>
                      ))}
                      {monthRows.length === 0 && (
                        <p className="text-center text-xs font-bold text-slate-400 py-4">Is year ke liye koi month data nahi.</p>
                      )}
                    </div>
                    {panel?.kind === 'all' && (
                      <div className="mt-2">
                        <PayPanel
                          amount={amount} setAmount={setAmount} method={method} setMethod={setMethod}
                          remaining={panel.remaining} onConfirm={confirmPay}
                          onCancel={() => { setPanel(null); setAmount(''); }}
                          note="Yeh amount purane pending months (oldest first) mein khud spread ho jayega."
                        />
                      </div>
                    )}
                  </div>

                  {/* ===== SECTION 3 - RECENT RECEIPTS ===== */}
                  {recentPayments.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Receipt size={12} className="text-teal-500" /> Recent Payments
                      </h4>
                      <div className="space-y-1.5">
                        {recentPayments.map(p => (
                          <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
                            <div className="min-w-0">
                              <span className="text-[10px] font-black text-slate-700 uppercase tracking-wide">{p.feeType || 'School NSB Fee'}</span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase block">{p.month} {Number(p.year) || year} - {p.date}</span>
                            </div>
                            <span className="text-xs font-black text-amber-600 shrink-0">PKR {Number(p.amount || 0).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Back to list */}
                  <button
                    onClick={() => { setSelectedId(''); setPanel(null); setSearch(''); }}
                    className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ChevronLeft size={14} /> Doosre Student Ki Fee Pay Karein
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ===== Inline payment panel (amount + method + confirm) =====
function PayPanel({ amount, setAmount, method, setMethod, remaining, onConfirm, onCancel, note }: {
  amount: string;
  setAmount: (v: string) => void;
  method: string;
  setMethod: (v: string) => void;
  remaining: number;
  onConfirm: () => void;
  onCancel: () => void;
  note?: string;
}) {
  return (
    <div className="mt-2 p-3 sm:p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
          {remaining > 0 ? `Remaining: PKR ${remaining.toLocaleString()}` : 'Advance / Extra Amount'}
        </span>
        {remaining > 0 && (
          <button onClick={() => setAmount(String(remaining))} className="text-[9px] font-black text-amber-600 uppercase tracking-widest hover:underline cursor-pointer">
            Full Remaining (PKR {remaining.toLocaleString()})
          </button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="number"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (PKR)"
          className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-900 focus:outline-none focus:border-amber-500"
          autoFocus
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 focus:outline-none focus:border-amber-500 appearance-none cursor-pointer"
        >
          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={onConfirm} className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer">
          <CheckCircle2 size={14} /> Confirm Payment
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer">
          Cancel
        </button>
      </div>
      {note && <p className="text-[9px] font-bold text-slate-400">{note}</p>}
    </div>
  );
}
