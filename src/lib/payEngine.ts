/**
 * PAY ENGINE — har teacher ka monthly hisab-e-tankhwah.
 *
 * Formula (net pay):
 *   netPay = baseSalary + (bonusPerPresentDay * presentDays) + allowances
 *          - (lateDeductionPerDay * lateDays)
 *          - (absentDeductionPerDay * absentDays)
 *          - fixedDeductions
 *
 * Attendance (TeacherAttendance) se present/late/absent/leave counts nikalte hain.
 * Demo mode mein sab localStorage par — jab nayi API aaye to isi engine ko use
 * karte hue data cloud mein sync karna hai.
 */
import type { TeacherAttendance, TeacherPayConfig, TeacherPayslip, Teacher } from '../types';

export const DEFAULT_TEACHER_PAY: Omit<TeacherPayConfig, 'teacherId'> = {
  baseSalary: 45000,
  bonusPerPresentDay: 250,
  lateDeductionPerDay: 500,
  absentDeductionPerDay: 1500,
  allowances: 0,
  deductions: 0,
};

export const DEFAULT_MONTH_SALARY = 45000;

export function defaultPayConfig(teacherId: string): TeacherPayConfig {
  return { teacherId, ...DEFAULT_TEACHER_PAY };
}

/** Date string (YYYY-MM-DD) ko {year, month(0-11)} mein. */
export function monthKeyOf(dateStr: string): { year: number; month: number } {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const parts = String(dateStr).split('-').map(Number);
    return { year: parts[0] || new Date().getFullYear(), month: (parts[1] || 1) - 1 };
  }
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export interface MonthSummary {
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  totalMarked: number;
}

/** Kisi teacher ka kisi month ka attendance summary. */
export function summarizeTeacherMonth(
  records: TeacherAttendance[],
  teacherId: string,
  year: number,
  month: number
): MonthSummary {
  const s: MonthSummary = { presentDays: 0, lateDays: 0, absentDays: 0, leaveDays: 0, totalMarked: 0 };
  for (const r of records) {
    if (String(r.teacherId) !== String(teacherId)) continue;
    const k = monthKeyOf(r.date);
    if (k.year !== year || k.month !== month) continue;
    if (!r.checkIn && !r.checkOut) continue; // sirf verified/timed records count
    if (r.status === 'present') s.presentDays++;
    else if (r.status === 'late') s.lateDays++;
    else if (r.status === 'absent') s.absentDays++;
    else if (r.status === 'leave') s.leaveDays++;
    s.totalMarked++;
  }
  return s;
}

export function buildPayslip(
  teacher: Teacher | undefined,
  config: TeacherPayConfig,
  records: TeacherAttendance[],
  year: number,
  month: number,
  paidSlips: Record<string, TeacherPayslip>
): TeacherPayslip {
  const sum = summarizeTeacherMonth(records, config.teacherId, year, month);
  const key = `${config.teacherId}_${year}_${month}`;
  const existing = paidSlips[key];
  const baseSalary = Math.max(0, Number(config.baseSalary) || 0);
  const presentBonus = Math.max(0, Number(config.bonusPerPresentDay) || 0) * sum.presentDays;
  const lateDeduction = Math.max(0, Number(config.lateDeductionPerDay) || 0) * sum.lateDays;
  const absentDeduction = Math.max(0, Number(config.absentDeductionPerDay) || 0) * sum.absentDays;
  const allowances = Math.max(0, Number(config.allowances) || 0);
  const fixedDeductions = Math.max(0, Number(config.deductions) || 0);
  const netPay = baseSalary + presentBonus + allowances - lateDeduction - absentDeduction - fixedDeductions;

  return {
    teacherId: config.teacherId,
    year,
    month,
    presentDays: sum.presentDays,
    lateDays: sum.lateDays,
    absentDays: sum.absentDays,
    leaveDays: sum.leaveDays,
    baseSalary,
    presentBonus,
    lateDeduction,
    absentDeduction,
    allowances,
    fixedDeductions,
    netPay: Math.max(0, netPay),
    paid: existing?.paid === true,
    paidDate: existing?.paidDate || null,
  };
}

export function formatPKR(n: number | null | undefined): string {
  const v = Number(n || 0);
  return `PKR ${v.toLocaleString('en-PK')}`;
}