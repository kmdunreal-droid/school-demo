
export interface Payment {
  id: string;
  month: string;
  year: number;
  amount: number;
  date: string;
  feeType?: string;
}

export interface OtherFund {
  id: string;
  desc: string;
  amount: number;
  date: string;
}

export interface DueEntry {
  id: string;
  studentId: string | number;
  desc: string;
  amount: number;
  date: string;
  month: string;
  year: number;
  status: 'pending' | 'paid' | 'waived';
  paidAmount?: number;
  paidDate?: string;
  paymentMethod?: string;
}

export interface StudentFeeData {
  id: string | number;
  name: string;
  class: string;
  monthlyFee: number;
  enrollmentMonth?: string;
  payments: Payment[];
  otherFunds: OtherFund[];
  dues: DueEntry[];
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export type Month = typeof MONTHS[number];

/**
 * Core Fee Engine Functions
 */

// 1. addPayment - Partial payment support with auto-fill for future months
export const addPayment = (students: StudentFeeData[], studentId: string | number, targetMonth: string, year: number, amount: number, feeType: string = 'School Fee'): StudentFeeData[] => {
  const date = new Date().toISOString().split('T')[0];
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      let remainingAmount = amount;
      const newPayments = [...s.payments];
      const yearly = getYearlySummary(s, year);
      
      // First: pay pending for current/past months
      for (const m of yearly) {
        if (!m.isFutureMonth && m.pending > 0 && remainingAmount > 0) {
          const toPay = Math.min(m.pending, remainingAmount);
          remainingAmount -= toPay;
          newPayments.push({ id: Math.random().toString(36).substr(2, 9), month: m.month, year, amount: toPay, date, feeType });
        }
      }
      
      // Second: auto-fill future months if there's excess payment
      for (const m of yearly) {
        if (m.isFutureMonth && m.due > 0 && remainingAmount > 0) {
          const toPay = Math.min(m.due, remainingAmount);
          remainingAmount -= toPay;
          newPayments.push({ id: Math.random().toString(36).substr(2, 9), month: m.month, year, amount: toPay, date, feeType });
        }
      }
      
      // Third: any remaining goes to target month
      if (remainingAmount > 0) {
         newPayments.push({ id: Math.random().toString(36).substr(2, 9), month: targetMonth, year, amount: remainingAmount, date, feeType });
      }

      return {
        ...s,
        payments: newPayments
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 1.1 deletePayment
export const deletePayment = (students: StudentFeeData[], studentId: string | number, paymentId: string): StudentFeeData[] => {
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        payments: s.payments.filter(p => p.id !== paymentId)
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 1.2 editPayment
export const editPayment = (students: StudentFeeData[], studentId: string | number, paymentId: string, newAmount: number, newFeeType?: string): StudentFeeData[] => {
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        payments: s.payments.map(p => p.id === paymentId ? { ...p, amount: newAmount, ...(newFeeType ? { feeType: newFeeType } : {}) } : p)
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 2. getMonthlySummary - { due, paid, pending }
// Robust month matching: 'Sep', 'Sept 2026', 'September 2026', 'September' — sab formats handle
const MONTH_ALIAS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const normMonthIdx = (raw: unknown): number => {
  const m = String(raw || '').trim().toLowerCase().match(/^([a-z]+)/);
  return m ? (MONTH_ALIAS[m[1]] ?? -1) : -1;
};
const normMonthYear = (raw: unknown, fallback: number): number => {
  const m = String(raw || '').match(/(\d{4})/);
  return m ? Number(m[1]) : fallback;
};

export const getMonthlySummary = (student: StudentFeeData, month: string, year: number) => {
  const monthIndex = normMonthIdx(month) !== -1 ? normMonthIdx(month) : MONTHS.indexOf(month as Month);
  const currentMonthIndex = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  let isFutureMonth = false;
  if (year > currentYear) {
    isFutureMonth = true;
  } else if (year === currentYear && monthIndex >= 0 && monthIndex > currentMonthIndex) {
    isFutureMonth = true;
  }

  // Check enrollment month (robust: 'September' / 'Sep' dono formats)
  let isBeforeEnrollment = false;
  const enrollIndex = normMonthIdx(student.enrollmentMonth);
  if (monthIndex >= 0 && enrollIndex >= 0 && enrollIndex > monthIndex) {
    isBeforeEnrollment = true;
  }

  const due = (isFutureMonth || isBeforeEnrollment) ? 0 : student.monthlyFee;
  // FIX: p.month === month (exact match) ki jagah robust parsing —
  // 'September 2026' / 'Sep' / 'September' sab formats count hote hain
  const paid = student.payments
    .filter(p => normMonthIdx(p.month) === monthIndex && normMonthYear(p.month, year) === year)
    .reduce((sum, p) => sum + p.amount, 0);
  
  const pending = Math.max(0, due - paid);
  return { due, paid, pending, isFutureMonth };
};

// 3. getYearlySummary - 12 months array
export const getYearlySummary = (student: StudentFeeData, year: number) => {
  return MONTHS.map(month => {
    const summary = getMonthlySummary(student, month, year);
    return {
      month,
      ...summary,
      isComplete: summary.due > 0 && summary.pending === 0 // only complete if it actually had due
    };
  });
};

// 4. getTotalPending - sum of all months pending
export const getTotalPending = (student: StudentFeeData) => {
  const currentYear = new Date().getFullYear();
  const yearly = getYearlySummary(student, currentYear);
  return yearly.reduce((sum, m) => sum + m.pending, 0);
};

// 5. getTotalCollected - total wusooli
export const getTotalCollected = (student: StudentFeeData) => {
  return student.payments.reduce((sum, p) => sum + p.amount, 0);
};

// 6. addOtherFund
export const addOtherFund = (students: StudentFeeData[], studentId: string | number, description: string, amount: number): StudentFeeData[] => {
  const date = new Date().toISOString().split('T')[0];
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        otherFunds: [...s.otherFunds, { id: Math.random().toString(36).substr(2, 9), desc: description, amount, date }]
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 6.1 deleteOtherFund
export const deleteOtherFund = (students: StudentFeeData[], studentId: string | number, fundId: string): StudentFeeData[] => {
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        otherFunds: s.otherFunds.filter(f => f.id !== fundId)
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 6.2 editOtherFund
export const editOtherFund = (students: StudentFeeData[], studentId: string | number, fundId: string, newDesc: string, newAmount: number): StudentFeeData[] => {
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        otherFunds: s.otherFunds.map(f => f.id === fundId ? { ...f, desc: newDesc, amount: newAmount } : f)
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 7. getTotalOtherFunds
export const getTotalOtherFunds = (student: StudentFeeData) => {
  return student.otherFunds.reduce((sum, f) => sum + f.amount, 0);
};

// 8. getStudentFullAccount
export const getStudentFullAccount = (student: StudentFeeData, year: number) => {
  const yearlyBreakdown = getYearlySummary(student, year);
  
  const currentMonthIndex = new Date().getMonth();
  
  // Calculate totals for all months
  const totalDue = yearlyBreakdown.reduce((sum, m) => sum + m.due, 0);
  const totalPaid = yearlyBreakdown.reduce((sum, m) => sum + m.paid, 0);
  const totalPending = yearlyBreakdown.reduce((sum, m) => sum + m.pending, 0);
  
  const otherFundsTotal = getTotalOtherFunds(student);

  return {
    yearlyBreakdown,
    totalDue,
    totalPaid,
    totalPending,
    otherFunds: student.otherFunds,
    otherFundsTotal,
    grandTotalPending: totalPending + otherFundsTotal
  };
};

// 9. getGlobalStats
export const getGlobalStats = (students: StudentFeeData[]) => {
  const totalStudents = students.length;
  let totalCollected = 0;
  let totalPending = 0;
  let totalOther = 0;

  students.forEach(s => {
    totalCollected += getTotalCollected(s);
    totalPending += getTotalPending(s);
    totalOther += getTotalOtherFunds(s);
  });

  return {
    totalStudents,
    totalCollected,
    totalPending,
    totalOther
  };
};

// ===== DUES MANAGEMENT (separate from monthly fee) =====

/** Kitna amount is due ka already paid/collected hai. */
export const getDuePaid = (d: DueEntry): number => {
  if (Number.isFinite(d.paidAmount) && Number(d.paidAmount) > 0) return Number(d.paidAmount);
  return d.status === 'paid' ? Number(d.amount) || 0 : 0;
};

/** Kitna amount abhi bhi pending / baqi hai. */
export const getDueRemaining = (d: DueEntry): number => {
  if (d.status === 'waived') return 0;
  if (d.status === 'paid') return Math.max(0, (Number(d.amount) || 0) - getDuePaid(d));
  return Math.max(0, (Number(d.amount) || 0) - getDuePaid(d));
};

// 10. addDue - Add a due entry for a student (separate from monthly fee)
export const addDue = (students: StudentFeeData[], studentId: string | number, desc: string, amount: number, month: string, year: number): StudentFeeData[] => {
  const date = new Date().toISOString().split('T')[0];
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      const newDue: DueEntry = { id: Math.random().toString(36).substr(2, 9), studentId: s.id, desc, amount, date, month, year, status: 'pending', paidAmount: 0 };
      return {
        ...s,
        dues: [...(s.dues || []), newDue]
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 11. payDue - Mark a due as paid (partial amount allowed; ager amount >= due → fully paid)
export const payDue = (students: StudentFeeData[], studentId: string | number, dueId: string, paymentMethod: string = 'Cash', partialAmount?: number): StudentFeeData[] => {
  const date = new Date().toISOString().split('T')[0];
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        dues: (s.dues || []).map(d => {
          if (d.id !== dueId) return d;
          const alreadyPaid = getDuePaid(d);
          const toAdd = Number.isFinite(partialAmount) ? Math.max(0, Number(partialAmount) || 0) : Math.max(0, (Number(d.amount) || 0) - alreadyPaid);
          const newPaid = Math.min((Number(d.amount) || 0), alreadyPaid + toAdd);
          const fullyPaid = newPaid >= (Number(d.amount) || 0);
          return { ...d, paidAmount: newPaid, status: fullyPaid ? 'paid' as const : 'pending' as const, paidDate: date, paymentMethod };
        })
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 12. deleteDue
export const deleteDue = (students: StudentFeeData[], studentId: string | number, dueId: string): StudentFeeData[] => {
  const updatedStudents = students.map(s => {
    if (String(s.id) === String(studentId)) {
      return {
        ...s,
        dues: (s.dues || []).filter(d => d.id !== dueId)
      };
    }
    return s;
  });
  saveToLocalStorage(updatedStudents);
  return updatedStudents;
};

// 13. getTotalDues - Get total pending dues (remaining amount) for a student
export const getTotalDues = (student: StudentFeeData) => {
  return (student.dues || []).reduce((sum, d) => sum + getDueRemaining(d), 0);
};

// 14. getPaidDues - Get total paid/collected amount for a student's dues
export const getPaidDues = (student: StudentFeeData) => {
  return (student.dues || []).reduce((sum, d) => sum + getDuePaid(d), 0);
};

// 15. getDuesByMonth - Get dues for a specific month/year
export const getDuesByMonth = (student: StudentFeeData, month: string, year: number) => {
  return (student.dues || []).filter(d => d.month === month && d.year === year);
};

// 16. getAllDues - Get all dues (for dashboard)
export interface DueEntryWithStudent extends DueEntry {
  studentName: string;
  studentClass: string;
}

export const getAllDues = (students: StudentFeeData[]): DueEntryWithStudent[] => {
  const allDues: DueEntryWithStudent[] = [];
  students.forEach(s => {
    (s.dues || []).forEach(d => {
      allDues.push({ ...d, studentName: s.name, studentClass: s.class });
    });
  });
  return allDues.sort((a, b) => b.date.localeCompare(a.date));
};

// ===== ADVANCE FEE — ZYADA DI GAYI FEE AGLY MONTHS KE LIYE ADVANCE =====
const ADV_TUITION_FEE_TYPES = /^(tuition|school|monthly)\s*(nsb\s*)?fee$/i;
const isAdvTuition = (t?: string) => !t || ADV_TUITION_FEE_TYPES.test(String(t).trim()) || /school\s*(nsb\s*)?fee/i.test(String(t));

/** Advance se kitna paisa kaunse future month par lagaya gaya (full ya partial). */
export interface AdvanceMonthUse {
  month: string;
  year: number;
  /** Is month par advance se lagaya gaya amount */
  amount: number;
  /** Advance lagane ke baad bhi is month kitna baqi hai (0 = month full clear) */
  remaining: number;
}

export interface AdvanceSummary {
  /** Current month tak bacha hua advance balance (zyada payment) */
  advance: number;
  /** Future months jahan advance balance lagaya gaya (full/partial) */
  advanceMonths: AdvanceMonthUse[];
  /** Sary months ke baad bhi carry hua advance balance */
  remainingAfter: number;
  currentMonthIdx: number;
  currentYear: number;
}

/**
 * Student ki zyada (extra) fee ka hisab:
 * Agar kisi month ki fee se zyada pay ho jaye to wo balance "advance" ban jata hai
 * aur age ke months ki fee khud us balance se clear hoti hai — "advance month" feature.
 */
export const getAdvanceSummary = (student: StudentFeeData, year: number = new Date().getFullYear()): AdvanceSummary => {
  const now = new Date();
  const curIdx = now.getMonth();
  const curYear = now.getFullYear();
  const base = Math.max(0, Number(student.monthlyFee || 0));
  const enrollIdx = normMonthIdx(student.enrollmentMonth);
  const isThisYear = year === curYear;

  // Is year ke kaunse month tak fee due hai (current year → current month tak; purana year → December tak)
  const lastDueIdx = isThisYear ? curIdx : (year < curYear ? 11 : -1);
  const stIdx = isThisYear && enrollIdx >= 0 && enrollIdx <= lastDueIdx ? enrollIdx : 0;

  const paidInMonth = (mi: number): number =>
    (student.payments || [])
      .filter(p => normMonthIdx(p.month) === mi && normMonthYear(p.month, year) === year && isAdvTuition(p.feeType))
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // 1) Enrollment month → current month: jo zyada pay hua wo balance ban kar aage carry hota hai
  let balance = 0;
  for (let mi = stIdx; mi <= lastDueIdx; mi++) {
    balance = Math.max(0, balance) + paidInMonth(mi) - base;
  }
  const advance = Math.max(0, balance);

  // 2) Future months par advance lagao (full ya partial) — "advance month" feature
  const advanceMonths: AdvanceMonthUse[] = [];
  let remaining = advance;
  if (isThisYear || year > curYear) {
    const startFuture = isThisYear ? curIdx + 1 : 0;
    for (let mi = startFuture; mi < 12; mi++) {
      if (remaining <= 0) break;
      const paid = paidInMonth(mi);
      const deficit = Math.max(0, base - paid);
      if (deficit <= 0) continue; // month already directly paid hai
      const apply = Math.min(deficit, remaining);
      advanceMonths.push({ month: MONTHS[mi], year, amount: apply, remaining: deficit - apply });
      remaining -= apply;
    }
  }

  return { advance, advanceMonths, remainingAfter: Math.max(0, remaining), currentMonthIdx: curIdx, currentYear: curYear };
};

import { safeStorage } from './safeStorage';

// Persistence
export const saveToLocalStorage = (students: StudentFeeData[]) => {
  safeStorage.setItem('school_fee_data', JSON.stringify(students));
};

export const loadFromLocalStorage = (): StudentFeeData[] => {
  const data = safeStorage.getItem('school_fee_data');
  if (!data) return [];
  try {
    const parsed: StudentFeeData[] = JSON.parse(data);
    // Migration: ensure all payments, otherFunds, and dues have IDs
    return parsed.map(s => ({
      ...s,
      payments: (s.payments || []).map(p => ({
        ...p,
        id: p.id || Math.random().toString(36).substr(2, 9)
      })),
      otherFunds: (s.otherFunds || []).map(f => ({
        ...f,
        id: f.id || Math.random().toString(36).substr(2, 9)
      })),
      dues: (s.dues || []).map(d => ({
        ...d,
        id: d.id || Math.random().toString(36).substr(2, 9),
        // Migration: purane dues mein paidAmount set karo (agar already paid ho to amount ke barabar)
        paidAmount: Number.isFinite(d.paidAmount) ? Number(d.paidAmount) : (d.status === 'paid' ? (Number(d.amount) || 0) : 0)
      }))
    }));
  } catch (e) {
    console.error("Error loading fee data:", e);
    return [];
  }
};
