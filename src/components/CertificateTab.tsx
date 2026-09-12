/**
 * CERTIFICATES & EXPORT — Principal portal.
 * Transfer/Character/Bonafide certificate (print A4) + CSV export.
 */
import { useState, useMemo } from 'react';
import { Printer, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import type { Student, Class, Attendance, FeeRecord, UserSession } from '../types';
import { downloadCsv } from '../lib/csvExport';

interface CertificateTabProps {
  userSession: UserSession;
  students: Student[];
  classes: Class[];
  attendance: Attendance[];
  fees: FeeRecord[];
}

type CertType = 'tc' | 'character' | 'bonafide';

const CERT_LABELS: Record<CertType, string> = {
  tc: 'Transfer Certificate',
  character: 'Character Certificate',
  bonafide: 'Bonafide Certificate',
};

export default function CertificateTab({ students, classes, attendance, fees }: CertificateTabProps) {
  const [studentId, setStudentId] = useState('');
  const [type, setType] = useState<CertType>('tc');
  const [remarks, setRemarks] = useState('');

  const cls = (s: Student) => classes.find(c => String(c.id) === String(s.classId));
  const student = students.find(s => String(s.id) === studentId);
  const classObj = student ? cls(student) : undefined;

  const studentStats = useMemo(() => {
    if (!student) return null;
    const myAtt = attendance.filter(a => String(a.studentId) === String(student.id));
    const present = myAtt.filter(a => a.status === 'present' || a.status === 'late').length;
    const attPct = myAtt.length > 0 ? Math.round((present / myAtt.length) * 100) : 0;
    return { attPct, attDays: myAtt.length };
  }, [student, attendance, fees]);

  const printCertificate = () => {
    if (!student || !studentStats) { toast.error('Pehle student select karein'); return; }
    const today = new Date().toLocaleDateString('en-GB');
    const label = CERT_LABELS[type];
    const classText = classObj ? `${classObj.className} ${classObj.section}` : '______';
    const body = type === 'tc'
      ? `This is to certify that <b>${student.name}</b>, son/daughter of <b>${student.guardianName || '______'}</b>, was a bona fide student of this institution studying in <b>Class ${classText}</b> (Roll No. ${student.rollNumber}). During his/her stay at this school, his/her conduct and character were <b>good/exemplary</b>. All dues have been cleared and the school leaving record is complete.<br/><br/>His/her general attendance was <b>${studentStats.attPct}%</b>. We wish him/her success in future academic pursuits.`
      : type === 'character'
        ? `This is to certify that <b>${student.name}</b> (Roll No. ${student.rollNumber}, Class ${classText}) is a student of this institution. During the period of his/her study here, his/her conduct and character have been <b>excellent/satisfactory</b>. He/She bears a good moral character.${remarks ? `<br/><br/>Remarks: ${remarks}` : ''}`
        : `This is to certify that <b>${student.name}</b>, son/daughter of <b>${student.guardianName || '______'}</b>, is a bonafide student of <b>Demo School &amp; Academy</b>, currently studying in <b>Class ${classText}</b> (Roll No. ${student.rollNumber}). This certificate is issued on his/her request for official purposes.`;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${label} — ${student.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 0; padding: 40px; }
  .cert { border: 3px double #111; padding: 48px 40px; max-width: 760px; margin: 0 auto; }
  .head { text-align: center; }
  .head img { height: 72px; margin-bottom: 6px; }
  .school { font-size: 22px; font-weight: bold; letter-spacing: 4px; text-transform: uppercase; }
  .sub { font-size: 12px; letter-spacing: 2px; color: #555; text-transform: uppercase; margin-top: 2px; }
  h1 { text-align: center; font-size: 26px; letter-spacing: 6px; margin: 28px 0 6px; text-transform: uppercase; }
  .line { width: 80px; height: 3px; background: #0d9488; margin: 0 auto 24px; }
  .body { font-size: 15px; line-height: 1.9; text-align: justify; }
  .footer { display: flex; justify-content: space-between; margin-top: 56px; font-size: 13px; }
  .sig { border-top: 1px solid #111; padding-top: 4px; text-align: center; min-width: 160px; font-weight: bold; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="cert">
  <div class="head">
    <img src="/logo.png" alt="logo" style="height:70px" onerror="this.style.display='none'" />
    <div class="school">Demo School &amp; Academy</div>
    <div class="sub">Saddar Campus · Karachi</div>
  </div>
  <h1>${label}</h1>
  <div class="line"></div>
  <div class="body">${body}</div>
  <div class="footer">
    <div>Date: <b>${today}</b></div>
    <div class="sig">Principal<br/>Demo School &amp; Academy</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Popup block hai — allow karein'); return; }
    w.document.write(html);
    w.document.close();
    toast.success('Certificate print window khul gaya!');
  };

  const exportStudents = () => {
    downloadCsv('students.csv', students.map(s => {
      const c = cls(s);
      return {
        Name: s.name, Roll: s.rollNumber, Class: c ? `${c.className} ${c.section}` : '',
        ParentPhone: s.parentPhone, BaseFee: s.baseFee ?? '', Enrollment: s.enrollmentMonth ?? '',
      };
    }));
    toast.success('Students CSV download ho gayi!');
  };
  const exportFees = () => {
    downloadCsv('fees.csv', fees.map(f => ({
      Student: students.find(s => String(s.id) === String(f.studentId))?.name || f.studentId,
      Month: f.month, Amount: f.amount, Status: f.status, PaidDate: f.paidDate || '', Method: f.paymentMethod || '', Type: f.feeType || '',
    })));
    toast.success('Fees CSV download ho gaya!');
  };
  const exportAttendance = () => {
    downloadCsv('attendance.csv', attendance.map(a => ({
      Student: students.find(s => String(s.id) === String(a.studentId))?.name || a.studentId,
      Date: a.date, Status: a.status, MarkedBy: a.markedBy || '',
    })));
    toast.success('Attendance CSV download ho gaya!');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
          🏅 Certificates & Export
        </h1>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Print-ready certificates · CSV data export</p>
      </div>
      {/* Certificate Form */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Certificate Generator</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select value={studentId} onChange={e => setStudentId(e.target.value)} className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold">
            <option value="">Student select karein...</option>
            {students.map(s => {
              const c = cls(s);
              return <option key={s.id} value={s.id}>{s.name} — {c ? `${c.className} ${c.section}` : 'No Class'}</option>;
            })}
          </select>
          <select value={type} onChange={e => setType(e.target.value as CertType)} className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
            {Object.entries(CERT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button
            onClick={printCertificate}
            disabled={!student}
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-teal-200"
          >
            <Printer size={15} /> Print Certificate
          </button>
        </div>
        {type === 'character' && (
          <input
            value={remarks}
            onChange={e => setRemarks(e.target.value)}
            placeholder="Extra remarks (optional — Character Certificate ke liye)"
            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs"
          />
        )}
        {student && (
          <div className="flex flex-wrap gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-50 border border-slate-100 rounded-xl p-3">
            <span>👤 {student.name}</span>
            <span>🎫 Roll: {student.rollNumber}</span>
            <span>🏫 {classObj ? `${classObj.className} ${classObj.section}` : '—'}</span>
            {studentStats && <span>📊 Attendance: {studentStats.attPct}%</span>}
          </div>
        )}
      </div>

      {/* Export Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Students Export', desc: `${students.length} students`, onClick: exportStudents },
          { label: 'Fees Export', desc: `${fees.length} transactions`, onClick: exportFees },
          { label: 'Attendance Export', desc: `${attendance.length} records`, onClick: exportAttendance },
        ].map(c => (
          <button
            key={c.label}
            onClick={c.onClick}
            className="bg-white border border-slate-200 hover:border-teal-300 hover:shadow-lg rounded-2xl p-5 text-left transition-all group"
          >
            <FileSpreadsheet size={20} className="text-teal-600 mb-2" />
            <p className="text-xs font-black text-slate-800 uppercase tracking-widest">{c.label}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{c.desc} → CSV</p>
          </button>
        ))}
      </div>
    </div>
  );
}
