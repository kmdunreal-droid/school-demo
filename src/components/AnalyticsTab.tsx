/**
 * ANALYTICS TAB — Principal portal.
 * Charts (attendance/fees/marks), top performers, at-risk students,
 * AI remarks (Gemini free). Recharts + existing data props.
 */
import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  BarChart2, Loader2, Copy, AlertTriangle, Trophy, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import type { Student, Class, Attendance, Mark, FeeRecord, UserSession } from '../types';
import { aiGenerateRemark, isAiEnabled } from '../lib/gemini';

interface AnalyticsTabProps {
  userSession: UserSession;
  students: Student[];
  classes: Class[];
  attendance: Attendance[];
  marks: Mark[];
  fees: FeeRecord[];
}

export default function AnalyticsTab({ students, classes, attendance, marks, fees }: AnalyticsTabProps) {
  const aiOn = isAiEnabled();

  // ---- Attendance trend (last 6 weeks, weekly %) ----
  const attendanceTrend = useMemo(() => {
    const weeks: { name: string; pct: number }[] = [];
    const now = new Date();
    for (let w = 5; w >= 0; w--) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (w + 1) * 7 + 1);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - w * 7);
      const sStr = start.toISOString().split('T')[0];
      const eStr = end.toISOString().split('T')[0];
      const inRange = attendance.filter(a => a.date >= sStr && a.date <= eStr);
      const present = inRange.filter(a => a.status === 'present' || a.status === 'late').length;
      weeks.push({ name: `W${6 - w}`, pct: inRange.length > 0 ? Math.round((present / inRange.length) * 100) : 0 });
    }
    return weeks;
  }, [attendance]);

  // ---- Fee collection (last 6 months, paid sum) ----
  const feeTrend = useMemo(() => {
    const months: { name: string; paid: number }[] = [];
    const now = new Date();
    for (let m = 5; m >= 0; m--) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const monthName = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const paid = fees
        .filter(f => f.status === 'paid' && f.month === monthName)
        .reduce((a, f) => a + (Number(f.amount) || 0), 0);
      months.push({ name: d.toLocaleString('en-US', { month: 'short' }), paid: Math.round(paid) });
    }
    return months;
  }, [fees]);

  // ---- Per-student aggregates (marks avg + attendance 30d + at-risk) ----
  const studentStats = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cStr = cutoff.toISOString().split('T')[0];

    return students.map(s => {
      const myMarks = marks.filter(m => String(m.studentId) === String(s.id) && m.maxMarks > 0);
      const avgPct = myMarks.length > 0
        ? Math.round(myMarks.reduce((a, m) => a + (m.marksObtained / m.maxMarks) * 100, 0) / myMarks.length)
        : null;

      const att30 = attendance.filter(a => String(a.studentId) === String(s.id) && a.date >= cStr);
      const attPct = att30.length > 0
        ? Math.round(att30.filter(a => a.status === 'present' || a.status === 'late').length / att30.length * 100)
        : null;

      const bySubject: Record<string, { sum: number; n: number }> = {};
      myMarks.forEach(m => {
        if (!bySubject[m.subject]) bySubject[m.subject] = { sum: 0, n: 0 };
        bySubject[m.subject].sum += (m.marksObtained / m.maxMarks) * 100;
        bySubject[m.subject].n += 1;
      });
      const subjectsRanked = Object.entries(bySubject)
        .map(([subject, v]) => ({ subject, pct: Math.round(v.sum / v.n) }))
        .sort((a, b) => b.pct - a.pct);

      const cls = classes.find(c => String(c.id) === String(s.classId));
      return {
        student: s,
        className: cls ? `${cls.className} ${cls.section}` : '-',
        avgPct,
        attPct,
        best: subjectsRanked[0],
        worst: subjectsRanked.length > 1 ? subjectsRanked[subjectsRanked.length - 1] : undefined,
        atRisk: (attPct !== null && attPct < 75) || (avgPct !== null && avgPct < 40),
      };
    });
  }, [students, classes, marks, attendance]);

  const classAvg = useMemo(() => {
    return classes.map(c => {
      const inClass = studentStats.filter(s => String(s.student.classId) === String(c.id) && s.avgPct !== null);
      const avg = inClass.length > 0 ? Math.round(inClass.reduce((a, s) => a + (s.avgPct || 0), 0) / inClass.length) : 0;
      return { name: `${c.className} ${c.section}`, avg };
    });
  }, [classes, studentStats]);

  const topPerformers = useMemo(
    () => studentStats.filter(s => s.avgPct !== null).sort((a, b) => (b.avgPct || 0) - (a.avgPct || 0)).slice(0, 5),
    [studentStats]
  );
  const atRiskList = useMemo(
    () => studentStats.filter(s => s.atRisk).sort((a, b) => (a.attPct ?? 100) - (b.attPct ?? 100)).slice(0, 8),
    [studentStats]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <Header aiOn={aiOn} />
      {/* ===== CHARTS ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3">📈 Attendance Trend (6 weeks)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={attendanceTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
              <Tooltip formatter={(v: any) => [`${v}%`, 'Present']} />
              <Line type="monotone" dataKey="pct" stroke="#0d9488" strokeWidth={3} dot={{ r: 4, fill: '#0d9488' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3">💰 Fee Collection (6 months, PKR)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={feeTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip formatter={(v: any) => [`PKR ${Number(v).toLocaleString()}`, 'Collected']} />
              <Bar dataKey="paid" fill="#d97706" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm lg:col-span-2">
          <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3">🎓 Class Average Marks (%)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={classAvg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
              <Tooltip />
              <Bar dataKey="avg" radius={[6, 6, 0, 0]}>
                {classAvg.map((c, i) => <Cell key={i} fill={c.avg >= 60 ? '#0d9488' : c.avg >= 40 ? '#d97706' : '#e11d48'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ===== RANKINGS + AT-RISK ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Trophy size={14} className="text-amber-600" /> Top Performers</h3>
          <div className="space-y-2">
            {topPerformers.length === 0 && <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest py-4 text-center">Marks data nahi hai</p>}
            {topPerformers.map((s, i) => (
              <div key={s.student.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <span className="text-sm w-8 text-center">{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800 truncate">{s.student.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.className}</p>
                </div>
                <span className={`text-sm font-black ${s.avgPct! >= 60 ? 'text-teal-600' : s.avgPct! >= 40 ? 'text-amber-600' : 'text-rose-600'}`}>{s.avgPct}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border-2 border-rose-100 rounded-2xl p-4 shadow-sm">
          <h3 className="text-xs font-black text-rose-600 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <AlertTriangle size={14} /> At-Risk Students ({atRiskList.length})
            <span className="text-[9px] font-bold text-slate-400 normal-case">attendance &lt;75% ya marks &lt;40%</span>
          </h3>
          <div className="space-y-2">
            {atRiskList.length === 0 && <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest py-4 text-center">Sab students theek hain ✅</p>}
            {atRiskList.map(s => (
              <motion.div key={s.student.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 p-2.5 rounded-xl bg-rose-50/60 border border-rose-100">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800 truncate">{s.student.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{s.className} · {s.student.parentPhone || 'phone nahi'}</p>
                </div>
                {s.attPct !== null && <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${s.attPct < 75 ? 'bg-rose-100 text-rose-700' : 'bg-teal-100 text-teal-700'}`}>Att {s.attPct}%</span>}
                {s.avgPct !== null && <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${s.avgPct < 40 ? 'bg-rose-100 text-rose-700' : 'bg-teal-100 text-teal-700'}`}>Marks {s.avgPct}%</span>}
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== AI REMARKS (Gemini) ===== */}
      <AiRemarks aiOn={aiOn} stats={studentStats} />
    </div>
  );
}

function AiRemarks({ aiOn, stats }: { aiOn: boolean; stats: any[] }) {
  const withData = stats.filter(s => s.avgPct !== null || s.attPct !== null);
  const [selectedId, setSelectedId] = useState('');
  const [tone, setTone] = useState<'formal' | 'motivational' | 'concise'>('formal');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const selected = withData.find(s => String(s.student.id) === selectedId);

  const generate = async () => {
    if (!selected) { toast.error('Pehle student select karein'); return; }
    setLoading(true);
    setRemark('');
    try {
      const text = await aiGenerateRemark({
        studentName: selected.student.name,
        className: selected.className,
        attendancePct: selected.attPct ?? 100,
        avgPct: selected.avgPct ?? 0,
        bestSubject: selected.best?.subject,
        weakSubject: selected.worst?.subject,
        tone,
      });
      setRemark(text);
      toast.success('AI remark ready! 🤖');
    } catch (e: any) {
      toast.error(e?.message || 'AI fail hui');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border-2 border-indigo-100 rounded-2xl p-5 shadow-sm space-y-3">
      <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
        <Sparkles size={15} className="text-indigo-600" /> AI Report-Card Remarks
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${aiOn ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-500'}`}>
          {aiOn ? 'Gemini Free' : 'API key nahi'}
        </span>
      </h3>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold min-w-[200px]">
          <option value="">Student select karein...</option>
          {withData.map(s => <option key={s.student.id} value={s.student.id}>{s.student.name} ({s.className})</option>)}
        </select>
        <select value={tone} onChange={e => setTone(e.target.value as any)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest">
          <option value="formal">Formal</option>
          <option value="motivational">Motivational</option>
          <option value="concise">Concise</option>
        </select>
        <button
          onClick={generate}
          disabled={!aiOn || loading || !selectedId}
          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {loading ? 'AI likh raha hai...' : 'Generate Remark'}
        </button>
      </div>
      {remark && (
        <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3">
          <textarea
            value={remark}
            onChange={e => setRemark(e.target.value)}
            rows={3}
            className="w-full bg-transparent text-sm text-slate-700 leading-relaxed focus:outline-none resize-none"
          />
          <button
            onClick={() => { navigator.clipboard.writeText(remark); toast.success('Copy ho gaya!'); }}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-600 flex items-center gap-1.5"
          >
            <Copy size={11} /> Copy
          </button>
        </div>
      )}
      {!aiOn && (
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          💡 Free key: aistudio.google.com → Settings → "AI API Key" mein paste karein
        </p>
      )}
    </div>
  );
}

function Header({ aiOn }: { aiOn: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
          <BarChart2 size={22} className="text-teal-600" /> Analytics & Insights
        </h1>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Attendance · Fees · Performance · At-Risk Alerts</p>
      </div>
      <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest w-fit ${aiOn ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-500'}`}>
        {aiOn ? '🤖 AI remarks Ready' : 'AI Off (API key nahi)'}
      </span>
    </div>
  );
}
