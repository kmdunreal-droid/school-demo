export type Role = 'principal' | 'teacher' | 'student' | 'coordinator' | 'developer';

export interface Coordinator {
  id: string;
  name: string;
  email: string;
  username: string;
  password: string;
  phone: string;
}

export interface Teacher {
  id: string;
  name: string;
  email: string;
  username: string; // Added for login
  password: string; // Added for login
  subject: string;
  phone: string;
}

export interface Student {
  id: string;
  name: string;
  email?: string;
  username: string; // Added for login
  password: string; // Added for login
  classId: string; // References Class.id
  rollNumber: string;
  parentPhone: string;
  studentPhone?: string;
  baseFee?: number;
  guardianName?: string;
  category?: string;
  academySubjects?: string[];
  enrollmentMonth?: string;
  photo?: string;
  idCardTheme?: string;
  idCardColor?: string;
}

export interface ClassFeeConfig {
  name: string;
  amount: number;
}

export interface Class {
  id: string;
  className: string; // e.g., "Grade 10", "Grade 11"
  section: string;   // e.g., "A", "B"
  classTeacherId: string; // References Teacher.id
  subjects?: string[];
  feeConfigs?: ClassFeeConfig[];
}

export type ExamType = string;

export interface Mark {
  id: string;
  studentId: string;   // References Student.id
  subject: string;
  examType: ExamType;
  marksObtained: number;
  maxMarks: number;
}

export interface Attendance {
  id: string;
  studentId: string;   // References Student.id
  date: string;        // YYYY-MM-DD
  status: 'present' | 'absent' | 'late' | 'leave';
  markedBy?: string;   // Teacher/Principal who marked the attendance
}

export interface FeeRecord {
  id: string;
  studentId: string;   // References Student.id
  amount: number;
  dueDate: string;     // YYYY-MM-DD
  status: 'paid' | 'unpaid' | 'pending';
  paidDate?: string;   // YYYY-MM-DD
  month: string;       // e.g., "June 2026"
  paymentMethod?: string; // e.g., "Credit Card", "Bank Transfer", "Cash"
  feeType?: 'Tuition Fee' | 'Admission Fee' | 'Annual Fee' | 'Paper Fund' | 'Pending Balance' | 'Miscellaneous' | string;
  description?: string;
  /** Agar yeh payment kisi due (khata) ke collection se bani hai to us due ka id (double-count guard). */
  dueId?: string;
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
  /** Partial collection support: kitna amount already PAID collect ho chuka hai (0 = kuch nahi). */
  paidAmount?: number;
  paidDate?: string;
  paymentMethod?: string;
  studentName?: string;
  studentClass?: string;
}

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface TimetableEntry {
  id: string;
  classId: string;     // References Class.id
  day: DayOfWeek;
  period: string;      // e.g., "Period 1", "Period 2", etc.
  time: string;        // e.g., "09:00 AM - 10:00 AM"
  subject: string;
  teacherId: string;   // References Teacher.id
}

export interface AppSettings {
  absentTemplate: string;
  feeTemplate: string;
  resultTemplate: string;
  whatsAppAutoFee: boolean;
  whatsAppAutoAbsence: boolean;
  whatsAppAutoResult: boolean;
  autoWhatsAppRedirect: boolean;
  extraPeriods: Record<string, string[]>;
  deletedPeriods: Record<string, string[]>;
  periodColors: Record<string, string>;
}

export interface Assignment {
  id: string;
  classId: string;      // Target class (visible only to students of this class)
  subject: string;      // e.g. "Mathematics"
  title: string;        // Assignment title
  description: string;  // Instructions / details
  dueDate: string;      // YYYY-MM-DD deadline
  assignedById: string; // Teacher.id who created it
  assignedByName: string; // Teacher display name
  createdAt: string;    // ISO timestamp
}

export interface StudentFeeData {
  id: string | number;
  name: string;
  class: string;
  monthlyFee: number;
  enrollmentMonth?: string;
  payments: {
    id: string;
    month: string;
    year: number;
    amount: number;
    date: string;
    feeType?: string;
  }[];
  otherFunds: {
    id: string;
    desc: string;
    amount: number;
    date: string;
  }[];
  dues: DueEntry[];
}

export interface UserSession {
  role: Role;
  email: string;
  username: string;
  id?: string; // links to student or teacher, or undefined for principal
  name: string;
}

// ============================================================
// TEACHER SELF-ATTENDANCE (GPS verified check-in / check-out)
// ============================================================
export interface TeacherAttendance {
  id: string;
  teacherId: string;
  date: string;            // YYYY-MM-DD
  checkIn: string | null;  // ISO timestamp
  checkOut: string | null; // ISO timestamp
  status: 'present' | 'late' | 'absent' | 'leave';
  lat?: number | null;
  lng?: number | null;
  distanceMeters?: number | null; // school se distance
  locationVerified?: boolean;      // GPS check pass hua ya nahi
  note?: string;
}

// ============================================================
// TEACHER PAY — hisab-e-tankhwah
// ============================================================
export interface TeacherPayConfig {
  teacherId: string;
  baseSalary: number;            // monthly base
  bonusPerPresentDay: number;    // per present day bonus
  lateDeductionPerDay: number;   // har late day ka kaat
  absentDeductionPerDay: number; // har absent day ka kaat
  allowances: number;            // monthly fixed allowance
  deductions: number;            // monthly fixed deduction
}

export interface TeacherPayslip {
  teacherId: string;
  year: number;
  month: number; // 0-11
  presentDays: number;
  lateDays: number;
  absentDays: number;
  leaveDays: number;
  baseSalary: number;
  presentBonus: number;
  lateDeduction: number;
  absentDeduction: number;
  allowances: number;
  fixedDeductions: number;
  netPay: number;
  paid: boolean;
  paidDate?: string | null;
}

// ============================================================
// SCHOOL LOCATION — attendance GPS radius ke liye
// ============================================================
export interface SchoolLocation {
  lat: number;
  lng: number;
  radiusMeters: number;
  name: string;
}

export function getStudentPhoto(student?: { id?: string; name?: string; photo?: string } | null): string {
  if (student?.photo && student.photo.trim().length > 0) {
    return student.photo;
  }
  return '';
}

