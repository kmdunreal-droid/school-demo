import React from 'react';
import { Student, Mark, FeeRecord, Class } from '../types';

interface PrintableReportProps {
  student: Student;
  studentClass: Class | undefined;
  marks: Mark[];
  fees: FeeRecord[];
}

export default function PrintableReport({ student, studentClass, marks, fees }: PrintableReportProps) {
  const totalBilled = fees.reduce((sum, f) => sum + f.amount, 0);
  const totalPaid = fees.filter(f => f.status === 'paid').reduce((sum, f) => sum + f.amount, 0);
  const totalUnpaid = totalBilled - totalPaid;

  return (
    <div id="printable-report" className="p-10 bg-white text-slate-900 font-sans max-w-4xl mx-auto border-2 border-slate-900 print:p-0 print:border-0 print:w-full">
      {/* School Header */}
      <div className="text-center border-b-2 border-slate-900 pb-6 mb-8">
        <h1 className="text-3xl font-black uppercase tracking-tighter ">NSB1 School</h1>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.3em] mt-1">Official Student Performance & Account Statement</p>
        <div className="mt-4 flex justify-between items-end text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <span>Date Issued: {new Date().toLocaleDateString()}</span>
          <span>Terminal Record: {student.id}</span>
        </div>
      </div>

      {/* Student Identification */}
      <div className="grid grid-cols-2 gap-8 mb-10">
        <div className="space-y-4">
          <div>
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest block">Student Name</span>
            <p className="text-xl font-black text-slate-900 uppercase">{student.name}</p>
          </div>
          <div>
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest block">Class & Section</span>
            <p className="text-sm font-bold text-slate-800">{studentClass ? `${studentClass.className} - ${studentClass.section}` : 'N/A'}</p>
          </div>
        </div>
        <div className="space-y-4 text-right">
          <div>
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest block">Roll Number</span>
            <p className="text-xl font-mono font-bold text-slate-900">#{student.rollNumber}</p>
          </div>
          <div>
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest block">Contact Index</span>
            <p className="text-sm font-mono text-slate-800">{student.parentPhone}</p>
          </div>
        </div>
      </div>

      {/* Academic Marks Record */}
      <div className="mb-10">
        <h3 className="text-xs font-black uppercase tracking-widest mb-4 bg-slate-900 text-white inline-block px-3 py-1">Academic Performance Log (Result Card)</h3>
        <table className="w-full border-collapse border border-slate-900">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-900">
              <th className="px-4 py-2 text-left border-r border-slate-900">Subject</th>
              <th className="px-4 py-2 text-left border-r border-slate-900">Exam Type</th>
              <th className="px-4 py-2 text-center border-r border-slate-900">Obtained</th>
              <th className="px-4 py-2 text-center">Max Marks</th>
            </tr>
          </thead>
          <tbody className="text-[11px] font-medium text-slate-800">
            {marks.length > 0 ? (
              marks.map((m, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="px-4 py-2 border-r border-slate-900 font-bold uppercase">{m.subject}</td>
                  <td className="px-4 py-2 border-r border-slate-900">{m.examType}</td>
                  <td className="px-4 py-2 border-r border-slate-900 text-center font-bold">{m.marksObtained}</td>
                  <td className="px-4 py-2 text-center">{m.maxMarks}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400 ">No academic marks recorded in the current session.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Financial Ledger Record */}
      <div className="mb-12">
        <h3 className="text-xs font-black uppercase tracking-widest mb-4 bg-slate-900 text-white inline-block px-3 py-1">Financial Account Statement (Fee Record)</h3>
        <table className="w-full border-collapse border border-slate-900">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-600 border-b border-slate-900">
              <th className="px-4 py-2 text-left border-r border-slate-900">Fee Category</th>
              <th className="px-4 py-2 text-left border-r border-slate-900">Month / Description</th>
              <th className="px-4 py-2 text-left border-r border-slate-900">Paid On</th>
              <th className="px-4 py-2 text-left border-r border-slate-900">Method</th>
              <th className="px-4 py-2 text-center border-r border-slate-900">Status</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="text-[11px] font-medium text-slate-800">
            {fees.length > 0 ? (
              fees.map((f, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="px-4 py-2 border-r border-slate-900 font-bold uppercase">{f.feeType || 'School Fee'}</td>
                  <td className="px-4 py-2 border-r border-slate-900">
                    <span className="font-bold block uppercase">{f.month}</span>
                    <span className="text-[11px] text-slate-400">{f.description || 'Routine billing'}</span>
                  </td>
                  <td className="px-4 py-2 border-r border-slate-900">{f.paidDate || '—'}</td>
                  <td className="px-4 py-2 border-r border-slate-900">{f.paymentMethod || 'Cash'}</td>
                  <td className="px-4 py-2 border-r border-slate-900 text-center">
                    <span className={`px-2 py-0.5 font-bold uppercase text-[11px] ${f.status === 'paid' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-800'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-bold font-mono">{f.amount}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400 ">No financial transitions found in the student ledger.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-900 text-white font-bold">
              <td colSpan={5} className="px-4 py-2 text-right uppercase tracking-[0.2em] text-[10px]">Grand Total Pending</td>
              <td className="px-4 py-2 text-right font-mono text-sm">{totalUnpaid}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Footer / Authentication */}
      <div className="flex justify-between items-end mt-20 pt-8 border-t-2 border-dashed border-slate-200">
        <div className="space-y-6">
          <div className="w-48 border-b border-slate-900"></div>
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">School Registrar Seal & Signature</p>
        </div>
        <div className="text-right space-y-1">
          <p className="text-[10px] font-black uppercase text-slate-900 tracking-tighter">Verified Official Document</p>
          <p className="text-[11px] font-bold text-slate-400  font-mono">MD-ID: {Math.random().toString(36).substr(2, 10).toUpperCase()}</p>
        </div>
      </div>

      {/* Print Note */}
      <div className="mt-10 text-center">
        <p className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.5em] ">System Generated Record • No Signature Required for Reference</p>
      </div>
    </div>
  );
}
