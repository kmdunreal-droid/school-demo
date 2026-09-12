import { testSupabaseConnection, isDemoMode } from '../supabase';
import { subscribeRecords, loadCollectionFromSupabase, sbQueueWrite, sbQueueDelete, flushSupabase } from '../lib/supabaseSync';
import { listChanged } from '../lib/dataUtils';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { BarChart2, CheckCircle2, ChevronDown, ChevronUp, CreditCard, Database, Download, Edit2, LogOut, Mail, Menu, MessageSquare, Moon, Percent, Phone, Plus, PlusCircle, RefreshCw, Save, Search, Shield, ShieldAlert, Sparkles, Sun, Trash2, TrendingUp, User, Users, X, ArrowUpRight, Award, Bell, BookOpen, Calendar, CalendarDays, AlertCircle, DownloadCloud, UploadCloud, Upload, ArrowLeft, ArrowRight, Fingerprint, Send, Zap, FileText, Printer, Filter, Receipt, Clock, AlertTriangle, School, DollarSign, HardDrive, Wifi, Banknote, Wallet, MapPin, Navigation, Coins, CalendarClock, LocateFixed, Megaphone, LayoutGrid, Settings } from 'lucide-react';
import AnalyticsTab from './AnalyticsTab';
import NoticeBoard from './NoticeBoard';
import EventsCalendar from './EventsCalendar';
import CertificateTab from './CertificateTab';
import AiPaperGenerator from './AiPaperGenerator';
import AiSettingsSection from './AiSettingsSection';
import AttendanceSettingsSection from './AttendanceSettingsSection';
import { getPeriodStatus, getStatusColor } from '../lib/periodUtils';
import { addNotification, getNotifications, saveNotifications, PortalNotification } from '../lib/notificationUtils';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell } from 'recharts';
import { Teacher, Student, Coordinator, Class, TimetableEntry, DayOfWeek, UserSession, FeeRecord, Attendance, Mark, AppSettings, StudentFeeData, DueEntry, Assignment, TeacherAttendance, TeacherPayConfig, TeacherPayslip, SchoolLocation, getStudentPhoto } from '../types';
import { HoldActionWrapper } from './HoldActionWrapper';
import { FeePaymentCenter } from './FeePaymentCenter';
import { useLongPress } from '../lib/longPress';
import { 
  addPayment, 
  getMonthlySummary, 
  getYearlySummary, 
  getTotalPending, 
  getTotalCollected, 
  addOtherFund, 
  getTotalOtherFunds, 
  getStudentFullAccount, 
  getGlobalStats, 
  deleteOtherFund,
  editOtherFund,
  deletePayment,
  editPayment,
  addDue,
  payDue,
  deleteDue,
  getTotalDues,
  getPaidDues,
  getDuePaid,
  getDueRemaining,
  getDuesByMonth,
  getAllDues,
  MONTHS,
  Month
} from '../lib/feeEngine';
import { defaultPayConfig, summarizeTeacherMonth, buildPayslip, monthLabel, formatPKR } from '../lib/payEngine';
import { DEFAULT_SCHOOL_LOCATION, haversineMeters, formatDistance } from '../lib/geoUtils';
import { INITIAL_TEACHER_PAY_CONFIGS, INITIAL_SCHOOL_LOCATION } from '../initialData';

// ===== Month parsing helpers =====
// Fee month strings mixed formats mein aati hain: 'Jun', 'Jun 2026', 'June 2026', 'September'.
// MONTH_ALIAS + parseMonthKey sab formats ko {monthIndex, year} mein normalize karte hain.
const MONTH_ALIAS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
};
const TUITION_FEE_TYPES = /^(tuition|school|monthly)\s*(nsb\s*)?fee$/i;
const isTuitionFeeType = (t: string) => TUITION_FEE_TYPES.test(String(t || '').trim()) || /school\s*(nsb\s*)?fee/i.test(String(t || ''));

/**
 * Auto-spread a tuition payment across ALL pending months (oldest first).
 * Example: student has Jun+Jul+Aug pending (PKR 2,500 each) and you collect
 * PKR 15,000 → it automatically covers Jun, Jul, Aug ... etc. one payment
 * record per month, so you never add each month separately.
 * Mirrors FeeMonthGrid's matching so the preview === what gets recorded.
 */
const buildTuitionAllocation = (
  feeStudent: StudentFeeData | undefined,
  student: Student | undefined,
  amount: number,
  year: number
): { month: string; year: number; amount: number }[] => {
  if (!student) return [];
  const base = Math.max(0, Number(student.baseFee ?? feeStudent?.monthlyFee ?? 0));
  if (base <= 0 || !(amount > 0)) return [];
  const enrollAlias = String(student.enrollmentMonth || '').trim().toLowerCase();
  const enrollIdx = Object.prototype.hasOwnProperty.call(MONTH_ALIAS, enrollAlias) ? MONTH_ALIAS[enrollAlias] : 0;
  const payments = feeStudent?.payments || [];
  const allocs: { month: string; year: number; amount: number }[] = [];
  let remaining = amount;
  for (let mi = enrollIdx; mi < 12 && remaining > 0; mi++) {
    const monthName = MONTHS[mi];
    const tuitionPaid = payments
      .filter(p => {
        const key = parseMonthKey(p.month, Number(p.year) || year);
        return key.idx === mi && key.year === Number(year) && (!p.feeType || TUITION_FEE_TYPES.test(p.feeType));
      })
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const pending = Math.max(0, base - tuitionPaid);
    if (pending <= 0) continue;
    const toPay = Math.min(pending, remaining);
    remaining -= toPay;
    allocs.push({ month: monthName, year: Number(year), amount: toPay });
  }
  return allocs;
};
const parseMonthKey = (raw: unknown, fallbackYear: number): { idx: number; year: number } => {
  const s = String(raw ?? '').trim();
  const m = s.match(/^([A-Za-z]+)\s*,?\s*(\d{4})?$/);
  if (!m) return { idx: -1, year: fallbackYear };
  const alias = m[1].toLowerCase();
  return {
    idx: Object.prototype.hasOwnProperty.call(MONTH_ALIAS, alias) ? MONTH_ALIAS[alias] : -1,
    year: m[2] ? Number(m[2]) : fallbackYear
  };
};


// ===== FEATURES HUB =====
// Purane alag-alag tabs jo ab ek hi "Features Hub" tab ke sub-tabs hain.
// In ids ka istemal legacy localStorage/history migration ke liye rehta hai.
const FEATURES_HUB_TABS = ['notices', 'calendar', 'certificates', 'ai_paper', 'alerts', 'settings'] as const;
type FeaturesSubTab = (typeof FEATURES_HUB_TABS)[number];
const isFeaturesHubTab = (t: unknown): t is FeaturesSubTab =>
  (FEATURES_HUB_TABS as readonly unknown[]).includes(t);
const FEATURES_HUB_META: Record<FeaturesSubTab, { label: string; icon: any }> = {
  notices: { label: 'Notice Board', icon: Megaphone },
  calendar: { label: 'Calendar', icon: CalendarDays },
  certificates: { label: 'Certificates', icon: Award },
  ai_paper: { label: 'AI Paper', icon: Sparkles },
  alerts: { label: 'Alert Center', icon: AlertCircle },
  settings: { label: 'Cloud Config', icon: Settings },
};

interface PrincipalDashboardProps {
  userSession: UserSession;
  teachers: Teacher[];
  setTeachers: React.Dispatch<React.SetStateAction<Teacher[]>>;
  students: Student[];
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>;
  coordinators: Coordinator[];
  setCoordinators: React.Dispatch<React.SetStateAction<Coordinator[]>>;
  classes: Class[];
  setClasses: React.Dispatch<React.SetStateAction<Class[]>>;
  timetable: TimetableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>;
  fees: FeeRecord[];
  setFees: React.Dispatch<React.SetStateAction<FeeRecord[]>>;
  attendance: Attendance[];
  setAttendance: React.Dispatch<React.SetStateAction<Attendance[]>>;
  marks: Mark[];
  setMarks: React.Dispatch<React.SetStateAction<Mark[]>>;
  feeStudents: StudentFeeData[];
  setFeeStudents: React.Dispatch<React.SetStateAction<StudentFeeData[]>>;
  appSettings: AppSettings;
  setAppSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  assignments: Assignment[];
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  onLogout: () => void;
  installPromptEvent: any;
  onInstallApp: () => void;
  pushLocalToCloud: () => Promise<void>;
}

type PrincipalTabType = 'dashboard' | 'management_hub' | 'features_hub' | 'timetable' | 'alerts' | 'settings' | 'registers' | 'monthly_report' | 'fees' | 'teacher_pay' | 'analytics' | 'notices' | 'calendar' | 'certificates' | 'ai_paper';
type CoordinatorTabType = PrincipalTabType;
type TabType = PrincipalTabType | CoordinatorTabType;

const STANDARD_SUBJECTS_LIST = [
  'Mathematics', 'English', 'Urdu', 'Science', 'Physics', 'Chemistry', 'Biology', 
  'Computer Science', 'Islamiyat', 'Pak Studies', 'Social Studies', 'Geography', 
  'History', 'General Science', 'Art', 'Physical Education'
];

import { safeStorage } from '../lib/safeStorage';

/** localStorage se typed load — demo mode ka primary store. */
function loadLocalJSON<T>(key: string, fallback: T): T {
  try {
    const raw = safeStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback) && (!Array.isArray(parsed) || parsed.length === 0)) return fallback;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export default function PrincipalDashboard({
  userSession,
  teachers,
  setTeachers,
  students,
  setStudents,
  coordinators,
  setCoordinators,
  classes,
  setClasses,
  timetable,
  setTimetable,
  fees,
  setFees,
  attendance,
  setAttendance,
  marks,
  setMarks,
  feeStudents,
  setFeeStudents,
  appSettings,
  setAppSettings,
  assignments,
  setAssignments,
  onLogout,
  installPromptEvent,
  onInstallApp,
  pushLocalToCloud
}: PrincipalDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = safeStorage.getItem('acadamis_active_tab');
    // Legacy tabs jo ab Features Hub mein merge ho chuke hain → hub par map karo
    if (isFeaturesHubTab(saved)) {
      return 'features_hub' as TabType;
    }
    const valid: TabType[] = ['dashboard', 'management_hub', 'features_hub', 'timetable', 'alerts', 'settings', 'registers', 'monthly_report', 'fees', 'teacher_pay', 'analytics', 'notices', 'calendar', 'certificates', 'ai_paper'];
    return (saved && valid.includes(saved as TabType) ? saved : 'dashboard') as TabType;
  });

  // Persist activeTab to localStorage on every change
  useEffect(() => {
    safeStorage.setItem('acadamis_active_tab', activeTab);
  }, [activeTab]);

  // Browser Back Button Support for Tabs
  useEffect(() => {
    // Sync initial state
    window.history.replaceState({ tab: activeTab }, '', '');

    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.tab) {
        // Legacy feature tab ids ko Features Hub par map karo
        setActiveTab(isFeaturesHubTab(event.state.tab) ? ('features_hub' as TabType) : event.state.tab);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Update history when tab changes
  const handleTabChange = (tab: TabType) => {
    if (tab !== activeTab) {
      window.history.pushState({ tab }, '', '');
      setActiveTab(tab);
    }
  };
  const [reportClassFilter, setReportClassFilter] = useState<string>('all');
  const [selectedStudentReport, setSelectedStudentReport] = useState<Student | null>(null);
  const [reportMonth, setReportMonth] = useState<Month>(MONTHS[new Date().getMonth()]);
  const [managementSubTab, setManagementSubTab] = useState<'teachers' | 'students' | 'classes' | 'coordinators'>(() => {
    const saved = safeStorage.getItem('acadamis_mgmt_subtab');
    return (saved && ['teachers', 'students', 'classes', 'coordinators'].includes(saved) ? saved : 'teachers') as 'teachers' | 'students' | 'classes' | 'coordinators';
  });
  const [registersSubTab, setRegistersSubTab] = useState<'fees' | 'attendance' | 'results'>(() => {
    const saved = safeStorage.getItem('acadamis_registers_subtab');
    return (saved && ['fees', 'attendance', 'results'].includes(saved) ? saved : 'fees') as 'fees' | 'attendance' | 'results';
  });

  const [featuresSubTab, setFeaturesSubTab] = useState<FeaturesSubTab>(() => {
    const savedSub = safeStorage.getItem('acadamis_features_subtab');
    if (isFeaturesHubTab(savedSub)) return savedSub;
    // Legacy: agar user pehle kisi feature tab par tha, wahi sub-tab khule
    const savedTab = safeStorage.getItem('acadamis_active_tab');
    if (isFeaturesHubTab(savedTab)) return savedTab;
    return 'notices';
  });

  // Persist sub-tabs
  useEffect(() => { safeStorage.setItem('acadamis_mgmt_subtab', managementSubTab); }, [managementSubTab]);
  useEffect(() => { safeStorage.setItem('acadamis_registers_subtab', registersSubTab); }, [registersSubTab]);
  useEffect(() => { safeStorage.setItem('acadamis_features_subtab', featuresSubTab); }, [featuresSubTab]);
  const [broadcastLogs, setBroadcastLogs] = useState<any[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // ===== TEACHER PAY + GPS ATTENDANCE MANAGEMENT (demo local store) =====
  const [allTeacherAttendance, setAllTeacherAttendance] = useState<TeacherAttendance[]>(() => loadLocalJSON('acadamis_teacher_attendance', [] as TeacherAttendance[]));
  const [teacherPayConfigs, setTeacherPayConfigsP] = useState<TeacherPayConfig[]>(() => loadLocalJSON('acadamis_teacher_pay_configs', INITIAL_TEACHER_PAY_CONFIGS as TeacherPayConfig[]));
  const [teacherPaySlips, setTeacherPaySlipsP] = useState<Record<string, TeacherPayslip>>(() => loadLocalJSON('acadamis_teacher_pay_slips', {} as Record<string, TeacherPayslip>));
  const [schoolLocation, setSchoolLocationP] = useState<SchoolLocation>(() => loadLocalJSON('acadamis_school_location', INITIAL_SCHOOL_LOCATION as SchoolLocation));
  const [payMonthSelP, setPayMonthSelP] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [editingPayTeacherId, setEditingPayTeacherId] = useState<string | null>(null);
  const [payForm, setPayForm] = useState<TeacherPayConfig | null>(null);
  const [locLat, setLocLat] = useState<string>(() => loadLocalJSON('acadamis_school_location', INITIAL_SCHOOL_LOCATION as SchoolLocation).lat.toString());
  const [locLng, setLocLng] = useState<string>(() => loadLocalJSON('acadamis_school_location', INITIAL_SCHOOL_LOCATION as SchoolLocation).lng.toString());
  const [locRadius, setLocRadius] = useState<string>(() => loadLocalJSON('acadamis_school_location', INITIAL_SCHOOL_LOCATION as SchoolLocation).radiusMeters.toString());
  const [locName, setLocName] = useState<string>(() => loadLocalJSON('acadamis_school_location', INITIAL_SCHOOL_LOCATION as SchoolLocation).name);
  const [showLocSaved, setShowLocSaved] = useState(false);

  useEffect(() => {
    safeStorage.setItem('acadamis_teacher_pay_configs', JSON.stringify(teacherPayConfigs));
    teacherPayConfigs.forEach(c => sbQueueWrite('teacher_pay', `cfg_${c.teacherId}`, c));
  }, [teacherPayConfigs]);
  useEffect(() => {
    safeStorage.setItem('acadamis_teacher_pay_slips', JSON.stringify(teacherPaySlips));
    Object.entries(teacherPaySlips).forEach(([k, v]) => sbQueueWrite('teacher_pay', k, v));
  }, [teacherPaySlips]);
  useEffect(() => {
    safeStorage.setItem('acadamis_school_location', JSON.stringify(schoolLocation));
    sbQueueWrite('school_location', 'global', schoolLocation);
  }, [schoolLocation]);

  const [payYearP, payMonthIdxP] = React.useMemo(() => {
    const parts = payMonthSelP.split('-').map(Number) as [number, number];
    return [parts[0], parts[1] - 1] as [number, number];
  }, [payMonthSelP]);

  const teacherPayslipsMap = React.useMemo(() => {
    const map: Record<string, TeacherPayslip> = {};
    teachers.forEach((t) => {
      const cfg = teacherPayConfigs.find(c => String(c.teacherId) === String(t.id)) || defaultPayConfig(t.id);
      map[t.id] = buildPayslip(t, cfg, allTeacherAttendance, payYearP, payMonthIdxP, teacherPaySlips);
    });
    return map;
  }, [teachers, teacherPayConfigs, allTeacherAttendance, payYearP, payMonthIdxP, teacherPaySlips]);

  const savePayConfig = (updated: TeacherPayConfig) => {
    const existing = teacherPayConfigs.slice();
    const idx = existing.findIndex(c => String(c.teacherId) === String(updated.teacherId));
    if (idx >= 0) existing[idx] = updated; else existing.push(updated);
    setTeacherPayConfigsP(existing);
    setEditingPayTeacherId(null);
    setPayForm(null);
    toast.success('Teacher pay config saved!');
  };

  const markTeacherPaid = (teacherId: string) => {
    const key = `${teacherId}_${payYearP}_${payMonthIdxP}`;
    const prev = { ...teacherPaySlips };
    const existing = prev[key] || teacherPayslipsMap[teacherId];
    prev[key] = {
      ...existing,
      teacherId,
      year: payYearP,
      month: payMonthIdxP,
      paid: true,
      paidDate: new Date().toLocaleDateString(),
    };
    setTeacherPaySlipsP(prev);
    toast.success(`Teacher salary marked PAID for ${monthLabel(payYearP, payMonthIdxP)}`);
  };

  const saveSchoolLocation = () => {
    const lat = Number(locLat);
    const lng = Number(locLng);
    const radius = Number(locRadius);
    if (isNaN(lat) || isNaN(lng) || isNaN(radius) || radius <= 0) {
      toast.error('Valid lat / lng / radius enter karein.');
      return;
    }
    setSchoolLocationP({ lat, lng, radiusMeters: Math.max(1, Math.round(radius)), name: locName.trim() || 'Demo Academy' });
    setShowLocSaved(true);
    setTimeout(() => setShowLocSaved(false), 2500);
    toast.success('School location updated — teachers ka GPS radius ab naye coordinates se check hoga.');
  };

  const openPayEditor = (t: Teacher) => {
    const found = teacherPayConfigs.find(c => String(c.teacherId) === String(t.id)) || defaultPayConfig(t.id);
    setPayForm({ ...found });
    setEditingPayTeacherId(t.id);
  };

  // ===== Notification feed for Principal / Coordinator =====
  const [portalNotifications, setPortalNotifications] = useState<PortalNotification[]>(() => getNotifications());
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  useEffect(() => {
    const syncNotifs = () => setPortalNotifications(getNotifications());
    window.addEventListener('acadamis_new_notification', syncNotifs);
    return () => window.removeEventListener('acadamis_new_notification', syncNotifs);
  }, []);

  const relevantNotifications = React.useMemo(() => {
    return portalNotifications.filter(n =>
      n.role === 'all' || n.role === 'principal' || n.role === 'coordinator'
    );
  }, [portalNotifications]);

  const handleMarkAllRead = () => {
    const updated = portalNotifications.map(n => ({ ...n, isUnread: false }));
    saveNotifications(updated);
    setPortalNotifications(updated);
    toast.success("All notifications marked as read.");
  };

  const handleClearNotifications = () => {
    saveNotifications([]);
    setPortalNotifications([]);
    toast.success("Notification history cleared.");
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setAppSettings(prev => ({ ...prev, [key]: value }));
  };

  // Theme support
  const [darkTheme, setDarkTheme] = useState<boolean>(() => {
    return safeStorage.getItem('acadamis_dark_theme') === 'true';
  });

  // Track global theme triggers in case theme toggles else where
  useEffect(() => {
    const syncTheme = () => {
      setDarkTheme(safeStorage.getItem('acadamis_dark_theme') === 'true');
    };
    window.addEventListener('acadamis_toggle_theme', syncTheme);
    return () => window.removeEventListener('acadamis_toggle_theme', syncTheme);
  }, []);

  const handleToggleTheme = () => {
    const nextVal = !darkTheme;
    setDarkTheme(nextVal);
    safeStorage.setItem('acadamis_dark_theme', String(nextVal));
    window.dispatchEvent(new Event('acadamis_toggle_theme'));
    toast.success(nextVal ? "🌙 Dark theme ho gya!" : "☀️ Light theme ho gya!");
  };

  // Latest-state refs so realtime callbacks never read stale closures
  const classesRef = useRef(classes);
  const teachersRef = useRef(teachers);
  const studentsRef = useRef(students);
  const feeStudentsRef = useRef(feeStudents);
  const attendanceRef = useRef(attendance);
  const timetableRef = useRef(timetable);
  useEffect(() => { classesRef.current = classes; }, [classes]);
  useEffect(() => { teachersRef.current = teachers; }, [teachers]);
  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { feeStudentsRef.current = feeStudents; }, [feeStudents]);
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);
  useEffect(() => { timetableRef.current = timetable; }, [timetable]);

  // Real-time Supabase listener — WebSocket push; doosri devices ki changes turant apply
  useEffect(() => {
    const applyReload = async () => {
      try {
        const [classesData, teachersData, studentsData, feeData, attendanceData, timetableData] = await Promise.all([
          loadCollectionFromSupabase('classes'),
          loadCollectionFromSupabase('teachers'),
          loadCollectionFromSupabase('students'),
          loadCollectionFromSupabase('fee_data'),
          loadCollectionFromSupabase('attendance'),
          loadCollectionFromSupabase('timetable'),
        ]);
        let changed = false;
        if (classesData && listChanged(classesRef.current, classesData)) {
          classesRef.current = classesData;
          setClasses(classesData);
          toast.info('Class assignments updated from Principal portal');
          changed = true;
        }
        if (teachersData && listChanged(teachersRef.current, teachersData)) {
          teachersRef.current = teachersData;
          setTeachers(teachersData);
          toast.info('Teacher list updated from Principal portal');
          changed = true;
        }
        if (studentsData && listChanged(studentsRef.current, studentsData)) {
          studentsRef.current = studentsData;
          setStudents(studentsData);
          toast.info('Student list updated from Principal portal');
          changed = true;
        }
        if (feeData && listChanged(feeStudentsRef.current, feeData)) {
          feeStudentsRef.current = feeData;
          setFeeStudents(feeData);
          changed = true;
        }
        if (attendanceData && listChanged(attendanceRef.current, attendanceData)) {
          attendanceRef.current = attendanceData;
          setAttendance(attendanceData);
          changed = true;
        }
        if (timetableData && listChanged(timetableRef.current, timetableData)) {
          timetableRef.current = timetableData;
          setTimetable(timetableData);
          toast.info('Timetable updated from Principal portal');
          changed = true;
        }
        if (changed) console.log('[Sync:RT] PrincipalDashboard reloaded from Supabase');
      } catch (e: any) {
        console.warn('[Sync:RT] PrincipalDashboard reload failed:', e?.message);
      }
    };

    const handlerRef = { current: applyReload };
    let timer: any = null;
    const unsub = subscribeRecords(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => handlerRef.current(), 300);
    });

    return () => { unsub(); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search/Filter States
  const [teacherSearch, setTeacherSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [coordinatorSearch, setCoordinatorSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('all');
  const [classSearch, setClassSearch] = useState('');
  const [attendanceFilterClass, setAttendanceFilterClass] = useState('all');
  const [attendanceFilterDate, setAttendanceFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceShowAllDates, setAttendanceShowAllDates] = useState(true);
  const [attendanceSearch, setAttendanceSearch] = useState('');
  const [recordsFeeSearch, setRecordsFeeSearch] = useState('');
  const [recordsFeeClassFilter, setRecordsFeeClassFilter] = useState('all');
  const [recordsFeeStatusFilter, setRecordsFeeStatusFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
  const [showQuickCollectModal, setShowQuickCollectModal] = useState(false);
  const [quickCollectStudentId, setQuickCollectStudentId] = useState('');
  const [quickCollectMonth, setQuickCollectMonth] = useState(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);
  const [quickCollectAmount, setQuickCollectAmount] = useState<string>('5500');
  const [quickCollectPaymentMethod, setQuickCollectPaymentMethod] = useState('Cash');
  const [monthFeeInputs, setMonthFeeInputs] = useState<Record<string, string>>({});
  // Month card click -> neeche sirf usi month ki history show ho (History Log filter)
  const [monthHistoryFilter, setMonthHistoryFilter] = useState<{ studentId: string; month: string; year: number } | null>(null);
  // Fee ledger year — year change karo to months dobara Jan se start hote hain
  const [feeLedgerYear, setFeeLedgerYear] = useState<number>(new Date().getFullYear());
  const [quickCollectFeeType, setQuickCollectFeeType] = useState('School NSB Fee');
  const [quickCollectNotes, setQuickCollectNotes] = useState('');
  // Month card ke "Collect" se kholne pe — TARGET month mode: amount usi month mein jaye (auto-spread skip)
  const [quickCollectTargetMonth, setQuickCollectTargetMonth] = useState<string | null>(null);
  const [showExtraFeeInputs, setShowExtraFeeInputs] = useState(false);
const [extraFeeMode, setExtraFeeMode] = useState<'charge' | 'collect'>('collect');
const [extraFees, setExtraFees] = useState<Record<string, string>>({
    'Annual Fee': '',
    'Admission Fee': '',
    'Paper Fund': '',
    'Exam Fee': '',
    'Summer Pack': '',
    'Miscellaneous': ''
});

  // COLLECT DUES FEATURE — track which pending dues to collect + their months
  const [collectDuesList, setCollectDuesList] = useState<Record<string, boolean>>({});
  // Quick Collect modal — monthly/school fee section collapsed by default (form ab DUES-first hai)
  const [showMainFeeSection, setShowMainFeeSection] = useState(false);
  const [qcSearch, setQcSearch] = useState('');
  const [qcReceipt, setQcReceipt] = useState<null | { receiptId: string; studentName: string; total: number; months: string; collected: string; charged: string; method: string; date: string }>(null);
  const [collectDueMonths, setCollectDueMonths] = useState<Record<string, string>>({});
  const [expandedStudentFeeId, setExpandedStudentFeeId] = useState<string | null>(null);

  // Dues Management State
  const [showAddDueModal, setShowAddDueModal] = useState(false);
  const [addDueStudentId, setAddDueStudentId] = useState('');
  const [addDueDesc, setAddDueDesc] = useState('');
  const [addDueAmount, setAddDueAmount] = useState('');
  const [addDueMonth, setAddDueMonth] = useState(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);
  const [duesFilterStatus, setDuesFilterStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [duesFilterClass, setDuesFilterClass] = useState('all');
  // Bulk "Due apply to whole class" — e.g. Paper Fund/Annual Fee sab students pe ek saath
  const [showBulkDueModal, setShowBulkDueModal] = useState(false);
  const [bulkDueClassId, setBulkDueClassId] = useState('all');
  const [bulkDueStudentId, setBulkDueStudentId] = useState('');
  const [bulkDueTarget, setBulkDueTarget] = useState<'class' | 'student'>('class');
  const [bulkDueDesc, setBulkDueDesc] = useState('Paper Fund');
  const [bulkDueAmount, setBulkDueAmount] = useState('');
  const [bulkDueMonth, setBulkDueMonth] = useState(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);

  // Apply due (e.g. Paper Fund) to EVERY student in a class OR a single student
  const handleApplyDueToClass = () => {
    const amt = Number(bulkDueAmount);
    if (!bulkDueDesc.trim() || amt <= 0) {
      toast.error("Enter valid description and amount");
      return;
    }
    if (bulkDueTarget === 'student' && !bulkDueStudentId) {
      toast.error("Please select a student for single-student mode.");
      return;
    }
    const [monthStr, yearStr] = bulkDueMonth.split(' ');
    const yr = Number(yearStr) || new Date().getFullYear();
    // Target: single student → sirf wo; class → us class (ya all) ke students
    const targetStudents = bulkDueTarget === 'student'
      ? students.filter(st => String(st.id) === String(bulkDueStudentId))
      : students.filter(st =>
          bulkDueClassId === 'all' || st.classId === bulkDueClassId
        );
    if (targetStudents.length === 0) {
      toast.error("No students found for this selection.");
      return;
    }
    const alreadyHasIds = new Set(
      feeStudents
        .filter(fs => targetStudents.some(st => String(st.id) === String(fs.id)))
        .flatMap(fs => (fs.dues || [])
          .filter(d => String(d.month).toLowerCase() === String(monthStr).toLowerCase() && Number(d.year) === yr && d.desc?.trim().toLowerCase() === bulkDueDesc.trim().toLowerCase())
          .map(d => String(fs.id))
        )
    );
    let addedCount = 0;
    setFeeStudents(prev => prev.map(fs => {
      if (!targetStudents.some(st => String(st.id) === String(fs.id))) return fs;
      if (alreadyHasIds.has(String(fs.id))) return fs; // skip duplicate for same month+type
      addedCount++;
      const due = {
        id: 'DUE_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
        studentId: fs.id,
        desc: bulkDueDesc.trim(),
        amount: amt,
        date: new Date().toISOString().split('T')[0],
        month: monthStr,
        year: yr,
        status: 'pending' as const,
      };
      return { ...fs, dues: [...(fs.dues || []), due] };
    }));
    setShowBulkDueModal(false);
    setBulkDueDesc('Paper Fund');
    setBulkDueAmount('');
    toast.success(`Applied "${bulkDueDesc.trim()}" PKR ${amt.toLocaleString()} to ${addedCount > 0 ? addedCount : targetStudents.length} ${bulkDueTarget === 'student' ? 'student' : (bulkDueClassId === 'all' ? 'students (all classes)' : 'students (class)')}. Unpaid students ki Remaining/Dues mein show hogi.`);
  };

  const [showMarkAttendanceModal, setShowMarkAttendanceModal] = useState(false);
  const [markAttendanceClassId, setMarkAttendanceClassId] = useState('');
  const [markAttRecords, setMarkAttRecords] = useState<{studentId: string, status: 'present' | 'absent' | 'late' | 'leave'}[]>([]);
  const [attendanceMode, setAttendanceMode] = useState<'grid' | 'list' | 'swipe'>('grid');
  const [activeSwipeIndex, setActiveSwipeIndex] = useState<number>(0);
  const [attendanceDisplayLimit, setAttendanceDisplayLimit] = useState(50);
  const [feesDisplayLimit, setFeesDisplayLimit] = useState(50);
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState<'all' | 'present' | 'absent' | 'late' | 'leave'>('all');

  // Memoized Data & Optimized Lookups for performance
  const studentsMap = React.useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach(s => map.set(String(s.id), s));
    return map;
  }, [students]);

  const teachersMap = React.useMemo(() => {
    const map = new Map<string, Teacher>();
    teachers.forEach(t => map.set(String(t.id), t));
    return map;
  }, [teachers]);

  const coordinatorsMap = React.useMemo(() => {
    const map = new Map<string, Coordinator>();
    coordinators.forEach(c => map.set(String(c.id), c));
    return map;
  }, [coordinators]);

  const timetableMap = React.useMemo(() => {
    const map = new Map<string, TimetableEntry>();
    timetable.forEach(tt => map.set(String(tt.id), tt));
    return map;
  }, [timetable]);

  const feeStudentsMap = React.useMemo(() => {
    const map = new Map<string, StudentFeeData>();
    feeStudents.forEach(fs => map.set(String(fs.id), fs));
    return map;
  }, [feeStudents]);

  const classesMap = React.useMemo(() => {
    const map = new Map<string, Class>();
    classes.forEach(c => map.set(String(c.id), c));
    return map;
  }, [classes]);

  const filteredAttendance = React.useMemo(() => {
    return attendance.filter(record => {
      const student = studentsMap.get(String(record.studentId));
      const sName = (student?.name || (record as any).studentName || '').toLowerCase();
      const matchesClass = attendanceFilterClass === 'all' || student?.classId === attendanceFilterClass;
      const matchesDate = attendanceShowAllDates || record.date === attendanceFilterDate;
      const matchesSearch = !attendanceSearch || sName.includes(attendanceSearch.toLowerCase());
      return matchesClass && matchesDate && matchesSearch;
    }).slice().reverse();
  }, [attendance, studentsMap, attendanceFilterClass, attendanceFilterDate, attendanceShowAllDates, attendanceSearch]);

  const filteredFeesRoster = React.useMemo(() => {
    return students.filter(s => {
      if (recordsFeeClassFilter !== 'all' && s.classId !== recordsFeeClassFilter) return false;
      if (recordsFeeSearch.trim()) {
        const q = recordsFeeSearch.toLowerCase();
        const classObj = classesMap.get(String(s.classId));
        const classNameStr = classObj ? `${classObj.className} ${classObj.section}`.toLowerCase() : '';
        if (!s.name.toLowerCase().includes(q) && !(s.rollNumber && s.rollNumber.toLowerCase().includes(q)) && !classNameStr.includes(q)) return false;
      }
      if (recordsFeeStatusFilter !== 'all') {
        const fStudent = feeStudents.find(fs => String(fs.id) === String(s.id));
        if (fStudent) {
          const pending = getTotalPending(fStudent) + getTotalOtherFunds(fStudent);
          const collected = fStudent.payments.reduce((sum, p) => sum + p.amount, 0);
          const status = pending <= 0 ? 'paid' : collected > 0 ? 'partial' : 'unpaid';
          if (status !== recordsFeeStatusFilter) return false;
        } else {
          if (recordsFeeStatusFilter !== 'unpaid') return false;
        }
      }
      return true;
    });
  }, [students, classesMap, recordsFeeClassFilter, recordsFeeSearch, recordsFeeStatusFilter, feeStudents]);

  const visibleAttendance = React.useMemo(() => {
    return filteredAttendance.slice(0, attendanceDisplayLimit);
  }, [filteredAttendance, attendanceDisplayLimit]);

  // When a specific class is selected, show EXACTLY that class's students for
  // the selected date (one row per student) instead of all-date history, so the
  // principal always sees the real class size.
  const attendanceRosterRows = React.useMemo(() => {
    if (attendanceFilterClass === 'all') return [];
    const classStudents = students.filter(s => s.classId === attendanceFilterClass);
    const dateMap = new Map<string, Attendance>();
    attendance.forEach(a => {
      if (a.date === attendanceFilterDate) dateMap.set(String(a.studentId), a);
    });
    const q = (attendanceSearch || '').toLowerCase();
    return classStudents
      .filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.rollNumber || '').toLowerCase().includes(q))
      .map(s => ({ student: s, record: dateMap.get(String(s.id)) || null, isRoster: true }));
  }, [attendanceFilterClass, students, attendance, attendanceFilterDate, attendanceSearch]);

  // Unified rows used by the attendance ledger (mobile cards + desktop table).
  const attendanceDisplayRows = React.useMemo(() => {
    let rows;
    if (attendanceFilterClass !== 'all') {
      rows = attendanceRosterRows;
    } else {
      rows = filteredAttendance.slice(0, attendanceDisplayLimit).map(record => {
        const student = studentsMap.get(String(record.studentId));
        return { student, record, isRoster: false };
      });
    }
    
    // Apply status filter
    if (attendanceStatusFilter !== 'all') {
      rows = rows.filter(row => {
        const status = row.record?.status || 'unmarked';
        return status === attendanceStatusFilter;
      });
    }
    
    return rows;
  }, [attendanceFilterClass, attendanceRosterRows, filteredAttendance, attendanceDisplayLimit, studentsMap, attendanceStatusFilter]);


  const formatDateDDMMYY = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  };
  // Collect a single due (Paper Fund, Exam Fee, etc.) — PARTIAL payment supported.
  // amountToCollect = kitna amount ab is baar collect ho raha hai (remaining se zyada nahi).
  const collectDue = (
    prev: StudentFeeData[],
    studentId: string,
    dueId: string,
    amountToCollect: number,
    paymentMethod: string,
    today: string
  ): StudentFeeData[] => {
    return prev.map(fs => {
      if (String(fs.id) === String(studentId)) {
        const updatedDues = (fs.dues || []).map(d => {
          if (d.id !== dueId) return d;
          const already = getDuePaid(d);
          const maxAdd = Math.max(0, (Number(d.amount) || 0) - already);
          const toAdd = Math.max(0, Math.min(Number(amountToCollect) || 0, maxAdd));
          if (toAdd <= 0) return d;
          const newPaid = already + toAdd;
          const fullyPaid = newPaid >= (Number(d.amount) || 0);
          return {
            ...d,
            paidAmount: newPaid,
            status: fullyPaid ? ('paid' as const) : ('pending' as const),
            paidDate: today,
            paymentMethod,
          };
        });
        return { ...fs, dues: updatedDues };
      }
      return fs;
    });
  };



  const handleRecordQuickFee = () => {
    if (!quickCollectStudentId) {
      toast.error("Please select a student first.");
      return;
    }

    const studentObj = students.find(s => String(s.id) === String(quickCollectStudentId));
    const feeStudentObj = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
    const studentName = studentObj?.name || feeStudentObj?.name || 'Student';
    const month = quickCollectMonth || `${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`;
    const year = parseMonthKey(month, new Date().getFullYear()).year;
    const today = new Date().toISOString().split('T')[0];

    type FeeEntry = { feeType: string; amount: number };
    const entries: FeeEntry[] = [];

    // Selected pending dues (checklist se) — pehle compute karo taake validation ho sake
    const preSelectedDueIds = Object.entries(collectDuesList).filter(([, selected]) => selected).map(([id]) => id);

    const mainAmount = Number(quickCollectAmount);
    // Main monthly fee — section ab HAMESHA visible (lazmi); month-card target mode bhi support
    if (mainAmount && mainAmount > 0) {
      entries.push({ feeType: quickCollectFeeType, amount: mainAmount });
    }

    if (showExtraFeeInputs) {
      Object.entries(extraFees).forEach(([type, amt]) => {
        const n = Number(amt);
        if (n && n > 0) entries.push({ feeType: type, amount: n });
      });
    }

    if (entries.length === 0 && preSelectedDueIds.length === 0) {
      toast.error("Koi due select nahi kiya — Pending Dues se select karein ya fee amount enter karein.");
      return;
    }

    const newFeeRecords: FeeRecord[] = [];
    const newPayments: { id: string; month: string; year: number; amount: number; date: string; feeType: string }[] = [];
    // Extra fee categories (Annual Fee, Paper Fund, Exam Fee, etc.) ko Dues mein bhi
    // record karo taake Dues Management + Home pe show hon
    const newDues: DueEntry[] = [];
    // Also: pending target-month due collections (dueId → amount to collect) jab month-card se collect karo
    const targetDueCollects: { dueId: string; amount: number }[] = [];
    const monthsCovered = new Set<string>();
    let recSeq = 0;
    const makeId = () => 'REC_' + Date.now().toString(36).toUpperCase() + '_' + (recSeq++).toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
    const pushForMonth = (feeType: string, amount: number, recMonth: string, recYear: number) => {
      const id = makeId();
      newFeeRecords.push({
        id,
        studentId: quickCollectStudentId,
        amount,
        dueDate: today,
        status: 'paid',
        paidDate: today,
        month: recMonth,
        paymentMethod: quickCollectPaymentMethod,
        feeType,
        description: quickCollectNotes || undefined,
      });
      newPayments.push({ id, month: recMonth, year: recYear, amount, date: today, feeType });
      // Extra categories (non-tuition) → Dues Entry bhi banao (PAID) — Dues section + Home mein dikhegi
      if (!isTuitionFeeType(feeType)) {
        newDues.push({
          id,
          studentId: quickCollectStudentId,
          desc: feeType,
          amount,
          date: today,
          month: recMonth,
          year: recYear,
          status: 'paid' as const,
          paidDate: today,
          paymentMethod: quickCollectPaymentMethod,
        });
      }
      monthsCovered.add(`${recMonth} ${recYear}`);
    };

    entries.forEach(entry => {
      // Tuition/School Fee → amount ko ALLOCATE karo. Normal mode: AUTO-SPREAD (purane pending
      // months pehle). TARGET-month mode (month card ke Collect se): sirf us month mein jaye +
      // us month ke pending dues/paper fund bhi amount se auto-collect hon.
      if (isTuitionFeeType(entry.feeType)) {
        const baseFee = Math.max(0, Number(studentObj?.baseFee ?? feeStudentObj?.monthlyFee ?? 0));
        if (quickCollectTargetMonth) {
          // --- TARGET MONTH MODE ---
          const tKey = parseMonthKey(quickCollectTargetMonth, year);
          const tIdx = tKey.idx;
          // Tuition paid in this target month
          const tTuitionPaid = (feeStudentObj?.payments || [])
            .filter(p => {
              const pk = parseMonthKey(p.month, Number(p.year) || year);
              return pk.idx === tIdx && pk.year === tKey.year && (!p.feeType || TUITION_FEE_TYPES.test(p.feeType));
            })
            .reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const tTuitionRemaining = Math.max(0, baseFee - tTuitionPaid);
          // Pehle is month ka tuition remaining bharo
          const toTuition = Math.min(entry.amount, tTuitionRemaining);
          if (toTuition > 0) {
            pushForMonth(entry.feeType, toTuition, month, year);
          }
          let remainingAfterTuition = entry.amount - toTuition;
          // Baqi amount se is month ke PENDING DUES (Paper Fund, Exam Fee, etc.) collect karo
          if (remainingAfterTuition > 0 && feeStudentObj) {
            const tMonthDues = (feeStudentObj.dues || []).filter(d => {
              const dk = parseMonthKey(d.month, d.year || year);
              return dk.idx === tIdx && dk.year === tKey.year && getDueRemaining(d) > 0;
            });
            for (const due of tMonthDues) {
              if (remainingAfterTuition <= 0) break;
              const dueRemaining = getDueRemaining(due);
              const toDue = Math.min(remainingAfterTuition, dueRemaining);
              if (toDue <= 0) continue;
              targetDueCollects.push({ dueId: due.id, amount: toDue });
              const recId = makeId();
              newFeeRecords.push({
                id: recId,
                studentId: quickCollectStudentId,
                amount: toDue,
                dueDate: today,
                status: 'paid',
                paidDate: today,
                month,
                paymentMethod: quickCollectPaymentMethod,
                feeType: due.desc,
                dueId: due.id,
                description: `Collected: ${due.desc}`,
              });
              monthsCovered.add(`${month} ${year}`);
              remainingAfterTuition -= toDue;
            }
          }
          // Agar kuch bhi bacha ho → selected month mein advance / extra
          if (remainingAfterTuition > 0) {
            pushForMonth(entry.feeType, remainingAfterTuition, month, year);
          }
        } else {
          // --- NORMAL AUTO-SPREAD: ek amount sary pending months me khud batt jata hai ---
          const allocs = buildTuitionAllocation(feeStudentObj, studentObj, entry.amount, year);
          let allocated = 0;
          allocs.forEach(a => {
            pushForMonth(entry.feeType, a.amount, a.month, a.year);
            allocated += a.amount;
          });
          const leftover = entry.amount - allocated;
          if (leftover > 0) pushForMonth(entry.feeType, leftover, month, year);
        }
      } else if (extraFeeMode === 'charge') {
        // CHARGE mode: not immediately PAID — a PENDING entry is added to student's Dues.
        // Those who haven't paid will show in Remaining/Pending.
        // Later cleared via Dues Management "Mark as Paid".
        const id = makeId();
        newDues.push({
          id,
          studentId: quickCollectStudentId,
          desc: entry.feeType,
          amount: entry.amount,
          date: today,
          month,
          year,
          status: 'pending' as const,
        });
        monthsCovered.add(`${month} ${year}`);
      } else {
        // COLLECT mode: foran collection — paid receipt + payment + paid dues entry
        pushForMonth(entry.feeType, entry.amount, month, year);
      }
    });

    // COLLECT SELECTED DUES — mark pending dues as paid (manual checkbox list)
    const selectedDueIds = Object.entries(collectDuesList).filter(([, selected]) => selected).map(([id]) => id);
    // Merge target-month auto-collect + manual selected dues: dueId → amount
    const dueCollectMap = new Map<string, number>();
    targetDueCollects.forEach(t => dueCollectMap.set(t.dueId, (dueCollectMap.get(t.dueId) || 0) + t.amount));
    selectedDueIds.forEach(id => {
      const dueObj = feeStudentObj?.dues?.find(d => d.id === id);
      if (dueObj) dueCollectMap.set(id, getDueRemaining(dueObj));
    });
    if (dueCollectMap.size > 0 && feeStudentObj) {
      setFeeStudents(prev => prev.map(fs => {
        if (String(fs.id) === String(quickCollectStudentId)) {
          const updatedDues = (fs.dues || []).map(d => {
            const collectAmt = dueCollectMap.get(d.id);
            if (!collectAmt || collectAmt <= 0) return d;
            const already = getDuePaid(d);
            const maxAdd = Math.max(0, (Number(d.amount) || 0) - already);
            const toAdd = Math.min(collectAmt, maxAdd);
            if (toAdd <= 0) return d;
            const newPaid = already + toAdd;
            const fullyPaid = newPaid >= (Number(d.amount) || 0);
            // Create fee record for this due collection (agar targetDueCollects se nahi bana)
            if (!newFeeRecords.some(r => r.dueId === d.id)) {
              const recId = makeId();
              newFeeRecords.push({
                id: recId,
                studentId: quickCollectStudentId,
                amount: toAdd,
                dueDate: today,
                status: 'paid',
                paidDate: today,
                month: d.month,
                paymentMethod: quickCollectPaymentMethod,
                feeType: d.desc,
                dueId: d.id,
                description: `Collected: ${d.desc}`,
              });
            }
            monthsCovered.add(`${d.month} ${d.year}`);
            return { ...d, paidAmount: newPaid, status: fullyPaid ? ('paid' as const) : ('pending' as const), paidDate: today, month: d.month };
          });
          return { ...fs, dues: updatedDues };
        }
        return fs;
      }));
    }

    setFees(prev => [...newFeeRecords, ...prev]);

    if (feeStudentObj) {
      setFeeStudents(prev => prev.map(fs => {
        if (String(fs.id) === String(quickCollectStudentId)) {
          return {
            ...fs,
            payments: [
              ...(fs.payments || []),
              ...newPayments
            ],
            dues: [
              ...(fs.dues || []),
              ...newDues
            ]
          };
        }
        return fs;
      }));
    }

    setQuickCollectNotes('');
    setQuickCollectTargetMonth(null);
    setShowExtraFeeInputs(false);
    setShowMainFeeSection(false);
    setCollectDuesList({});
    setExtraFees({ 'Annual Fee': '', 'Admission Fee': '', 'Paper Fund': '', 'Exam Fee': '', 'Summer Pack': '', 'Miscellaneous': '' });
    const chargedCategories = Array.from(new Set(newDues.filter(d => d.status === 'pending').map(d => d.desc)));
    const collectedCategories = Array.from(new Set(newFeeRecords.map(r => r.feeType)));
    const monthsText = Array.from(monthsCovered).join(', ');
    const summaryParts: string[] = [];
    if (chargedCategories.length > 0) summaryParts.push(`Charged (Dues): ${chargedCategories.join(', ')}`);
    if (collectedCategories.length > 0) summaryParts.push(`Collected: ${collectedCategories.join(', ')}`);
    toast.success(`${summaryParts.join(' • ')} — ${studentName}${monthsText ? ` (${monthsText})` : ''}${collectedCategories.length > 0 ? ` Receipt #${newFeeRecords[0].id}` : ''}`);
    // SUCCESS RECEIPT VIEW — modal band karne ke bajaye receipt dikhao (Naya Student / WhatsApp / Close)
    if (newFeeRecords.length > 0) {
      setQcReceipt({
        receiptId: newFeeRecords[0].id,
        studentName,
        total: newFeeRecords.reduce((s, r) => s + (Number(r.amount) || 0), 0),
        months: monthsText,
        collected: collectedCategories.join(', ') || '—',
        charged: chargedCategories.join(', ') || '',
        method: quickCollectPaymentMethod,
        date: today,
      });
    } else {
      setShowQuickCollectModal(false);
    }
    
    // Send WhatsApp notification for fee collection
    if (appSettings.whatsAppAutoFee && studentObj?.parentPhone) {
      // CHARGE mode → charge alert (dues add hui); COLLECT mode → payment-received message
      if (extraFeeMode === 'charge' && newFeeRecords.length === 0) {
        const chargeTotal = newDues.filter(d => d.status === 'pending').reduce((s, d) => s + d.amount, 0);
        if (chargeTotal > 0) {
          handleSendFeeNotification(studentObj, 'charge', chargeTotal, chargedCategories.join(', '));
        }
      } else {
      const totalAmount = newFeeRecords.reduce((sum, r) => sum + r.amount, 0);
      const fStudent = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
      let totalPending = fStudent ? getTotalPending(fStudent) + getTotalOtherFunds(fStudent) : 0;
      totalPending = Math.max(0, totalPending - totalAmount);
      
      const classId = studentObj?.classId;
      const sClass = classId ? classes.find(c => c.id === classId) : null;
      const className = sClass ? `${sClass.className} - ${sClass.section}` : 'N/A';
      
      const periodText = monthsText ? ` for ${monthsText}` : ` for ${month}`;
      const template = `Greetings! We have received a payment of PKR ${totalAmount.toLocaleString()}${periodText} (${collectedCategories.join(', ')}) from ${studentName} (${className}). Your remaining balance is PKR ${totalPending.toLocaleString()}. Thank you for your cooperation. Demo School.`;
      
      const phone = studentObj.parentPhone.replace(/\D/g, '');
      let countryCodePhone = phone;
      if (countryCodePhone.startsWith('0')) {
        countryCodePhone = '92' + countryCodePhone.substring(1);
      } else if (!countryCodePhone.startsWith('92') && countryCodePhone.length === 10) {
        countryCodePhone = '92' + countryCodePhone;
      }
      
      const waUrl = `https://wa.me/${countryCodePhone}?text=${encodeURIComponent(template)}`;
      if (appSettings.autoWhatsAppRedirect) {
        window.open(waUrl, '_blank');
      }
      }
    }
  };

  // ===== FEE PAYMENT CENTER — state + handlers =====
  const [showFeePaymentCenter, setShowFeePaymentCenter] = useState(false);
  const [feePaymentCenterStudentId, setFeePaymentCenterStudentId] = useState<string | undefined>(undefined);

  const openFeePaymentCenter = (studentId?: string) => {
    setFeePaymentCenterStudentId(studentId);
    setShowFeePaymentCenter(true);
  };

  const fpcMakeId = (seq: number = 0) => 'REC_' + Date.now().toString(36).toUpperCase() + '_' + seq.toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase();

  const fpcNotifyWhatsApp = (studentId: string | number, totalAmount: number, categoriesText: string, periodText: string) => {
    const studentObj = students.find(s => String(s.id) === String(studentId));
    if (!appSettings.whatsAppAutoFee || !studentObj?.parentPhone) return;
    const fStudent = feeStudents.find(fs => String(fs.id) === String(studentId));
    const totalPending = Math.max(0, (fStudent ? getTotalPending(fStudent) + getTotalOtherFunds(fStudent) : 0));
    const classId = studentObj?.classId;
    const sClass = classId ? classes.find(c => c.id === classId) : null;
    const className = sClass ? `${sClass.className} - ${sClass.section}` : 'N/A';
    const template = `Greetings! We have received a payment of PKR ${totalAmount.toLocaleString()}${periodText ? ` for ${periodText}` : ''} (${categoriesText}) from ${studentObj.name} (${className}). Your remaining balance is PKR ${totalPending.toLocaleString()}. Thank you for your cooperation. Demo School.`;
    const phone = String(studentObj.parentPhone).replace(/\D/g, '');
    let countryCodePhone = phone;
    if (countryCodePhone.startsWith('0')) {
      countryCodePhone = '92' + countryCodePhone.substring(1);
    } else if (!countryCodePhone.startsWith('92') && countryCodePhone.length === 10) {
      countryCodePhone = '92' + countryCodePhone;
    }
    const waUrl = `https://wa.me/${countryCodePhone}?text=${encodeURIComponent(template)}`;
    if (appSettings.autoWhatsAppRedirect) {
      window.open(waUrl, '_blank');
    }
  };

  // ===== CLASS-LEVEL APPLY DUES — poori class ya selected students ko due/paper fund lagao ya collect karo =====
  const openClassDuesModal = (classId?: string) => {
    setClassDuesClassId(classId || 'all');
    setClassDuesSelected({});
    setClassDuesDesc('Paper Fund');
    setClassDuesAmount('');
    setClassDuesMode('charge');
    setClassDuesMonth(MONTHS[new Date().getMonth()] as string);
    setClassDuesYear(new Date().getFullYear());
    setClassDuesPaymentMethod('Cash');
    setClassDuesCollectAmount('');
    setShowClassDuesModal(true);
  };

  const handleSubmitClassDues = () => {
    const amount = Number(classDuesAmount) || 0;
    const selectedIds = Object.entries(classDuesSelected).filter(([, v]) => v).map(([id]) => id)
      .filter(id => students.some(s => String(s.id) === id && (classDuesClassId === 'all' || s.classId === classDuesClassId)));
    if (selectedIds.length === 0) { toast.error('Kam az kam aik student select karein.'); return; }
    if (!(amount > 0)) { toast.error('Sahi amount enter karein (PKR).'); return; }
    const collected = classDuesMode === 'collect' ? Math.max(0, Number(classDuesCollectAmount !== '' ? classDuesCollectAmount : classDuesAmount) || 0) : 0;
    if (classDuesMode === 'collect' && collected > amount) { toast.error('Collect amount, due amount se zyada nahi ho sakta.'); return; }
    const today = new Date().toISOString().split('T')[0];
    let seq = 0;
    const newRecords: FeeRecord[] = [];
    let classDuesCollectedCount = 0;
    setFeeStudents(prev => prev.map(fs => {
      if (!selectedIds.includes(String(fs.id))) return fs;
      const id = 'DUE_' + Date.now().toString(36).toUpperCase() + '_' + (seq++).toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();
      const isCollect = classDuesMode === 'collect';
      const toCollect = Math.min(collected, amount);
      const fullyPaid = isCollect && toCollect >= amount;
      const dueEntry: DueEntry = {
        id,
        studentId: fs.id,
        desc: classDuesDesc,
        amount,
        date: today,
        month: classDuesMonth,
        year: classDuesYear,
        status: isCollect && fullyPaid ? ('paid' as const) : ('pending' as const),
        paidAmount: isCollect ? toCollect : 0,
        paidDate: isCollect && toCollect > 0 ? today : undefined,
        paymentMethod: isCollect && toCollect > 0 ? classDuesPaymentMethod : undefined,
      };
      if (isCollect && toCollect > 0) {
        classDuesCollectedCount++;
        newRecords.push({
          id,
          studentId: String(fs.id),
          amount: toCollect,
          dueDate: today,
          status: 'paid',
          paidDate: today,
          month: `${classDuesMonth} ${classDuesYear}`,
          paymentMethod: classDuesPaymentMethod,
          feeType: classDuesDesc,
          dueId: id,
          description: `Class dues collect: ${classDuesDesc}`,
        });
      }
      return { ...fs, dues: [...(fs.dues || []), dueEntry] };
    }));
    if (newRecords.length > 0) setFees(prev => [...newRecords, ...prev]);
    setShowClassDuesModal(false);
    const classText = classDuesClassId === 'all' ? 'ALL CLASSES' : getClassName(classDuesClassId);
    if (classDuesMode === 'charge') {
      toast.success(`"${classDuesDesc}" (PKR ${amount.toLocaleString()}) charged to ${selectedIds.length} students — ${classText} • ${classDuesMonth} ${classDuesYear} — Dues mein pending hai`);
    } else if (newRecords.length === 0) {
      toast.info(`"${classDuesDesc}" charged to ${selectedIds.length} students — collect amount 0 tha, Dues mein pending hai`);
    } else {
      const pendingText = collected < amount ? ` • har student ka PKR ${(amount - collected).toLocaleString()} pending` : ' — FULLY PAID ✓';
      toast.success(`Collected PKR ${collected.toLocaleString()} "${classDuesDesc}" from ${classDuesCollectedCount} students (${classText})${pendingText}`);
    }
  };

  // Month ki fee record karo (Fee Payment Center se)
  const handleFpcPayMonth = (studentId: string | number, monthKey: string, payYear: number, amount: number, method: string) => {
    const monthName = String(monthKey).split(' ')[0] || String(monthKey);
    const today = new Date().toISOString().split('T')[0];
    const recId = fpcMakeId();
    setFeeStudents(prev => prev.map(fs => {
      if (String(fs.id) !== String(studentId)) return fs;
      return { ...fs, payments: [...(fs.payments || []), { id: recId, month: monthName, year: payYear, amount, date: today, feeType: 'School Fee' }] };
    }));
    setFees(prev => [{
      id: recId, studentId: String(studentId), amount, dueDate: today, status: 'paid' as const, paidDate: today,
      month: `${monthName} ${payYear}`, paymentMethod: method, feeType: 'School Fee', description: 'Fee Payment Center — month fee'
    }, ...prev]);
    const sName = students.find(s => String(s.id) === String(studentId))?.name || 'Student';
    toast.success(`PKR ${amount.toLocaleString()} received — ${monthName} ${payYear} fee ✓ ${sName} (Receipt #${recId})`);
    fpcNotifyWhatsApp(studentId, amount, 'School Fee', `${monthName} ${payYear}`);
  };

  // Due (Paper Fund, Exam Fee, Other Fund...) collect karo — partial supported
  const handleFpcCollectDue = (studentId: string | number, dueId: string, amount: number, method: string) => {
    const today = new Date().toISOString().split('T')[0];
    const fStudent = feeStudents.find(fs => String(fs.id) === String(studentId));
    const dueObj = fStudent?.dues?.find(d => d.id === dueId);
    if (!dueObj) { toast.error('Due entry nahi mili.'); return; }
    const recId = fpcMakeId();
    setFeeStudents(prev => prev.map(fs => {
      if (String(fs.id) !== String(studentId)) return fs;
      return {
        ...fs,
        dues: (fs.dues || []).map(d => {
          if (d.id !== dueId) return d;
          const already = getDuePaid(d);
          const maxAdd = Math.max(0, (Number(d.amount) || 0) - already);
          const toAdd = Math.min(amount, maxAdd);
          if (toAdd <= 0) return d;
          const newPaid = already + toAdd;
          const fullyPaid = newPaid >= (Number(d.amount) || 0);
          return { ...d, paidAmount: newPaid, status: fullyPaid ? ('paid' as const) : ('pending' as const), paidDate: today, paymentMethod: method };
        })
      };
    }));
    setFees(prev => [{
      id: recId, studentId: String(studentId), amount, dueDate: today, status: 'paid' as const, paidDate: today,
      month: dueObj.month, paymentMethod: method, feeType: dueObj.desc, dueId, description: `Collected: ${dueObj.desc}`
    }, ...prev]);
    const sNameC = fStudent?.name || students.find(s => String(s.id) === String(studentId))?.name || 'Student';
    const newRemaining = Math.max(0, (Number(dueObj.amount) || 0) - (getDuePaid(dueObj) + amount));
    toast.success(`PKR ${amount.toLocaleString()} collected — "${dueObj.desc}" ✓ ${sNameC}${newRemaining > 0 ? ` — PKR ${newRemaining.toLocaleString()} pending` : ' — DUE FULLY PAID ✓'} (Receipt #${recId})`);
    fpcNotifyWhatsApp(studentId, amount, dueObj.desc, `${dueObj.month} ${dueObj.year}`);
  };

  // Total remaining tuition — purane pending months (oldest first) mein auto-spread
  const handleFpcPayAutoSpread = (studentId: string | number, amount: number, method: string) => {
    const studentObj = students.find(s => String(s.id) === String(studentId));
    const fsObj = feeStudents.find(fs => String(fs.id) === String(studentId));
    const payYear = new Date().getFullYear();
    const allocs = buildTuitionAllocation(fsObj, studentObj, amount, payYear);
    if (allocs.length === 0) { toast.error('Allocation fail — base fee ya amount check karein.'); return; }
    const today = new Date().toISOString().split('T')[0];
    const newFeeRecords: FeeRecord[] = [];
    const newPayments: { id: string; month: string; year: number; amount: number; date: string; feeType: string }[] = [];
    allocs.forEach((a, i) => {
      const id = fpcMakeId(i);
      newFeeRecords.push({
        id, studentId: String(studentId), amount: a.amount, dueDate: today, status: 'paid', paidDate: today,
        month: `${a.month} ${a.year}`, paymentMethod: method, feeType: 'School Fee', description: 'Fee Payment Center — auto-spread'
      });
      newPayments.push({ id, month: a.month, year: a.year, amount: a.amount, date: today, feeType: 'School Fee' });
    });
    setFeeStudents(prev => prev.map(fs => String(fs.id) === String(studentId) ? { ...fs, payments: [...(fs.payments || []), ...newPayments] } : fs));
    setFees(prev => [...newFeeRecords, ...prev]);
    const monthsText = allocs.map(a => a.month).join(', ');
    const sName = studentObj?.name || fsObj?.name || 'Student';
    toast.success(`PKR ${amount.toLocaleString()} received ✓ ${sName} — spread across: ${monthsText} (Receipt #${newFeeRecords[0].id})`);
    fpcNotifyWhatsApp(studentId, amount, 'School Fee', monthsText);
  };

  // Open the quick collect modal pre-filled for ONE month's remaining balance
  const openQuickCollectForMonth = (studentId: string, month: string, year: number, amount: number) => {
    const monthKey = `${month} ${year}`;
    const safeAmount = Math.max(0, Number(amount) || 0);
    setQuickCollectStudentId(studentId);
    setQuickCollectMonth(monthKey);
    setQuickCollectAmount(String(safeAmount));
    setMonthFeeInputs({ [monthKey]: String(safeAmount) });
    // TARGET month mode ON — amount isi month mein jayega, purane pending months mein nahi
    setQuickCollectTargetMonth(monthKey);
    setQuickCollectNotes('');
    setShowExtraFeeInputs(false);
    setCollectDuesList({});
    setShowMainFeeSection(true);
    setExtraFees({ 'Annual Fee': '', 'Admission Fee': '', 'Paper Fund': '', 'Exam Fee': '', 'Summer Pack': '', 'Miscellaneous': '' });
    setShowQuickCollectModal(true);
  };
 
  // Delete EVERY payment recorded for a given month (fee engine + legacy ledger stay in sync)
  const deleteMonthPayments = (studentId: string, month: string, year: number) => {
    const monthKey = `${month} ${year}`;
    if (!window.confirm(`Delete all ${monthKey} fee payments & dues for this student?`)) return;
    const monthIdx = MONTH_ALIAS[String(month).toLowerCase()] ?? -1;
    setFeeStudents(prev => prev.map(fs => {
      if (String(fs.id) === String(studentId)) {
        return {
          ...fs,
          payments: fs.payments.filter(p => {
            const key = parseMonthKey(p.month, Number(p.year) || year);
            return !(key.idx === monthIdx && key.year === Number(year));
          }),
          // FIX: dues bhi delete karo (Paper Fund/Exam Fee etc. jo is month par lage the) —
          // warna month delete ke baad "Paper Fund (Pending)" wapas dikhta rehta tha
          dues: fs.dues.filter(d => {
            const key = parseMonthKey(d.month, d.year || year);
            return !(key.idx === monthIdx && key.year === Number(year));
          }),
        };
      }
      return fs;
    }));
    setFees(prev => prev.filter(f => {
      const key = parseMonthKey(f.month, Number(String(f.dueDate || '').split('-')[0]) || year);
      return !(String(f.studentId) === String(studentId) && key.idx === monthIdx && key.year === Number(year));
    }));
    setMonthFeeInputs(prev => { const n = {...prev}; delete n[monthKey]; return n; });
    toast.success(`${monthKey} fee payments deleted.`);
  };

  // PRINCIPAL ATTENDANCE MARKING ENGINE
  useEffect(() => {
    if (showMarkAttendanceModal && markAttendanceClassId) {
      const classStudents = students.filter(s => s.classId === markAttendanceClassId);
      setMarkAttRecords(classStudents.map(s => ({
        studentId: s.id,
        status: 'present'
      })));
    }
  }, [markAttendanceClassId, showMarkAttendanceModal, students]);



  const handleImportJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        // Basic validation
        if (!data.students || !data.teachers || !data.classes) {
          throw new Error("Invalid backup file format. Essential data missing.");
        }

        // Confirm with user
        const confirmResult = window.confirm("WARNING: Uploading this backup will overwrite ALL current school records. Are you sure you want to proceed?");
        if (!confirmResult) return;

        // Systematic update
        if (data.students) setStudents(data.students);
        if (data.teachers) setTeachers(data.teachers);
        if (data.classes) setClasses(data.classes);
        if (data.attendance) setAttendance(data.attendance);
        if (data.fees) setFees(data.fees);
        if (data.coordinators) setCoordinators(data.coordinators);
        if (data.marks) setMarks(data.marks);
        if (data.timetable) setTimetable(data.timetable);
        if (data.feeStudents) setFeeStudents(data.feeStudents);
        if (data.appSettings) setAppSettings(data.appSettings);

        toast.success("System database restored successfully from backup!");
      } catch (err: any) {
        toast.error(`Import Failed: ${err.message || 'Unknown error'}`);
        console.error("Import error:", err);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be uploaded again
    event.target.value = '';
  };

  const handleDownloadJSON = () => {
    const confirmResult = window.confirm("Download all school data as a backup file?");
    if (!confirmResult) return;

    try {
      const exportData = {
        exportDate: new Date().toISOString(),
        appName: 'NSB Academy Manager',
        students,
        teachers,
        classes,
        attendance,
        fees,
        coordinators,
        marks,
        timetable,
        feeStudents,
        appSettings
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `nsb_backup_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded successfully!");
    } catch (err: any) {
      toast.error("Download failed: " + err.message);
    }
  };

  const handlePrincipalMarkAttendance = () => {
    if (!markAttendanceClassId) {
      toast.error("Please select a class first.");
      return;
    }

    const newRecords: Attendance[] = markAttRecords.map(rec => ({
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      studentId: rec.studentId,
      status: rec.status,
      date: attendanceFilterDate,
    }));

    // Remove existing records for same date/students to avoid duplicates
    const studentIds = markAttRecords.map(r => r.studentId);
    setAttendance(prev => [
      ...prev.filter(a => !(a.date === attendanceFilterDate && studentIds.includes(a.studentId))),
      ...newRecords
    ]);
    
    setShowMarkAttendanceModal(false);
    toast.success(`Attendance marked for ${markAttendanceClassId} on ${attendanceFilterDate}`);
  };

  const handleRosterAttendanceChange = (student: Student, status: 'present' | 'absent' | 'late' | 'leave') => {
    setAttendance(prev => {
      const existing = prev.find(a => String(a.studentId) === String(student.id) && a.date === attendanceFilterDate);
      if (existing) {
        return prev.map(a => a.id === existing.id ? { ...a, status, markedBy: userSession.name } : a);
      }
      return [...prev, {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        studentId: student.id,
        status,
        date: attendanceFilterDate,
        markedBy: userSession.name,
      }];
    });
    toast.success(`Marked ${student.name} as ${status.toUpperCase()} for ${attendanceFilterDate}`);
  };

  const handleSendIndividualWhatsApp = (student: Student, date: string) => {
    const sClass = classes.find(c => c.id === student.classId);
    const className = sClass ? `${sClass.className} - ${sClass.section}` : 'N/A';

    const template = appSettings.absentTemplate || 
      "Greetings, Respected Parent! We noticed that your child {student_name} (Roll: {roll_number}) has been marked ABSENT on date {date}. Kindly clarify the reason or contact the school office. Principal.";
    
    const message = template
      .replace(/{student_name}/g, student.name)
      .replace(/{name}/g, student.name)
      .replace(/{class_name}/g, className)
      .replace(/{roll_number}/g, student.rollNumber || 'N/A')
      .replace(/{date}/g, date);

    const phone = student.parentPhone || student.studentPhone || '';
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (!cleanPhone) {
      toast.error(`No phone number found for ${student.name}. Please add it in student profile.`);
      return;
    }

    let countryCodePhone = cleanPhone;
    if (countryCodePhone.startsWith('0')) {
      countryCodePhone = '92' + countryCodePhone.substring(1);
    } else if (!countryCodePhone.startsWith('92') && countryCodePhone.length === 10) {
      countryCodePhone = '92' + countryCodePhone;
    }

    const waUrl = `https://wa.me/${countryCodePhone}?text=${encodeURIComponent(message)}`;
    
    if (appSettings.autoWhatsAppRedirect) {
      window.open(waUrl, '_blank');
      toast.success(`Opening WhatsApp for ${student.name}'s parent`);
    } else {
      toast.custom(
        (t) => (
          <div className="flex items-center gap-3 bg-white text-slate-900 p-4 rounded-xl shadow-xl border border-slate-200">
            <span className="text-xs font-bold">Message ready for {student.name}</span>
            <button 
              onClick={() => {
                window.open(waUrl, '_blank');
                toast.dismiss(t);
              }}
              className="bg-amber-600 text-white px-3 py-1 rounded-md text-xs font-black uppercase cursor-pointer"
            >
              Send
            </button>
          </div>
        )
      );
    }
  };

  const handlePrintSummary = () => {
    window.print();
  };



  const handleSendFeeNotification = (student: Student | StudentFeeData, type: 'payment' | 'charge' | 'reminder', amount: number, details: string) => {
    // Find fee data to get total pending
    const fStudent = feeStudents.find(fs => String(fs.id) === String(student.id));
    let totalPending = fStudent ? getTotalPending(fStudent) + getTotalOtherFunds(fStudent) : 0;
    
    // Adjust pending balance based on the current action because state updates are async
    if (type === 'payment') {
      totalPending = Math.max(0, totalPending - amount);
    } else if (type === 'charge') {
      totalPending = totalPending + amount;
    }

    const classId = (student as any).classId;
    const sClass = classId ? classes.find(c => c.id === classId) : null;
    const className = sClass ? `${sClass.className} - ${sClass.section}` : ((student as any).class || 'N/A');

    const template = type === 'payment' 
      ? `Greetings! We have received a payment of ${amount} for ${details} from ${student.name} (${className}). Your remaining balance is ${totalPending}. Thank you for your cooperation. Demo School.`
      : type === 'charge'
      ? `Greetings! A charge of ${amount} has been added for ${details} to ${student.name}'s (${className}) school account. Your total pending balance is ${totalPending}. Please contact office for details. Demo School.`
      : `Greetings! This is a reminder regarding the pending school fees for ${student.name} (${className}). Total outstanding balance is ${totalPending}. Please settle the dues at your earliest convenience. Demo School.`;
    
    // Check both potential phone fields
    const phone = (student as any).parentPhone || (student as any).studentPhone || (student as any).phone || '';
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (!cleanPhone) {
      toast.error(`No phone number found for ${student.name}. Notification skipped.`);
      return;
    }

    let countryCodePhone = cleanPhone;
    if (countryCodePhone.startsWith('0')) {
      countryCodePhone = '92' + countryCodePhone.substring(1);
    } else if (!countryCodePhone.startsWith('92') && countryCodePhone.length === 10) {
      countryCodePhone = '92' + countryCodePhone;
    }

    const waUrl = `https://wa.me/${countryCodePhone}?text=${encodeURIComponent(template)}`;
    
    if (appSettings.autoWhatsAppRedirect) {
      window.open(waUrl, '_blank');
      toast.success(`Opening WhatsApp for ${student.name}'s fee notification`);
    } else {
      toast.custom(
        (t) => (
          <div className="flex items-center gap-3 bg-white text-slate-900 p-4 rounded-xl shadow-xl border border-slate-200">
            <span className="text-xs font-bold">Fee alert ready for {student.name}</span>
            <button 
              onClick={() => {
                window.open(waUrl, '_blank');
                toast.dismiss(t);
              }}
              className="bg-teal-600 text-white px-3 py-1 rounded-md text-xs font-black uppercase cursor-pointer"
            >
              Send
            </button>
          </div>
        )
      );
    }
  };

  // ===== FEE REMINDER SYSTEM =====
  // Pending months (sirf enrollment se current month tak — future months reminder nahi)
  const getPendingFeeMonthsForStudent = (student: Student, yr: number) => {
    const fs = feeStudents.find(x => String(x.id) === String(student.id));
    const base = Math.max(0, Number(student.baseFee ?? fs?.monthlyFee ?? 0));
    const enrollAlias = String(student.enrollmentMonth || '').trim().toLowerCase();
    const enrollIdx = Object.prototype.hasOwnProperty.call(MONTH_ALIAS, enrollAlias) ? MONTH_ALIAS[enrollAlias] : 0;
    const curMi = new Date().getMonth();
    const months: { month: string; year: number; pending: number }[] = [];
    for (let mi = enrollIdx; mi <= curMi; mi++) {
      const paid = (fs?.payments || []).filter(p => {
        const key = parseMonthKey(p.month, Number(p.year) || yr);
        return key.idx === mi && key.year === yr && (!p.feeType || TUITION_FEE_TYPES.test(p.feeType));
      }).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const pending = base > 0 ? Math.max(0, base - paid) : 0;
      if (pending > 0) months.push({ month: MONTHS[mi], year: yr, pending });
    }
    return months;
  };

  // Dues (unpaid non-tuition ledger entries — Paper Fund, Exam Fee etc. + pending Dues entries)
  const getTotalDuesForStudent = (student: Student) => {
    const ledgerDues = (fees || []).filter(f =>
      String(f.studentId) === String(student.id) && f.status !== 'paid' && f.feeType && !TUITION_FEE_TYPES.test(f.feeType)
    ).reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const fs = feeStudents.find(x => String(x.id) === String(student.id));
    const duesDues = (fs?.dues || [])
      .reduce((s, d) => s + getDueRemaining(d), 0);
    return ledgerDues + duesDues;
  };

  // Reminder message — Settings ka feeTemplate use karta hai ({name}, {total_pending}, {month}...)
  const buildFeeReminderMessage = (student: Student) => {
    const fs = feeStudents.find(x => String(x.id) === String(student.id));
    const yr = new Date().getFullYear();
    const pendingMonths = getPendingFeeMonthsForStudent(student, yr);
    const tuitionPending = pendingMonths.reduce((s, m) => s + m.pending, 0);
    const dues = getTotalDuesForStudent(student);
    const totalPending = tuitionPending + dues;
    const sClass = classes.find(c => c.id === student.classId);
    const className = sClass ? `${sClass.className} - ${sClass.section}` : (fs?.class || 'N/A');
    const curMi = new Date().getMonth();
    const monthsText = pendingMonths.map(m => `${m.month} ${m.year}`).join(', ');
    const template = appSettings.feeTemplate || "Dear parent, your child {name}'s fee for {month} is {amount} which is due on {date}. Demo Academy.";
    const date = new Date().toISOString().split('T')[0];
    let msg = template
      .replace(/{student_name}/g, student.name)
      .replace(/{name}/g, student.name)
      .replace(/{roll_number}/g, student.rollNumber || 'N/A')
      .replace(/{class_name}/g, className)
      .replace(/{month}/g, monthsText || `${MONTHS[curMi]} ${yr}`)
      .replace(/{amount}/g, `PKR ${totalPending.toLocaleString()}`)
      .replace(/{total_pending}/g, `PKR ${totalPending.toLocaleString()}`)
      .replace(/{date}/g, date);
    if (monthsText) msg += `\n\nPending months: ${monthsText}`;
    if (dues > 0) msg += `\nDues/Paper Fund: PKR ${dues.toLocaleString()}`;
    return { message: msg, totalPending, pendingMonths, dues };
  };

  // Bulk reminder recipients — whose fee is pending (highest pending first)
  const getFeeReminderRecipients = React.useMemo(() => {
    const yr = new Date().getFullYear();
    return students
      .map(st => {
        const pendingMonths = getPendingFeeMonthsForStudent(st, yr);
        const tuitionPending = pendingMonths.reduce((s, m) => s + m.pending, 0);
        const dues = getTotalDuesForStudent(st);
        return { student: st, pendingMonths, totalPending: tuitionPending + dues, dues };
      })
      .filter(r => r.totalPending > 0)
      .sort((a, b) => b.totalPending - a.totalPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, feeStudents, fees, classes]);

  const handleSendFeeReminderWhatsApp = (student: Student) => {
    const info = buildFeeReminderMessage(student);
    const phone = student.parentPhone || (student as any).studentPhone || '';
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) {
      toast.error(`No phone number found for ${student.name}. Reminder skipped.`);
      return;
    }
    let countryCodePhone = cleanPhone;
    if (countryCodePhone.startsWith('0')) countryCodePhone = '92' + countryCodePhone.substring(1);
    else if (!countryCodePhone.startsWith('92') && countryCodePhone.length === 10) countryCodePhone = '92' + countryCodePhone;
    const waUrl = `https://wa.me/${countryCodePhone}?text=${encodeURIComponent(info.message)}`;
    window.open(waUrl, '_blank');
    setFeeReminderSentIds(prev => new Set(prev).add(String(student.id)));
    toast.success(`Reminder opened for ${student.name} — PKR ${info.totalPending.toLocaleString()} pending`);
  };

  const handleCopyAllFeeReminders = async () => {
    const texts = getFeeReminderRecipients
      .filter(r => String(r.student.parentPhone || '').replace(/\D/g, ''))
      .map(r => `--- ${r.student.name} (${r.student.parentPhone}) ---\n${buildFeeReminderMessage(r.student).message}`);
    if (texts.length === 0) {
      toast.error('Nothing to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(texts.join('\n\n'));
      toast.success(`${texts.length} reminders copied — paste in WhatsApp Web/group.`);
    } catch {
      toast.error('Clipboard blocked by browser.');
    }
  };

  const [bulkWAModal, setBulkWAModal] = useState<{ isOpen: boolean; absents: (Student & { attendanceDate: string })[] }>({ isOpen: false, absents: [] });
  const [bulkWAClassFilter, setBulkWAClassFilter] = useState('all');
  const [absenteesModalOpen, setAbsenteesModalOpen] = useState(false);
  const [absenteesModalClassFilter, setAbsenteesModalClassFilter] = useState('all');

  const handleSendBulkAbsenceWhatsApp = () => {
    const recordsForDate = attendance.filter(a => {
      const matchesDate = a.date === attendanceFilterDate;
      const student = students.find(s => s.id === a.studentId);
      const matchesClass = attendanceFilterClass === 'all' || student?.classId === attendanceFilterClass;
      return matchesDate && matchesClass && a.status === 'absent';
    });
    
    if (recordsForDate.length === 0) {
      toast.error(`No absent students found for ${attendanceFilterClass === 'all' ? 'any class' : 'this class'} on ${attendanceFilterDate}.`);
      return;
    }

    const absentStudentsWithMetadata = recordsForDate.map(rec => {
      const student = students.find(s => s.id === rec.studentId);
      return { ...student!, attendanceDate: rec.date };
    }).filter(s => !!s);

    setBulkWAModal({ isOpen: true, absents: absentStudentsWithMetadata });
  };

  const [feeSearch, setFeeSearch] = useState('');
  const [feeClassFilter, setFeeClassFilter] = useState('all');
  const [selectedStudentForFee, setSelectedStudentForFee] = useState<string>(() => String(feeStudents[0]?.id || ''));
  const [isCashPayment, setIsCashPayment] = useState(true);
  const [selectedStudentForLedger, setSelectedStudentForLedger] = useState('');
  
  const [feePaymentModal, setFeePaymentModal] = useState<{isOpen: boolean; studentId: string; month: string; pending: number; previousArrears: number; amount: string; year: number; feeType: string}>({ isOpen: false, studentId: '', month: '', pending: 0, previousArrears: 0, amount: '', year: 2026, feeType: 'School Fee' });
  
  const [feeEditModal, setFeeEditModal] = useState<{isOpen: boolean; type: 'payment' | 'other'; recordId: string; studentId: string; amount: string; desc: string; feeType: string}>({ isOpen: false, type: 'payment', recordId: '', studentId: '', amount: '', desc: '', feeType: 'School Fee' });

  const [feeActionModal, setFeeActionModal] = useState<{ isOpen: boolean; fee: FeeRecord | null }>({ isOpen: false, fee: null });

  // RESULTS / WHATSAPP REGISTER STATE (any exam/test/term)
  const EXAM_NAME_OPTIONS = ['1st Term', '2nd Term', '3rd Term', 'Annual', 'Annual Exam', 'Monthly Test', 'Unit Test', 'Half Yearly', 'Mid Term', 'Final Term', 'Class Test', 'Assignment'];
  const [resultsClassFilter, setResultsClassFilter] = useState<string>('all');
  const [resultsExamDraft, setResultsExamDraft] = useState<string>('1st Term');
  const [resultsExam, setResultsExam] = useState<string>('');
  const [openExamChip, setOpenExamChip] = useState<string | null>(null);
  const [resultWAModal, setResultWAModal] = useState<{ isOpen: boolean; exam: string }>({ isOpen: false, exam: '' });
  const [resultWAClassFilter, setResultWAClassFilter] = useState<string>('all');
  const [sendingResultIds, setSendingResultIds] = useState<Set<string>>(new Set());

  const availableExamTypes = React.useMemo(() => Array.from(new Set(marks.map(m => m.examType).filter(Boolean))), [marks]);

  const getExamMarksForStudent = (studentId: string, exam: string) => {
    return marks.filter(m => String(m.studentId) === String(studentId) && (m.examType || '').trim().toLowerCase() === (exam || '').trim().toLowerCase());
  };

  const buildResultMessage = (student: Student, exam: string) => {
    const sClass = classes.find(c => c.id === student.classId);
    const className = sClass ? `${sClass.className} - ${sClass.section}` : 'N/A';
    const examMarks = getExamMarksForStudent(student.id, exam);
    const subjectLines = examMarks.map(m => `- ${m.subject}: ${m.marksObtained}/${m.maxMarks}`).join('\n');
    const totalObtained = examMarks.reduce((s, m) => s + Number(m.marksObtained || 0), 0);
    const totalMax = examMarks.reduce((s, m) => s + Number(m.maxMarks || 0), 0);
    const pct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;
    const status = pct >= 40 ? 'PASS' : 'RE-STUDY';

    const template = appSettings.resultTemplate || "Greetings, Respected Parent! Result of {student_name} (Roll: {roll_number}, {class_name}) for {exam_name}:\n{subjects}\nTotal: {total_obtained}/{total_max} ({percentage}%). Status: {status}.\n- Demo Academy.";
    return template
      .replace(/{student_name}/g, student.name)
      .replace(/{roll_number}/g, student.rollNumber || 'N/A')
      .replace(/{class_name}/g, className)
      .replace(/{exam_name}/g, exam)
      .replace(/{subjects}/g, subjectLines)
      .replace(/{total_obtained}/g, String(totalObtained))
      .replace(/{total_max}/g, String(totalMax))
      .replace(/{percentage}/g, String(pct))
      .replace(/{status}/g, status);
  };

  const handleSendResultWhatsApp = (student: Student, exam: string) => {
    const message = buildResultMessage(student, exam);
    const phone = (student as any).parentPhone || (student as any).studentPhone || '';
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) {
      toast.error(`No phone number found for ${student.name}. Report skipped.`);
      return;
    }

    let countryCodePhone = cleanPhone;
    if (countryCodePhone.startsWith('0')) {
      countryCodePhone = '92' + countryCodePhone.substring(1);
    } else if (!countryCodePhone.startsWith('92') && countryCodePhone.length === 10) {
      countryCodePhone = '92' + countryCodePhone;
    }

    const waUrl = `https://wa.me/${countryCodePhone}?text=${encodeURIComponent(message)}`;

    if (appSettings.autoWhatsAppRedirect) {
      window.open(waUrl, '_blank');
      toast.success(`Opening WhatsApp with ${exam} report for ${student.name}`);
    } else {
      toast.custom(
        (t) => (
          <div className="flex items-center gap-3 bg-white text-slate-900 p-4 rounded-xl shadow-xl border border-slate-200 max-w-sm">
            <div className="min-w-0">
              <span className="block text-xs font-black uppercase tracking-wider text-slate-700">{exam} report ready for {student.name}</span>
              <span className="block text-[10px] font-bold text-slate-400 mt-0.5 truncate">Total marks included ({student.rollNumber})</span>
            </div>
            <button
              onClick={() => {
                window.open(waUrl, '_blank');
                toast.dismiss(t);
              }}
              className="bg-amber-600 text-white px-3 py-1.5 rounded-md text-xs font-black uppercase cursor-pointer shrink-0"
            >
              Send
            </button>
          </div>
        )
      );
    }
  };

  const handleBulkSendResultWhatsApp = (studentsList: Student[], exam: string) => {
    if (studentsList.length === 0) {
      toast.error('No students with marks found to send.');
      return;
    }
    setSendingResultIds(new Set(studentsList.map(s => String(s.id))));
    studentsList.forEach((student, idx) => {
      setTimeout(() => {
        const message = buildResultMessage(student, exam);
        const phone = ((student as any).parentPhone || (student as any).studentPhone || '').replace(/\D/g, '');
        if (!phone) {
          toast.error(`No phone for ${student.name}. Skipped.`);
          setSendingResultIds(prev => { const n = new Set(prev); n.delete(String(student.id)); return n; });
          return;
        }
        let cc = phone;
        if (cc.startsWith('0')) cc = '92' + cc.substring(1);
        else if (!cc.startsWith('92') && cc.length === 10) cc = '92' + cc;
        window.open(`https://wa.me/${cc}?text=${encodeURIComponent(message)}`, '_blank');
        setSendingResultIds(prev => { const n = new Set(prev); n.delete(String(student.id)); return n; });
      }, idx * 800);
    });
    toast.info(`Opening WhatsApp for ${studentsList.length} parents one-by-one. Send each chat then continue.`);
  };

  const resultsRows = React.useMemo(() => {
    if (!resultsExam) return [];
    const studentList = resultsClassFilter === 'all' ? students : students.filter(s => s.classId === resultsClassFilter);
    return studentList.map(s => {
      const examMarks = getExamMarksForStudent(s.id, resultsExam);
      const totalObtained = examMarks.reduce((sum, m) => sum + Number(m.marksObtained || 0), 0);
      const totalMax = examMarks.reduce((sum, m) => sum + Number(m.maxMarks || 0), 0);
      const pct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;
      return { student: s, examMarks, totalObtained, totalMax, pct, hasMarks: examMarks.length > 0 };
    });
  }, [resultsExam, resultsClassFilter, students, marks]);

  const resultWARows = React.useMemo(() => {
    if (!resultWAModal.exam) return [];
    const studentList = resultWAClassFilter === 'all' ? students : students.filter(s => s.classId === resultWAClassFilter);
    return studentList
      .map(s => ({ student: s, marks: getExamMarksForStudent(s.id, resultWAModal.exam) }))
      .filter(r => r.marks.length > 0);
  }, [resultWAModal.exam, resultWAClassFilter, students, marks]);

  const [showFeeEditForm, setShowFeeEditForm] = useState(false);
  const [feeEditForm, setFeeEditForm] = useState({
    studentName: '',
    month: '',
    feeType: '',
    amount: '',
    paidDate: '',
    paymentMethod: '',
    description: ''
  });

  const openFeeActionModal = (fee: FeeRecord) => {
    const st = studentsMap.get(String(fee.studentId));
    setFeeEditForm({
      studentName: st?.name || `Student #${String(fee.studentId).slice(-4)}`,
      month: fee.month || '',
      feeType: fee.feeType || '',
      amount: String(fee.amount || ''),
      paidDate: fee.paidDate || '',
      paymentMethod: fee.paymentMethod || '',
      description: fee.description || ''
    });
    setShowFeeEditForm(false);
    setFeeActionModal({ isOpen: true, fee });
  };

  const saveFeeRecordEdit = () => {
    const modalFee = feeActionModal.fee;
    if (!modalFee) return;
    const amt = Number(feeEditForm.amount);
    if (isNaN(amt) || amt < 0) {
      toast.error("Please enter a valid amount.");
      return;
    }
    const [mth, yr] = (feeEditForm.month || '').split(' ');
    setFees(prev => prev.map(item =>
      item.id === modalFee.id
        ? { ...item, month: feeEditForm.month, feeType: feeEditForm.feeType, amount: amt, paidDate: feeEditForm.paidDate, paymentMethod: feeEditForm.paymentMethod, description: feeEditForm.description }
        : item
    ));
    // Keep the student's monthly payment ledger in sync with the edited receipt
    setFeeStudents(prev => prev.map(fs => {
      if (String(fs.id) === String(modalFee.studentId)) {
        return {
          ...fs,
          payments: fs.payments.map(p => {
            if (String(p.id) === String(modalFee.id)) {
              return {
                ...p,
                month: mth || p.month,
                year: Number(yr) || p.year,
                amount: amt,
                date: feeEditForm.paidDate || p.date,
                feeType: feeEditForm.feeType || p.feeType
              };
            }
            return p;
          })
        };
      }
      return fs;
    }));
    setFeeActionModal({ isOpen: false, fee: null });
    toast.success("Fee record updated successfully!");
  };

  const deleteFeeRecord = (fee: FeeRecord) => {
    if (!window.confirm(`Delete this fee record (PKR ${Number(fee.amount) || 0}) for ${fee.month || 'this student'}? This will also update the remaining balance.`)) return;
    setFees(prev => prev.filter(item => item.id !== fee.id));
    const monthParts = (fee.month || '').split(' ');
    const payMonth = monthParts[0] || '';
    const payYear = Number(monthParts[1]) || new Date().getFullYear();
    setFeeStudents(prev => prev.map(fs => {
      if (String(fs.id) === String(fee.studentId)) {
        return { ...fs, payments: fs.payments.filter(p => !(p.id === fee.id || (p.month === payMonth && p.year === payYear && Number(p.amount) === Number(fee.amount)))) };
      }
      return fs;
    }));
    setFeeActionModal({ isOpen: false, fee: null });
    toast.success("Fee record deleted.");
  };

  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{isOpen: boolean, type: string, id: string, message: string}>({ isOpen: false, type: '', id: '', message: '' });
  const [studentDetailModal, setStudentDetailModal] = useState<{ isOpen: boolean; student: Student | null }>({ isOpen: false, student: null });

  // SATH HI Parent Notification Popup / Modal states
  const [feeNotificationPopup, setFeeNotificationPopup] = useState<{
    studentName: string;
    parentPhone: string;
    guardianName: string;
    amount: number;
    feeType: string;
    month: string;
    dueDate: string;
    messageText: string;
  } | null>(null);

  // --- INTERACTIVE CLASS INSIGHTS STATE ---
  const [selectedClassForDetails, setSelectedClassForDetails] = useState<Class | null>(null);
  const [isClassDetailModalOpen, setIsClassDetailModalOpen] = useState(false);

  // 2nd, 5th, 7th monthly notifications cockpit states
  const [reminderSelectedDate, setReminderSelectedDate] = useState<'2' | '5' | '7'>('2');
  const [reminderSendingProgress, setReminderSendingProgress] = useState<boolean>(false);
  const [reminderReport, setReminderReport] = useState<Array<{
    studentName: string;
    parentPhone: string;
    amount: number;
    text: string;
    status: string;
  }> | null>(null);

  // Fee Reminder Dispatch cockpit
  const [feeReminderModal, setFeeReminderModal] = useState<boolean>(false);
  const [feeReminderClassFilter, setFeeReminderClassFilter] = useState('all');
  const [feeReminderSentIds, setFeeReminderSentIds] = useState<Set<string>>(new Set());

  // custom values for each category
  const [paperFundVal, setPaperFundVal] = useState('150');
  const [annualFeeVal, setAnnualFeeVal] = useState('500');
  const [miscFeeVal, setMiscFeeVal] = useState('200');

  // Collect dues modal state
  const [collectDuesModal, setCollectDuesModal] = useState<{ isOpen: boolean; studentId: string; dueId: string; desc: string; amount: number; remaining: number; month: string; year: number }>({ isOpen: false, studentId: '', dueId: '', desc: '', amount: 0, remaining: 0, month: '', year: 2026 });
  const [collectDuesPaymentMethod, setCollectDuesPaymentMethod] = useState('Cash');
  // ===== CLASS-LEVEL APPLY DUES (Paper Fund, Exam Fee etc.) — poori class ya selected students =====
  const [showClassDuesModal, setShowClassDuesModal] = useState(false);
  const [classDuesClassId, setClassDuesClassId] = useState<string>('all');
  const [classDuesSelected, setClassDuesSelected] = useState<Record<string, boolean>>({});
  const [classDuesDesc, setClassDuesDesc] = useState('Paper Fund');
  const [classDuesAmount, setClassDuesAmount] = useState('');
  const [classDuesMode, setClassDuesMode] = useState<'charge' | 'collect'>('charge');
  const [classDuesMonth, setClassDuesMonth] = useState<string>(MONTHS[new Date().getMonth()] as string);
  const [classDuesYear, setClassDuesYear] = useState(new Date().getFullYear());
  const [classDuesPaymentMethod, setClassDuesPaymentMethod] = useState('Cash');
  const [classDuesCollectAmount, setClassDuesCollectAmount] = useState('');
  // Partial collection: kitna amount ab is baar collect ho raha hai
  const [collectDuesAmount, setCollectDuesAmount] = useState('');

  // Class-Apply-Dues modal ke liye scope ke hisaab se students
  const classStudentsForDues = classDuesClassId === 'all' ? students : students.filter(s => s.classId === classDuesClassId);

  // Modals / Form editing state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'teacher' | 'student' | 'class' | 'timetable' | 'coordinator'>('teacher');
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [currentId, setCurrentId] = useState<string | null>(null);

  // Validation state
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [formStep, setFormStep] = useState(1);

  // Individual Form Fields
  // Teacher
  const [tName, setTName] = useState('');
  const [tEmail, setTEmail] = useState('');
  const [tSubject, setTSubject] = useState('');
  const [tPhone, setTPhone] = useState('');
  const [tPassword, setTPassword] = useState('nsb123');
  const [tUsername, setTUsername] = useState('');

  // Student
  const [sName, setSName] = useState('');
  const [sEmail, setSEmail] = useState('');
  const [sClassId, setSClassId] = useState('');
  const [sRoll, setSRoll] = useState('');
  const [sParentPhone, setSParentPhone] = useState('');
  const [sStudentPhone, setSStudentPhone] = useState('');
  const [sBaseFee, setSBaseFee] = useState('0');
  const [sEnrollmentMonth, setSEnrollmentMonth] = useState('January');
  const [sPassword, setSPassword] = useState('nsb123');
  const [sUsername, setSUsername] = useState('');
  const [sIsAcademy, setSIsAcademy] = useState(false);
  const [sAcademySubjects, setSAcademySubjects] = useState('');
  const [sPhoto, setSPhoto] = useState<string | undefined>(undefined);
  const [isConvertingPhoto, setIsConvertingPhoto] = useState(false);

  // Class
  const [cClassName, setCClassName] = useState('');
  const [cSection, setCSection] = useState('');
  const [cTeacherId, setCTeacherId] = useState('');
  const [cSubjects, setCSubjects] = useState<string[]>([]);
  const [showOtherSubjectInput, setShowOtherSubjectInput] = useState(false);
  const [manualSubjectName, setManualSubjectName] = useState('');

  // Timetable Form
  const [ttClassId, setTtClassId] = useState('');
  const [ttDay, setTtDay] = useState<DayOfWeek>('Monday');
  const [ttPeriod, setTtPeriod] = useState('Period 1');
  const [ttTime, setTtTime] = useState('08:30 AM - 09:30 AM');
  const [ttSubject, setTtSubject] = useState('');
  const [ttTeacherId, setTtTeacherId] = useState('');
  const [isCustomPeriod, setIsCustomPeriod] = useState(false);

  // Active Timetable View Filter
  const [selectedTimetableClass, setSelectedTimetableClass] = useState<string>(classes[0]?.id || '');
  const [selectedSlot, setSelectedSlot] = useState<{period: string, day: string} | null>(null);
  const [periodToDeletePending, setPeriodToDeletePending] = useState<{period: string, day: string} | null>(null);
  const [draggedSlot, setDraggedSlot] = useState<{day: DayOfWeek, period: string, entry: TimetableEntry | undefined} | null>(null);

  const handleDragStart = (e: React.DragEvent, slotInfo: {day: DayOfWeek, period: string, entry: TimetableEntry | undefined}) => {
    setDraggedSlot(slotInfo);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessary to allow drop
  };

  const handleDrop = (e: React.DragEvent, targetSlotInfo: {day: DayOfWeek, period: string}) => {
    e.preventDefault();
    if (!draggedSlot) return;

    const { day: sourceDay, period: sourcePeriod, entry: sourceEntry } = draggedSlot;
    const { day: targetDay, period: targetPeriod } = targetSlotInfo;

    if (sourceDay === targetDay && sourcePeriod === targetPeriod) return;

    // Perform swap/move
    setTimetable(prev => {
      let updated = [...prev];
      
      // Remove source entry
      updated = updated.filter(tt => !(tt.classId === selectedTimetableClass && tt.day === sourceDay && tt.period === sourcePeriod));
      
      // Remove target entry if exists (overwriting)
      updated = updated.filter(tt => !(tt.classId === selectedTimetableClass && tt.day === targetDay && tt.period === targetPeriod));
      
      // Add moved entry
      if (sourceEntry) {
        updated.push({
          ...sourceEntry,
          day: targetDay,
          period: targetPeriod
        });
      }

      return updated;
    });

    setDraggedSlot(null);
  };

  const getPeriodColor = (period: string) => {
    const key = `${selectedTimetableClass}_${period}`;
    return appSettings.periodColors[key] || '#0d9488'; // default Indigo color
  };

  const convertToWebP = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject('Failed to get canvas context');

          // Balanced size to save sync bandwidth while maintaining clarity
          const maxWidth = 400;
          const scale = Math.min(1, maxWidth / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // 0.8 quality provides high fidelity for portrait photos
          const webpBase64 = canvas.toDataURL('image/webp', 0.8);
          resolve(webpBase64);
        };
        img.onerror = () => reject('Image load error');
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject('File read error');
      reader.readAsDataURL(file);
    });
  };

  // Upload all current local state data to Cloud (Supabase)
  const handleUploadToCloud = async () => {
    const confirm = window.confirm("Are you sure you want to upload all local data to Supabase? This will overwrite current Cloud data.");
    if (!confirm) return;

    toast.info("Uploading data to Cloud...");
    try {
      const uploadConfig: { col: string; data: any[] | any; type: 'list' | 'object'; docId?: string }[] = [
        { col: 'teachers', data: teachers, type: 'list' },
        { col: 'classes', data: classes, type: 'list' },
        { col: 'students', data: students, type: 'list' },
        { col: 'timetable', data: timetable, type: 'list' },
        { col: 'attendance', data: attendance, type: 'list' },
        { col: 'marks', data: marks, type: 'list' },
        { col: 'fees', data: fees, type: 'list' },
        { col: 'coordinators', data: coordinators, type: 'list' },
        { col: 'fee_data', data: feeStudents, type: 'list' },
        { col: 'app_settings', data: appSettings, type: 'object', docId: 'global' }
      ];

      for (const item of uploadConfig) {
        if (item.type === 'list' && Array.isArray(item.data)) {
          const listItems = item.data;
          for (const listItem of listItems) {
            if (listItem && listItem.id) {
              sbQueueWrite(item.col, String(listItem.id), listItem);
            }
          }
        } else if (item.type === 'object' && item.docId) {
          sbQueueWrite(item.col, item.docId, item.data);
        }
      }
      await flushSupabase();

      // Also persist to localStorage cache so download/restore works consistently
      safeStorage.setItem('acadamis_teachers', JSON.stringify(teachers));
      safeStorage.setItem('acadamis_classes', JSON.stringify(classes));
      safeStorage.setItem('acadamis_students', JSON.stringify(students));
      safeStorage.setItem('acadamis_timetable', JSON.stringify(timetable));
      safeStorage.setItem('acadamis_attendance', JSON.stringify(attendance));
      safeStorage.setItem('acadamis_marks', JSON.stringify(marks));
      safeStorage.setItem('acadamis_fees', JSON.stringify(fees));
      safeStorage.setItem('acadamis_coordinators', JSON.stringify(coordinators));
      safeStorage.setItem('school_fee_data', JSON.stringify(feeStudents));
      safeStorage.setItem('acadamis_app_settings', JSON.stringify(appSettings));

      toast.success("Successfully uploaded all local data to cloud!");
    } catch (error: any) {
      toast.error("Error uploading data: " + error.message);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size must be less than 5MB");
      return;
    }

    try {
      setIsConvertingPhoto(true);
      const webpData = await convertToWebP(file);
      
      // Calculate approximate size in KB
      const sizeInKB = Math.round((webpData.length * 3/4) / 1024);
      
      setSPhoto(webpData);
      toast.success(`Photo compressed successfully! (~${sizeInKB} KB)`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to process image");
    } finally {
      setIsConvertingPhoto(false);
    }
  };

  const defaultPeriods = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
  const allPeriods = [...defaultPeriods, ...(appSettings.extraPeriods[selectedTimetableClass] || [])].filter(
    p => !(appSettings.deletedPeriods[selectedTimetableClass] || []).includes(p)
  );



  const handleDeletePeriod = (periodToDelete: string, day: string) => {
    // We only need to check if we should block deletion based on total slots if really necessary,
    // but the user's request focused on *per-day* deletion.
    setPeriodToDeletePending({period: periodToDelete, day});
  };

  const executeDeletePeriod = (periodToDelete: string, day: string) => {
    // Only remove timetable entries for this period for this class AND day.
    const updatedTimetable = timetable.filter(
      tt => !(tt.classId === selectedTimetableClass && tt.period === periodToDelete && tt.day === day)
    );
    setTimetable(updatedTimetable);

    toast.success(`Removed "${periodToDelete}" from ${day}'s timetable.`);
    setPeriodToDeletePending(null);
  };

  // Compact list expanded states for responsive mobile optimization
  const [expandedTeachers, setExpandedTeachers] = useState<Record<string, boolean>>({});
  const [expandedStudents, setExpandedStudents] = useState<Record<string, boolean>>({});
  const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
  const [expandedCoordinators, setExpandedCoordinators] = useState<Record<string, boolean>>({});

  const toggleTeacherExpanded = (id: string) => {
    setExpandedTeachers(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleCoordinatorExpanded = (id: string) => {
    setExpandedCoordinators(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleStudentExpanded = (id: string) => {
    setExpandedStudents(prev => ({ ...prev, [id]: !prev[id] }));
  };
  const toggleClassExpanded = (id: string) => {
    setExpandedClasses(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Reset forms helper
  const resetFormFields = () => {
    setTName('');
    setTEmail('');
    setTSubject('');
    setTPhone('');
    setTPassword('nsb123');
    setTUsername('');

    setSName('');
    setSEmail('');
    setSClassId(classes[0]?.id || '');
    // Auto-generate next roll number for the default class
    if (classes.length > 0) {
      const classStudents = students.filter(s => s.classId === classes[0].id);
      const maxRoll = classStudents.reduce((max, s) => {
        const num = parseInt(s.rollNumber, 10);
        return !isNaN(num) && num > max ? num : max;
      }, 0);
      setSRoll(String(maxRoll + 1));
    } else {
      setSRoll('');
    }
    setSParentPhone('');
    setSStudentPhone('');
    setSBaseFee('0');
    setSEnrollmentMonth('January');
    setSPassword('nsb123');
    setSUsername('');
    setSIsAcademy(false);
    setSAcademySubjects('');
    setSPhoto(undefined);
    setIsConvertingPhoto(false);

    setCClassName('');
    setCSection('');
    setCTeacherId(teachers[0]?.id || '');
    setCSubjects([]);
    setShowOtherSubjectInput(false);
    setManualSubjectName('');

    setTtClassId(classes[0]?.id || selectedTimetableClass || '');
    setTtDay('Monday');
    setTtPeriod('Period 1');
    setTtTime('08:30 AM - 09:30 AM');
    setTtSubject('');
    setTtTeacherId(teachers[0]?.id || '');

    setFormErrors([]);
    setCurrentId(null);
    setIsCustomPeriod(false);
  };

  const openAddModal = (type: 'teacher' | 'student' | 'class' | 'timetable' | 'coordinator') => {
    setModalType(type);
    setModalMode('add');
    resetFormFields();

    // Auto-pre-populate dropdown variables based on latest loads
    if (type === 'student' && classes.length > 0) {
      setSClassId(classes[0].id);

      // Auto-generate next roll number for the selected class
      const classStudents = students.filter(s => s.classId === classes[0].id);
      const maxRoll = classStudents.reduce((max, s) => {
        const num = parseInt(s.rollNumber, 10);
        return !isNaN(num) && num > max ? num : max;
      }, 0);
      setSRoll(String(maxRoll + 1));
    }
    if (type === 'class' && teachers.length > 0) {
      setCTeacherId(teachers[0].id);
    }
    if (type === 'timetable') {
      if (classes.length > 0) {
        setTtClassId(selectedTimetableClass || classes[0].id);
      }
      if (teachers.length > 0) {
        setTtTeacherId(teachers[0].id);
      }
    }
    setIsModalOpen(true);
  };

  const openEditModal = (type: 'teacher' | 'student' | 'class' | 'timetable' | 'coordinator', id: string) => {
    setModalType(type);
    setModalMode('edit');
    setCurrentId(id);
    setFormErrors([]);

    if (type === 'teacher') {
      const match = teachers.find(t => t.id === id);
      if (match) {
        setTName(match.name);
        setTEmail(match.email);
        setTSubject(match.subject);
        setTPhone(match.phone);
        setTPassword(match.password || 'nsb123');
        setTUsername(match.username || '');
      }
    } else if (type === 'coordinator') {
      const match = coordinators.find(c => c.id === id);
      if (match) {
        setTName(match.name);
        setTEmail(match.email || '');
        setTSubject('Academic Coordinator');
        setTPhone(match.phone || '');
        setTPassword(match.password || 'nsb123');
        setTUsername(match.username || '');
      }
    } else if (type === 'student') {
      const match = students.find(s => s.id === id);
      if (match) {
        setSName(match.name);
        setSEmail(match.email);
        setSClassId(match.classId);
        setSRoll(match.rollNumber);
        setSParentPhone(match.parentPhone);
        setSStudentPhone(match.studentPhone || '');
        setSBaseFee(match.baseFee?.toString() || '0');
        setSEnrollmentMonth(match.enrollmentMonth || 'January');
        setSPassword(match.password || 'nsb123');
        setSUsername(match.username || '');
        setSIsAcademy(match.category === 'Academy');
        setSAcademySubjects(match.academySubjects?.join(', ') || '');
        setSPhoto(match.photo);
      }
    } else if (type === 'class') {
      const match = classes.find(c => c.id === id);
      if (match) {
        setCClassName(match.className);
        setCSection(match.section);
        setCTeacherId(match.classTeacherId);
        setCSubjects(match.subjects || []);
      }
    } else if (type === 'timetable') {
      const match = timetable.find(tt => tt.id === id);
      if (match) {
        setTtClassId(match.classId);
        setTtDay(match.day);
        setTtPeriod(match.period);
        setTtTime(match.time);
        setTtSubject(match.subject);
        setTtTeacherId(match.teacherId);
        const defaultPeriods = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
        setIsCustomPeriod(!defaultPeriods.includes(match.period));
      }
    }
    setIsModalOpen(true);
  };

  // Validators
  const validateForm = (): boolean => {
    const errors: string[] = [];
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (modalType === 'teacher') {
      if (!tName.trim()) errors.push('Name is required.');
      if (tEmail.trim() && !emailRegex.test(tEmail)) errors.push('A valid email is required if provided.');
      if (!tSubject.trim()) errors.push('Teaching subject is required.');
      if (!tPhone.trim()) errors.push('Phone is required.');
      if (!tPassword.trim()) errors.push('Password is required.');

      // Check unique email except current editing
      const emailTaken = tEmail.trim() && teachers.some(t => t.email?.toLowerCase() === tEmail.toLowerCase().trim() && t.id !== currentId);
      if (emailTaken) errors.push('This email is already taken by another teacher.');
    } 
    
    else if (modalType === 'coordinator') {
      if (!tName.trim()) errors.push('Name is required.');
      if (tEmail.trim() && !emailRegex.test(tEmail)) errors.push('A valid email is required if provided.');
      if (!tPassword.trim()) errors.push('Password is required.');

      // Check unique email except current editing
      const emailTaken = tEmail.trim() && coordinators.some(c => c.email?.toLowerCase() === tEmail.toLowerCase().trim() && c.id !== currentId);
      if (emailTaken) errors.push('This email is already taken by another coordinator.');
    } 
    
    else if (modalType === 'student') {
      if (!sName.trim()) errors.push('Student name is required.');
      if (sEmail.trim() && !emailRegex.test(sEmail)) errors.push('A valid email is required if provided.');
      if (!sClassId) errors.push('Class must be selected.');
      if (!sRoll.trim()) errors.push('Roll number is required.');
      if (!sParentPhone.trim()) errors.push('Parent contact phone is required.');
      if (!sPassword.trim()) errors.push('Password is required.');

      // Check unique email
      const emailTaken = sEmail.trim() && students.some(s => s.email?.toLowerCase() === sEmail.toLowerCase().trim() && s.id !== currentId);
      if (emailTaken) errors.push('This email is already taken by another student.');

      // Check unique roll number within same class
      const rollTaken = students.some(
        s => s.classId === sClassId && 
             (s.rollNumber || '').trim() === sRoll.trim() && 
             s.id !== currentId
      );
      if (rollTaken) errors.push('This roll number is already assigned to a student in this class.');
    } 
    
    else if (modalType === 'class') {
      if (!cClassName.trim()) errors.push('Class name (e.g. Grade 10) is required.');
      if (!cSection.trim()) errors.push('Section (e.g. A) is required.');
      if (!cTeacherId) errors.push('A class teacher must be assigned.');

      // Check duplicate Class + Section
      const classExists = classes.some(
        c => (c.className?.toLowerCase() || '') === cClassName.toLowerCase().trim() &&
             (c.section?.toLowerCase() || '') === cSection.toLowerCase().trim() &&
             c.id !== currentId
      );
      if (classExists) errors.push('This Class Name & Section combination already exists.');
    } 
    
    else if (modalType === 'timetable') {
      if (!ttClassId) errors.push('Class is required.');
      if (!ttSubject.trim()) errors.push('Subject name is required.');
      if (!ttTeacherId) errors.push('Assigned teacher is required.');
      if (!ttPeriod) errors.push('Period selection is required.');
      
      // Check if teacher is double booked at the same day/period
      const doubleBooked = timetable.some(
        tt => tt.day === ttDay &&
             tt.period === ttPeriod &&
             tt.teacherId === ttTeacherId &&
             tt.id !== currentId
      );
      if (doubleBooked) {
        const teacherObj = teachers.find(t => t.id === ttTeacherId);
        errors.push(`${teacherObj?.name || 'Assigned Teacher'} is already scheduled to teach some other class during ${ttDay} ${ttPeriod}.`);
      }

      // Check if class itself is double booked at the same day/period
      const classDoubleBooked = timetable.some(
        tt => tt.day === ttDay &&
             tt.period === ttPeriod &&
             tt.classId === ttClassId &&
             tt.id !== currentId
      );
      if (classDoubleBooked) {
        errors.push(`This class already has a scheduled subject during ${ttDay} ${ttPeriod}.`);
      }
    }

    setFormErrors(errors);
    return errors.length === 0;
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    if (modalType === 'teacher') {
      if (modalMode === 'add') {
        const id = 't_' + Date.now();
        const newTeacher: Teacher = {
          id,
          name: tName.trim(),
          email: tEmail.toLowerCase().trim(),
          username: tName.trim(), 
          password: tPassword,
          subject: tSubject.trim(),
          phone: tPhone.trim(),
        };
        setTeachers([...teachers, newTeacher]);
        toast.success("Teacher profile added successfully!");
      } else {
        setTeachers(teachers.map(t => t.id === currentId ? {
          ...t,
          name: tName.trim(),
          email: tEmail.toLowerCase().trim(),
          subject: tSubject.trim(),
          phone: tPhone.trim(),
          password: tPassword,
          username: tName.trim(),
        } : t));
        toast.success("Teacher profile updated successfully!");
      }
    } 
    
    else if (modalType === 'coordinator') {
      if (modalMode === 'add') {
        const id = 'c_' + Date.now();
        const newCoordinator: Coordinator = {
          id,
          name: tName.trim(),
          email: tEmail.toLowerCase().trim(),
          username: tName.trim(), 
          password: tPassword,
          phone: tPhone.trim(),
        };
        setCoordinators([...coordinators, newCoordinator]);
        toast.success("Coordinator profile added successfully!");
      } else {
        setCoordinators(coordinators.map(c => c.id === currentId ? {
          ...c,
          name: tName.trim(),
          email: tEmail.toLowerCase().trim(),
          phone: tPhone.trim(),
          password: tPassword,
          username: tName.trim(),
        } : c));
        toast.success("Coordinator profile updated successfully!");
      }
    } 
    
    else if (modalType === 'student') {
      if (modalMode === 'add') {
        const id = 's_' + Date.now();
        const newStudent: Student = {
          id,
          name: sName.trim(),
          email: sEmail.toLowerCase().trim(),
          username: sUsername || sName.trim(),
          password: sPassword,
          classId: sClassId,
          rollNumber: sRoll.trim(),
          parentPhone: sParentPhone.trim(),
          studentPhone: sStudentPhone.trim(),
          baseFee: Number(sBaseFee) || 0,
          category: sIsAcademy ? 'Academy' : 'Regular',
          academySubjects: sIsAcademy ? sAcademySubjects.split(',').map(s => s.trim()).filter(s => s !== '') : [],
          enrollmentMonth: sEnrollmentMonth,
          photo: sPhoto,
        };
        setStudents([...students, newStudent]);
        toast.success("Student profile added successfully!");
      } else {
        setStudents(students.map(s => s.id === currentId ? {
          ...s,
          name: sName.trim(),
          email: sEmail.toLowerCase().trim(),
          classId: sClassId,
          rollNumber: sRoll.trim(),
          parentPhone: sParentPhone.trim(),
          studentPhone: sStudentPhone.trim(),
          baseFee: Number(sBaseFee) || 0,
          password: sPassword,
          username: sUsername,
          category: sIsAcademy ? 'Academy' : 'Regular',
          academySubjects: sIsAcademy ? sAcademySubjects.split(',').map(s => s.trim()).filter(s => s !== '') : [],
          enrollmentMonth: sEnrollmentMonth,
          photo: sPhoto,
        } : s));
        toast.success("Student profile updated successfully!");
      }
    }     
    else if (modalType === 'class') {
      if (modalMode === 'add') {
        const newClass: Class = {
          id: 'c_' + Date.now(),
          className: cClassName.trim(),
          section: cSection.toUpperCase().trim(),
          classTeacherId: cTeacherId,
          subjects: cSubjects
        };
        setClasses([...classes, newClass]);
        // Set view class for visual sanity if it was empty
        if (!selectedTimetableClass) {
          setSelectedTimetableClass(newClass.id);
        }
      } else {
        setClasses(classes.map(c => c.id === currentId ? {
          ...c,
          className: cClassName.trim(),
          section: cSection.toUpperCase().trim(),
          classTeacherId: cTeacherId,
          subjects: cSubjects
        } : c));
      }
    } 
    
    else if (modalType === 'timetable') {
      if (modalMode === 'add') {
        const newTT: TimetableEntry = {
          id: 'tt_' + Date.now(),
          classId: ttClassId,
          day: ttDay,
          period: ttPeriod,
          time: ttTime,
          subject: ttSubject.trim(),
          teacherId: ttTeacherId
        };
        setTimetable([...timetable, newTT]);

        // Push real-time notification
        const matchClass = classes.find(c => c.id === ttClassId);
        const classLabel = matchClass ? `${matchClass.className}-${matchClass.section}` : `Class ID ${ttClassId}`;
        const matchTeacher = teachers.find(t => t.id === ttTeacherId);
        const teacherLabel = matchTeacher ? matchTeacher.name : 'Unassigned';

        addNotification({
          type: 'timetable_created',
          title: 'New Lecture Scheduled 📅',
          message: `${ttPeriod} (${ttSubject.trim()}) is scheduled on ${ttDay} [${ttTime}] for Class ${classLabel} under ${teacherLabel}.`,
          teacherId: ttTeacherId,
          classId: ttClassId,
          role: 'all'
        });

        // If the period was marked as deleted, clear it from deleted list
        const currentDeletedAdd = appSettings.deletedPeriods[ttClassId] || [];
        if (currentDeletedAdd.includes(ttPeriod)) {
          updateSetting('deletedPeriods', {
            ...appSettings.deletedPeriods,
            [ttClassId]: currentDeletedAdd.filter(p => p !== ttPeriod)
          });
        }

        // Automatically register period in extraPeriods if it is custom
        const defaultPeriods = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
        if (ttPeriod && !defaultPeriods.includes(ttPeriod)) {
          const classList = appSettings.extraPeriods[ttClassId] || [];
          if (!classList.includes(ttPeriod)) {
            updateSetting('extraPeriods', {
              ...appSettings.extraPeriods,
              [ttClassId]: [...classList, ttPeriod]
            });
          }
        }
      } else {
        setTimetable(timetable.map(tt => tt.id === currentId ? {
          ...tt,
          classId: ttClassId,
          day: ttDay,
          period: ttPeriod,
          time: ttTime,
          subject: ttSubject.trim(),
          teacherId: ttTeacherId
        } : tt));

        // Push real-time notification
        const matchClass = classes.find(c => c.id === ttClassId);
        const classLabel = matchClass ? `${matchClass.className}-${matchClass.section}` : `Class ID ${ttClassId}`;
        const matchTeacher = teachers.find(t => t.id === ttTeacherId);
        const teacherLabel = matchTeacher ? matchTeacher.name : 'Unassigned';

        addNotification({
          type: 'timetable_updated',
          title: 'Timetable Session Updated 🔄',
          message: `${ttPeriod} [${ttTime}] on ${ttDay} changed to "${ttSubject.trim()}" with assigned instructor ${teacherLabel} for Class ${classLabel}.`,
          teacherId: ttTeacherId,
          classId: ttClassId,
          role: 'all'
        });

        // If the period was marked as deleted, clear it from deleted list
        const currentDeletedEdit = appSettings.deletedPeriods[ttClassId] || [];
        if (currentDeletedEdit.includes(ttPeriod)) {
          updateSetting('deletedPeriods', {
            ...appSettings.deletedPeriods,
            [ttClassId]: currentDeletedEdit.filter(p => p !== ttPeriod)
          });
        }

        // Automatically register period in extraPeriods if it is custom
        if (ttPeriod && !defaultPeriods.includes(ttPeriod)) {
          const classList = appSettings.extraPeriods[ttClassId] || [];
          if (!classList.includes(ttPeriod)) {
            updateSetting('extraPeriods', {
              ...appSettings.extraPeriods,
              [ttClassId]: [...classList, ttPeriod]
            });
          }
        }
      }
    }

    setIsModalOpen(false);
    resetFormFields();
  };

  // Delete Handlers
  const confirmAction = () => {
    const { type, id } = deleteConfirmModal;
    if (type === 'teacher') {
      setTeachers(teachers.filter(t => t.id !== id));
      setClasses(classes.map(c => c.classTeacherId === id ? { ...c, classTeacherId: '' } : c));
      setTimetable(timetable.filter(tt => tt.teacherId !== id));
      toast.success("Teacher deleted successfully.");
    } else if (type === 'coordinator') {
      setCoordinators(coordinators.filter(c => c.id !== id));
      toast.success("Coordinator deleted successfully.");
    } else if (type === 'student') {
      setStudents(students.filter(s => s.id !== id));
      toast.success("Student deleted successfully.");
    } else if (type === 'class') {
      setClasses(classes.filter(c => c.id !== id));
      setStudents(students.map(s => s.classId === id ? { ...s, classId: '' } : s));
      setTimetable(timetable.filter(tt => tt.classId !== id));
      if (selectedTimetableClass === id) {
        const remaining = classes.filter(c => c.id !== id);
        setSelectedTimetableClass(remaining[0]?.id || '');
      }
      toast.success("Class deleted successfully.");
    } else if (type === 'timetable') {
      const entry = timetable.find(t => t.id === id);
      if (entry) {
        const matchClass = classes.find(c => c.id === entry.classId);
        const classLabel = matchClass ? `${matchClass.className}-${matchClass.section}` : `Class ID ${entry.classId}`;
        
        addNotification({
          type: 'timetable_deleted',
          title: 'Lecture Cancelled ❌',
          message: `${entry.period} (${entry.subject}) on ${entry.day} for Class ${classLabel} has been removed or cancelled.`,
          teacherId: entry.teacherId,
          classId: entry.classId,
          role: 'all'
        });
        setTimetable(timetable.filter(t => t.id !== id));
        toast.success("Timetable entry deleted successfully.");
      }
    }
    setDeleteConfirmModal({ isOpen: false, type: '', id: '', message: '' });
  };

  const handleDeleteTeacher = (id: string) => {
    setDeleteConfirmModal({ isOpen: true, type: 'teacher', id, message: 'Are you sure you want to delete this teacher? This will vacate teachers from assigned classes and timetables.' });
  };

  const handleDeleteCoordinator = (id: string) => {
    setDeleteConfirmModal({ isOpen: true, type: 'coordinator', id, message: 'Are you sure you want to delete this coordinator profile?' });
  };

  const handleDeleteStudent = (id: string) => {
    setDeleteConfirmModal({ isOpen: true, type: 'student', id, message: 'Are you sure you want to delete this student profile?' });
  };

  const handleDeleteClass = (id: string) => {
    setDeleteConfirmModal({ isOpen: true, type: 'class', id, message: 'Are you sure you want to delete this class? This will dissociate linked students and delete associated timetables.' });
  };

  const handleDeleteTimetableEntry = (id: string) => {
    setDeleteConfirmModal({ isOpen: true, type: 'timetable', id, message: 'Delete this timetable session?' });
  };

  // Helpers for display resolution
  const getTeacherName = (tId: string) => {
    const t = teachers.find(item => item.id === tId);
    return t ? t.name : 'Unassigned';
  };

  const handleUpdateClassFeeConfigs = (classId: string, configs: any[]) => {
    setClasses(prev => prev.map(c => c.id === classId ? { ...c, feeConfigs: configs } : c));
    toast.success("Fee configurations updated successfully!");
  };

  const getClassName = (cId: string) => {
    const c = classesMap.get(String(cId));
    return c ? `${c.className} - ${c.section}` : 'N/A';
  };

  const getAttendanceStatusClass = (status?: string) => {
    return status === 'present'
      ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
      : status === 'absent'
      ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
      : status === 'late'
      ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
      : status === 'leave'
      ? 'bg-slate-600 text-white border-slate-700 shadow-xs'
      : 'bg-slate-200 text-slate-600 border-slate-300 shadow-xs';
  };

  // Filtering variables
  const filteredTeachers = teachers.filter(t => 
    (t.name?.toLowerCase() || '').includes(teacherSearch.toLowerCase()) ||
    (t.email?.toLowerCase() || '').includes(teacherSearch.toLowerCase()) ||
    (t.subject?.toLowerCase() || '').includes(teacherSearch.toLowerCase())
  );

  const filteredStudents = students.filter(s => {
    const matchesSearch = (s.name?.toLowerCase() || '').includes(studentSearch.toLowerCase()) ||
                          (s.email?.toLowerCase() || '').includes(studentSearch.toLowerCase()) ||
                          (s.rollNumber || '').includes(studentSearch);
    const matchesClass = studentClassFilter === 'all' ? true : s.classId === studentClassFilter;
    return matchesSearch && matchesClass;
  });

  const filteredClasses = classes.filter(c => 
    (c.className?.toLowerCase() || '').includes(classSearch.toLowerCase()) ||
    (c.section?.toLowerCase() || '').includes(classSearch.toLowerCase())
  );

  const filteredCoordinators = coordinators.filter(c => 
    (c.name?.toLowerCase() || '').includes(coordinatorSearch.toLowerCase()) ||
    (c.email?.toLowerCase() || '').includes(coordinatorSearch.toLowerCase()) ||
    (c.username?.toLowerCase() || '').includes(coordinatorSearch.toLowerCase()) ||
    (c.id?.toLowerCase() || '').includes(coordinatorSearch.toLowerCase())
  );

  // Group Timetable elements neatly
  const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const PERIODS = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];

  return (
    <div id="principal-dashboard-root" className="min-h-screen bg-gray-50 flex flex-col md:flex-row pb-16 md:pb-0 relative">
      
      {/* Mobile Top Header Indicator */}
      <div id="mobile-top-bar" className={`md:hidden sticky top-0 z-30 flex items-center justify-between px-3 py-2 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm ${selectedStudentReport ? 'print:hidden' : ''}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/logo.png" alt="Demo School Logo" className="h-9 w-auto object-contain shrink-0" referrerPolicy="no-referrer" />
          <div className="min-w-0 flex flex-col leading-none">
            <h1 className="font-black text-gray-900 tracking-tight uppercase text-sm truncate">Demo School</h1>
            <span className="text-[9px] font-black text-teal-600 uppercase tracking-[0.2em]">Principal Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button 
              onClick={() => setShowNotifDropdown(!showNotifDropdown)}
              className="p-2.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 relative shrink-0"
              title="Notifications"
              aria-label="Toggle notifications"
            >
              <Bell size={20} />
              {relevantNotifications.filter(n => n.isUnread).length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white font-extrabold text-[10px] min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 border border-white">
                  {relevantNotifications.filter(n => n.isUnread).length}
                </span>
              )}
            </button>

            <AnimatePresence>
              {showNotifDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifDropdown(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-none shadow-xl z-50 py-3 flex flex-col font-sans"
                  >
                    <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest">Office Alerts</span>
                      <div className="flex items-center gap-2">
                        {relevantNotifications.length > 0 && (
                          <button onClick={handleMarkAllRead} className="text-xs hover:underline text-amber-600 font-bold uppercase">Mark Read</button>
                        )}
                        {relevantNotifications.length > 0 && (
                          <span className="text-slate-200">|</span>
                        )}
                        <button onClick={handleClearNotifications} className="text-xs hover:underline text-rose-600 font-bold uppercase">Clear</button>
                      </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                      {relevantNotifications.length === 0 ? (
                        <div className="py-8 text-center text-slate-400 text-xs">
                          No office alerts yet
                        </div>
                      ) : (
                        relevantNotifications.map(notif => (
                          <div 
                            key={notif.id} 
                            className={`p-3 text-left transition-colors hover:bg-slate-50/50 ${notif.isUnread ? 'bg-amber-50/40' : ''}`}
                          >
                            <div className="flex items-start gap-2.5">
                              <span className="text-xs">
                                {notif.type === 'attendance_complete' ? '✅' : notif.type === 'fee_due' ? '💰' : '📅'}
                              </span>
                              <div className="space-y-0.5 min-w-0 flex-1">
                                <h4 className="font-extrabold text-xs text-slate-900 leading-tight flex items-center gap-1.5">
                                  <span className="truncate">{notif.title}</span>
                                  {notif.isUnread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>}
                                </h4>
                                <p className="text-xs text-slate-600 leading-relaxed break-words whitespace-normal">{notif.message}</p>
                                <span className="text-[10px] text-slate-400 block font-mono mt-1">{notif.timestamp}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button 
            id="sidebar-toggle-mobile" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 shrink-0"
            aria-label="Toggle navigation menu"
          >
            <Menu size={22} />
          </button>
        </div>
      </div>

      {/* Sidebar Overlay behind Drawer */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)} 
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
        />
      )}

      {/* Principal Sidebar */}
      <div 
        id="sidebar-principal" 
        className={`fixed md:sticky top-0 left-0 h-screen w-60 bg-white border-r border-slate-100 text-slate-900 flex flex-col z-40 transition-transform duration-300 transform md:transform-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } font-sans print:hidden`}
        onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          if (touchStartX.current !== null) {
            const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            if (dx < -50) setSidebarOpen(false);
            touchStartX.current = null;
          }
        }}
      >
        {/* Brand header - Minimalist */}
        <div className="p-4 pb-5 border-b border-slate-50 mb-4">
          <div className="flex items-center justify-between w-full">
            <img src="/logo.png" alt="Demo School Logo" className="h-16 w-auto object-contain animate-bounce-slow" referrerPolicy="no-referrer" />
          </div>
          <div className="flex flex-col items-center gap-1 mt-2">
            <h1 className="text-slate-900 font-black text-sm tracking-[0.2em] uppercase">Demo School</h1>
            <span className="text-[10px] font-black text-teal-600 uppercase tracking-[0.3em]">Principal Office</span>
          </div>
        </div>

        {/* Minimalist Nav */}
        <nav className="flex-1 overflow-y-auto overscroll-contain px-5 space-y-1 custom-scrollbar">
            {[
              { id: 'dashboard', label: 'Home', icon: BarChart2 },
              { id: 'registers', label: 'Records', icon: Database },
              { id: 'management_hub', label: 'Admin Hub', icon: Shield },
              { id: 'timetable', label: 'Schedules', icon: Calendar },
              { id: 'monthly_report', label: 'Reports', icon: FileText, color: 'text-teal-600' },
              { id: 'teacher_pay', label: 'Teacher Pay', icon: Banknote },
              { id: 'analytics', label: 'Analytics', icon: BarChart2, color: 'text-amber-600' },
              { id: 'features_hub', label: 'Features Hub', icon: LayoutGrid },
            ].map(link => {
              const Icon = link.icon;
              const isActive = activeTab === link.id;
              return (
                <button
                  key={link.id}
                  onClick={() => { handleTabChange(link.id as any); setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.2em] transition-all text-left group rounded-xl ${
                    isActive 
                      ? 'text-white bg-amber-600 shadow-lg shadow-amber-200' 
                      : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={14} className={isActive ? 'text-white' : 'text-slate-300 group-hover:text-slate-500'} />
                  {link.label}
                </button>
              );
            })}

            {/* Install Button in Sidebar */}
            <button
              onClick={onInstallApp}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.2em] transition-all text-left group rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 mt-2 border border-teal-100"
            >
              <Download size={14} className="text-teal-600" />
              Install App
            </button>

            {/* Exit System Button in Sidebar */}
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-xs font-bold uppercase tracking-[0.2em] transition-all text-left group rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 mt-2 border border-rose-100"
            >
              <LogOut size={14} className="text-rose-600" />
              Exit System
            </button>
          </nav>

      </div>

      {/* Main Panel */}
      <main className={`flex-1 min-h-screen flex flex-col p-4 md:p-8 lg:p-10 max-w-7xl mx-auto w-full font-sans text-slate-800 ${selectedStudentReport ? 'print:hidden' : ''}`}>
        
        {userSession.role === 'developer' && (
          <div className="bg-amber-100 border border-amber-200 p-3 mb-6 flex items-center justify-between shadow-sm animate-pulse">
            <div className="flex items-center gap-2 text-amber-800">
              <ShieldAlert size={16} />
              <span className="text-xs font-black uppercase tracking-widest">Developer Mode Active: Tracking Principal Dashboard</span>
            </div>
            <div className="text-xs font-bold text-amber-600 uppercase">Superuser Access (KM)</div>
          </div>
        )}
        
        {/* Active Tab View rendering */}

        {/* ========== DASHBOARD OVERVIEW TABLEAUX ========== */}
        {activeTab === 'dashboard' && (
          <div id="panel-principal-dashboard" className="space-y-8 animate-fade-in">
            {/* Greeting Header — page-appropriate title */}
            <div className="bg-amber-600 p-8 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-8 shadow-lg border-b border-amber-700/50">
              <p className="text-[10px] sm:text-xs font-black text-amber-100 uppercase tracking-[0.3em] mb-1">
                Demo School · Principal Portal
              </p>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tighter font-display uppercase leading-tight truncate whitespace-nowrap">
                {userSession.role === 'developer' ? 'System Tracking Dashboard' : 'School Overview'}
              </h2>
            </div>

            {/* Metrics cards bar - Elegant Minimalist */}
            {(() => {
              const currentMonth = MONTHS[new Date().getMonth()];
              const currentMonthName = new Date().toLocaleString('en-US', { month: 'long' });

              // Use feeEngine for accurate pending/collected amounts
              let totalPendingAll = 0;
              let totalCollectedAll = 0;
              let totalPendingMonth = 0;
              let totalCollectedMonth = 0;
              let totalExtraDues = 0;
              let remainingExtraDues = 0;
              let paidStudentsCount = 0;
              let pendingStudentsCount = 0;

              feeStudents.forEach(fs => {
                const pending = getTotalPending(fs) + getTotalOtherFunds(fs);
                const collected = fs.payments.reduce((sum, p) => sum + p.amount, 0);
                totalPendingAll += pending;
                totalCollectedAll += collected;
                // Extra charges: Other Funds + Dues entries ("Add More Fee Categories" + "Add Due")
                // Note: extra fee categories ab dues entries bhi banate hain, is liye payments se alag nahi
                // count hote (double-counting se bachne ke liye sirf dues entries count kiye ja rahe hain)
                totalExtraDues += getTotalOtherFunds(fs);
                (fs.dues || []).forEach(d => {
                  if (d.status !== 'waived') totalExtraDues += getDuePaid(d);
                  remainingExtraDues += getDueRemaining(d);
                });
                remainingExtraDues += getTotalOtherFunds(fs);

                const monthSummary = getMonthlySummary(fs, currentMonth, new Date().getFullYear());
                totalPendingMonth += monthSummary.pending;
                totalCollectedMonth += monthSummary.paid;

                if (monthSummary.paid > 0) paidStudentsCount++;
              });
              pendingStudentsCount = students.length - paidStudentsCount;

              // Live "today" figures for real-time dashboard cards
              const todayISO = new Date().toISOString().split('T')[0];
              const todaysCollection = fees
                .filter(f => f.status === 'paid' && f.paidDate === todayISO)
                .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
              const todayAttendance = attendance.filter(a => a.date === todayISO);
              const todayPresent = todayAttendance.filter(a => a.status === 'present').length;

              // Attendance Avg (real value; '—' when no records marked yet)
              const attendanceAvg = attendance.length > 0
                ? Math.round((attendance.filter(a => a.status === 'present').length / attendance.length) * 100) + '%'
                : '—';

              // Month progress (collected vs due — progress bars ke liye)
              const monthDueTotal = totalCollectedMonth + totalPendingMonth;
              const monthProgress = monthDueTotal > 0 ? Math.round((totalCollectedMonth / monthDueTotal) * 100) : 0;

              return (
                <div className="space-y-8">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 animate-fade-in pt-8 border-t border-slate-100">
                    
                    {[
                      { label: 'Today Collection', val: `PKR ${todaysCollection.toLocaleString()}`, icon: <CreditCard size={16} className="text-teal-600" />, chip: 'bg-teal-50 border-teal-100' },
                      { label: 'Today Attendance', val: `${todayPresent}/${todayAttendance.length}`, icon: <CheckCircle2 size={16} className="text-amber-600" />, chip: 'bg-amber-50 border-amber-100' },
                      { label: 'Fee Paid Students', val: paidStudentsCount, icon: <User size={16} className="text-teal-600" />, chip: 'bg-teal-50 border-teal-100' },
                      { label: 'Pending Students', val: pendingStudentsCount, icon: <AlertCircle size={16} className="text-rose-600" />, chip: 'bg-rose-50 border-rose-100' },
                      { label: 'Teachers', val: teachers.length, icon: <Users size={16} className="text-teal-600" />, chip: 'bg-teal-50 border-teal-100' },
                      { label: 'Students', val: students.length, icon: <Users size={16} className="text-teal-600" />, chip: 'bg-teal-50 border-teal-100' },
                      { label: 'Classes', val: classes.length, icon: <Award size={16} className="text-amber-600" />, chip: 'bg-amber-50 border-amber-100' },
                      { label: 'Attendance Average', val: attendanceAvg, icon: <CheckCircle2 size={16} className="text-teal-600" />, chip: 'bg-teal-50 border-teal-100' },
                    ].map(stat => (
                      <div key={stat.label} className="p-4 md:p-5 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                        <div className="flex items-center gap-2.5 mb-2.5">
                          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${stat.chip}`}>{stat.icon}</div>
                          <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 leading-tight">{stat.label}</span>
                        </div>
                        <span className="text-xl md:text-2xl font-black tracking-tighter text-slate-900 block tabular-nums">{stat.val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Fee Summary Cards — Remaining Fee + Monthly (Total Paid, Remaining) in one row */}
                  {/* Coordinator: Fee/dues cards nahi dikhenge, sirf student count */}
                  {userSession.role !== 'coordinator' && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 animate-fade-in">
                        <button
                          onClick={() => openFeePaymentCenter()}
                          className="p-5 bg-white border border-rose-100 rounded-2xl shadow-sm hover:shadow-lg hover:border-rose-300 hover:-translate-y-0.5 text-left transition-all cursor-pointer group"
                          title="Click — opens Fee Payment Center"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0"><AlertCircle size={18} className="text-rose-500" /></div>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500 leading-tight">Remaining Fee<br />(All Months)</span>
                          </div>
                          <span className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 block tabular-nums">{totalPendingAll.toLocaleString()}</span>
                          <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest mt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">Pay Now <ArrowRight size={11} /></span>
                        </button>
                        <button
                          onClick={() => { setQuickCollectStudentId(''); setShowQuickCollectModal(true); }}
                          className="p-5 bg-white border border-teal-100 rounded-2xl shadow-sm hover:shadow-lg hover:border-teal-300 hover:-translate-y-0.5 text-left transition-all cursor-pointer group"
                          title="Click — Collect Fee + Receipt form opens"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0"><CreditCard size={18} className="text-teal-400" /></div>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-400 leading-tight">{currentMonthName} Fee<br />Total Paid</span>
                          </div>
                          <span className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 block tabular-nums">{totalCollectedMonth.toLocaleString()}</span>
                          <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-400 transition-all duration-500" style={{ width: `${monthProgress}%` }}></div>
                          </div>
                          <span className="text-[10px] font-black text-teal-400 uppercase tracking-widest mt-2 block">{monthProgress}% collected{todaysCollection > 0 ? ` · Today: PKR ${todaysCollection.toLocaleString()}` : ''}</span>
                        </button>
                        <button
                          onClick={() => openFeePaymentCenter()}
                          className="p-5 bg-white border border-amber-100 rounded-2xl shadow-sm hover:shadow-lg hover:border-amber-300 hover:-translate-y-0.5 text-left transition-all cursor-pointer group"
                          title="Click — opens Fee Payment Center"
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0"><AlertCircle size={18} className="text-amber-500" /></div>
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500 leading-tight">{currentMonthName} Fee<br />Remaining</span>
                          </div>
                          <span className="text-2xl md:text-3xl font-black tracking-tighter text-slate-900 block tabular-nums">{totalPendingMonth.toLocaleString()}</span>
                          <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest mt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">Collect Now <ArrowRight size={11} /></span>
                        </button>
                      </div>

                      {/* CTA BUTTONS — side by side */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                      <button
                        onClick={() => openFeePaymentCenter()}
                        className="w-full p-5 bg-gradient-to-r from-amber-600 to-teal-600 hover:from-amber-700 hover:to-teal-700 rounded-2xl shadow-md text-left text-white transition-all cursor-pointer flex items-center justify-between gap-4 group"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                            <CreditCard size={24} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-black uppercase tracking-widest">Fee Payment Center</p>
                            <p className="text-[10px] font-bold text-amber-100 uppercase tracking-widest truncate">Month-wise Fee • Paper Fund • Other Funds • Dues — Everything in one place</p>
                          </div>
                        </div>
                        <span className="px-4 py-2 bg-white text-amber-700 text-[10px] font-black uppercase tracking-widest rounded-xl shrink-0 group-hover:scale-105 transition-transform">Open <ArrowRight size={12} className="inline ml-1" /></span>
                      </button>

                      {/* ⚡ QUICK COLLECT — form dashboard se attached */}
                      <button
                        onClick={() => { setQuickCollectStudentId(''); setShowQuickCollectModal(true); }}
                        className="w-full p-5 bg-amber-600 hover:bg-amber-700 rounded-2xl shadow-md text-left text-white transition-all cursor-pointer flex items-center justify-between gap-4 group"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={24} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-black uppercase tracking-widest">⚡ Collect Fee + Receipt</p>
                            <p className="text-[10px] font-bold text-amber-100 uppercase tracking-widest truncate">Pick a student — instantly collect School NSB Fee / Dues</p>
                          </div>
                        </div>
                        <span className="px-4 py-2 bg-white text-amber-700 text-[10px] font-black uppercase tracking-widest rounded-xl shrink-0 group-hover:scale-105 transition-transform">Open <ArrowRight size={12} className="inline ml-1" /></span>
                      </button>
                      </div>

                      {/* Extra Charges & Dues Summary Cards — HIDDEN for cleaner dashboard */}
                    </>
                  )}
                </div>
              );
            })()}


            {/* Quick action grid */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-none p-6">
              <h2 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2 uppercase tracking-wide font-display">
                {userSession.role === 'principal' ? 'Principal Fast-Track Actions' : 'Coordinator Fast-Track Actions'}
              </h2>

              <div className="mb-6 bg-slate-50 border-l-4 border-slate-900 py-3 px-4 flex items-center gap-2">
                <Plus size={16} className="text-slate-900" />
                <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-900">Add New Entity</span>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <button
                  onClick={() => openAddModal('teacher')}
                  className="flex items-center justify-center gap-2.5 p-4 rounded-xl border border-gray-200 hover:border-teal-500 hover:bg-teal-50/25 text-sm font-semibold text-gray-700 hover:text-teal-700 transition-all text-left"
                >
                  <Users size={16} />
                  Teacher
                </button>

                <button
                  onClick={() => openAddModal('student')}
                  className="flex items-center justify-center gap-2.5 p-4 rounded-xl border border-gray-200 hover:border-teal-500 hover:bg-teal-50/25 text-sm font-semibold text-gray-700 hover:text-teal-700 transition-all text-left"
                >
                  <Users size={16} />
                  Student
                </button>

                <button
                  onClick={() => openAddModal('class')}
                  className="flex items-center justify-center gap-2.5 p-4 rounded-xl border border-gray-200 hover:border-teal-500 hover:bg-teal-50/25 text-sm font-semibold text-gray-700 hover:text-teal-700 transition-all text-left"
                >
                  <BookOpen size={16} />
                  Class
                </button>

                <button
                  onClick={() => openAddModal('timetable')}
                  className="flex items-center justify-center gap-2.5 p-4 rounded-xl border border-gray-200 hover:border-teal-500 hover:bg-teal-50/25 text-sm font-semibold text-gray-700 hover:text-teal-700 transition-all text-left"
                >
                  <Calendar size={16} />
                  Schedule
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== MANAGEMENT HUB (TEACHERS, STUDENTS, CLASSES) ========== */}
        {activeTab === 'management_hub' && (
          <div className="space-y-8 animate-fade-in pb-20">
            {/* Management Hub Sub-Navigation Header */}
            <div className="bg-white/95 backdrop-blur border border-slate-200 p-2 shadow-sm flex flex-wrap gap-2 sticky top-0 z-10 rounded-2xl">
              <button
                onClick={() => setManagementSubTab('teachers')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-[0.2em] transition-all flex items-center justify-center gap-2 rounded-xl ${
                  managementSubTab === 'teachers' 
                    ? 'bg-teal-600 text-white shadow-md' 
                    : 'bg-white text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Users size={14} />
                Teachers
              </button>
              <button
                onClick={() => setManagementSubTab('students')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-[0.2em] transition-all flex items-center justify-center gap-2 rounded-xl ${
                  managementSubTab === 'students' 
                    ? 'bg-teal-600 text-white shadow-md' 
                    : 'bg-white text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Users size={14} />
                Students
              </button>
              <button
                onClick={() => setManagementSubTab('classes')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-[0.2em] transition-all flex items-center justify-center gap-2 rounded-xl ${
                  managementSubTab === 'classes' 
                    ? 'bg-teal-600 text-white shadow-md' 
                    : 'bg-white text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <BookOpen size={14} />
                Classes
              </button>
              <button
                onClick={() => setManagementSubTab('coordinators')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-[0.2em] transition-all flex items-center justify-center gap-2 rounded-xl ${
                  managementSubTab === 'coordinators' 
                    ? 'bg-teal-600 text-white shadow-md' 
                    : 'bg-white text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Shield size={14} />
                Coordinators
              </button>
            </div>

            {/* Hub Content Rendering */}
            <div>
              {/* TEACHERS SUB-VIEW */}
              {managementSubTab === 'teachers' && (
                <div id="panel-principal-teachers" className="space-y-6 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase ">Teacher List</h1>
                    </div>
                    <button
                      onClick={() => openAddModal('teacher')}
                      className="flex items-center justify-center gap-2 py-2.5 px-6 bg-teal-600 hover:bg-teal-700 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg rounded-xl"
                    >
                      <Plus size={14} />
                      Register New Teacher
                    </button>
                  </div>

                  {/* Search filter bar */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      value={teacherSearch}
                      onChange={(e) => setTeacherSearch(e.target.value)}
                      placeholder="Search faculty by name, subject, or email..."
                      className="w-full pl-10 pr-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600 transition-all text-xs font-bold"
                    />
                  </div>

                  {/* Teachers Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredTeachers.map(t => {
                      const isExpanded = !!expandedTeachers[t.id];
                      return (
                        <div key={t.id} className="bg-white border border-slate-200 overflow-hidden hover:border-teal-300 transition-all shadow-xs group">
                          <HoldActionWrapper
                            onEdit={() => openEditModal('teacher', t.id)}
                            onDelete={() => handleDeleteTeacher(t.id)}
                          >
                          <div
                            onClick={() => toggleTeacherExpanded(t.id)}
                            className="p-5 flex items-center justify-between cursor-pointer group-hover:bg-slate-50/50"
                          >
                            <div className="flex items-center gap-4">
                              <div>
                                <h3 className="font-black text-slate-900 uppercase tracking-tight leading-none mb-1.5">{t.name}</h3>
                                <p className="text-xs font-bold text-teal-600 uppercase tracking-widest leading-none">{t.subject}</p>
                              </div>
                            </div>
                            <ChevronDown className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                          </HoldActionWrapper>

                          {isExpanded && (
                            <div className="px-5 pb-5 pt-4 border-t border-slate-100 bg-slate-50/50 space-y-4 animate-fade-in font-sans">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white border border-slate-200 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Login Status</span>
                                  <span className="font-mono text-xs font-bold text-amber-600 bg-amber-50 px-1  uppercase tracking-tighter">Login using Name</span>
                                </div>
                                <div className="p-3 bg-white border border-slate-200 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Access Password</span>
                                  <span className="font-mono text-xs font-bold text-amber-600 bg-amber-50 px-1">{t.password || 'nsb123'}</span>
                                </div>
                                <div className="p-3 bg-white border border-slate-200 col-span-2 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Contact Details</span>
                                  <div className="space-y-1.5">
                                    <p className="text-xs font-bold text-slate-700 flex items-center gap-2"><Mail size={12} className="text-slate-400" /> {t.email}</p>
                                    <p className="text-xs font-bold text-slate-700 flex items-center gap-2"><Phone size={12} className="text-slate-400" /> {t.phone}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
                                <button
                                  onClick={() => openEditModal('teacher', t.id)}
                                  className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all shadow-xs"
                                >
                                  Edit Info
                                </button>
                                <button
                                  onClick={() => handleDeleteTeacher(t.id)}
                                  className="px-3 py-1.5 bg-white border border-rose-200 text-rose-600 font-black text-xs uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-xs"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STUDENTS SUB-VIEW */}
              {managementSubTab === 'students' && (
                <div id="panel-principal-students" className="space-y-6 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase ">Student List</h1>
                    </div>
                    <button
                      onClick={() => openAddModal('student')}
                      className="flex items-center justify-center gap-2 py-2.5 px-6 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg"
                    >
                      <Plus size={14} />
                      Add Student
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input
                        type="text"
                        value={studentSearch}
                        onChange={(e) => setStudentSearch(e.target.value)}
                        placeholder="Search student by name, roll, or parent name..."
                        className="w-full pl-10 pr-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 transition-all text-xs font-bold"
                      />
                    </div>
                    <select
                      value={studentClassFilter}
                      onChange={(e) => setStudentClassFilter(e.target.value)}
                      className="bg-white border border-slate-200 px-4 py-3 text-xs font-bold text-slate-700 outline-none uppercase"
                    >
                      <option value="all">All Classes</option>
                      {classes.map(c => (
                        <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredStudents.map(s => {
                      const isExpanded = !!expandedStudents[s.id];
                      return (
                        <HoldActionWrapper
                          key={s.id}
                          onEdit={() => openEditModal('student', s.id)}
                          onDelete={() => handleDeleteStudent(s.id)}
                          onDetail={() => setStudentDetailModal({ isOpen: true, student: s })}
                          className="bg-white border border-slate-200 overflow-hidden hover:border-amber-300 transition-all group font-sans"
                        >
                          {/* Compact Header (Always Visible) */}
                          <div 
                            onClick={() => toggleStudentExpanded(s.id)}
                            className="p-4 flex items-center justify-between cursor-pointer group-hover:bg-slate-50/50"
                          >
                            <div className="flex items-center gap-3">
                              {s.photo ? (
                                <img src={s.photo} alt={s.name} className="w-8 h-8 rounded-full object-cover border border-slate-200" />
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-black text-xs border border-slate-800">
                                  <User size={14} />
                                </div>
                              )}
                              <div className="min-w-0">
                                <h3 className="font-black text-slate-900 uppercase tracking-tight text-sm truncate leading-none mb-1">{s.name.split(' ').slice(0, 1).join(' ') || s.name}</h3>
                                <div className="flex items-center gap-2">
                                  {s.category === 'Academy' && (
                                    <span className="text-xs bg-teal-50 text-teal-700 border border-teal-100 font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Academy</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <ChevronDown className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} size={16} />
                          </div>
                          
                          {/* Expanded Details Section */}
                          {isExpanded && (
                            <div className="px-5 pb-5 pt-3 border-t border-slate-100 bg-slate-50/50 space-y-4 animate-fade-in">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white border border-slate-200 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Guardian Contact</span>
                                  <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <Phone size={10} className="text-amber-500" /> {s.parentPhone}
                                  </p>
                                </div>
                                <div className="p-3 bg-white border border-slate-200 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Fee Settings</span>
                                  <p className="text-xs font-bold text-teal-600 flex items-center gap-2">
                                    <CreditCard size={10} /> Base Fee: {s.baseFee}
                                  </p>
                                </div>
                              </div>

                              {s.category === 'Academy' && s.academySubjects && s.academySubjects.length > 0 && (
                                <div className="p-3 bg-teal-50/50 border border-teal-100 shadow-xs">
                                  <span className="text-xs font-black text-teal-400 uppercase block mb-1.5">Academy Subjects Focus</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {s.academySubjects.map((sub, idx) => (
                                      <span key={idx} className="bg-white border border-teal-200 text-teal-700 text-xs font-bold px-2 py-0.5 uppercase ">
                                        {sub}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center justify-between pt-2 border-t border-slate-100 mt-2">
                                <div className="flex gap-2">
                                  <button onClick={() => openEditModal('student', s.id)} className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-amber-600 transition-all shadow-xs"><Edit2 size={12}/></button>
                                  <button onClick={() => handleDeleteStudent(s.id)} className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-rose-600 transition-all shadow-xs"><Trash2 size={12}/></button>
                                </div>
                                <button 
                                  onClick={() => { setFeeSearch(s.name); handleTabChange('fees'); window.scrollTo({top:0, behavior:'smooth'}); }}
                                  className="px-4 py-2 bg-amber-600 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-900 transition-all shadow-md "
                                >
                                  Collect Fee ➔
                                </button>
                              </div>
                            </div>
                          )}
                        </HoldActionWrapper>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* CLASSES SUB-VIEW */}
              {managementSubTab === 'classes' && (
                <div id="panel-principal-classes" className="space-y-6 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase ">Class List</h1>
                    </div>
                    <button
                      onClick={() => openAddModal('class')}
                      className="flex items-center justify-center gap-2 py-2.5 px-6 bg-slate-900 hover:bg-teal-600 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg"
                    >
                      <Plus size={14} />
                      Add New Section
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredClasses.map(c => {
                      const classTeacher = teachers.find(t => t.id === c.classTeacherId);
                      const studentCount = students.filter(s => s.classId === c.id).length;
                      return (
                        <div key={c.id} className="bg-white border border-slate-200 p-6 flex flex-col items-start gap-5 hover:shadow-xl transition-all font-sans relative overflow-hidden group">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-slate-50 -mr-8 -mt-8 rotate-45 group-hover:bg-teal-50 transition-colors"></div>
                          
                          <HoldActionWrapper
                            onEdit={() => openEditModal('class', c.id)}
                            onDelete={() => handleDeleteClass(c.id)}
                            onDetail={() => {
                              setSelectedClassForDetails(c);
                              setIsClassDetailModalOpen(true);
                            }}
                          >
                          <div
                            onClick={() => {
                              setSelectedClassForDetails(c);
                              setIsClassDetailModalOpen(true);
                            }}
                            className="flex items-center gap-5 relative z-10 w-full cursor-pointer"
                          >
                            <div className="w-16 h-16 bg-slate-950 text-white flex flex-col items-center justify-center border-l-4 border-teal-600 shrink-0 overflow-hidden">
                              <span className="text-xs font-black w-full text-center px-1 uppercase leading-tight">{c.className}</span>
                              <span className="text-xs font-bold uppercase tracking-widest bg-teal-600 w-full text-center py-0.5 px-1 truncate">{c.section}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-black uppercase text-slate-400 tracking-widest mb-1 leading-none">Class Teacher</h4>
                              <p className="text-sm font-black text-slate-900 uppercase  mb-2 truncate">{classTeacher?.name || 'Vacant Slot'}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-teal-600 bg-teal-50 px-2 py-0.5 flex items-center gap-1 uppercase tracking-tighter">
                                  <Users size={10}/> {studentCount} Enrolled
                                </span>
                              </div>
                              {c.subjects && c.subjects.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {c.subjects.slice(0, 3).map(sub => (
                                    <span key={sub} className="text-[10px] font-bold text-slate-400 border border-slate-100 px-1.5 py-0.5 uppercase tracking-tighter">
                                      {sub}
                                    </span>
                                  ))}
                                  {c.subjects.length > 3 && (
                                    <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 uppercase tracking-tighter">
                                      +{c.subjects.length - 3} More
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          </HoldActionWrapper>

                          <div className="flex gap-2 w-full pt-4 border-t border-slate-50 relative z-10">
                            <button
                              onClick={() => openEditModal('class', c.id)}
                              className="flex-1 py-1.5 bg-slate-50 text-slate-400 hover:text-teal-600 hover:bg-white transition-all border border-slate-100 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5"
                            >
                              <Edit2 size={12} /> Edit
                            </button>
                            <button
                              onClick={() => handleDeleteClass(c.id)}
                              className="flex-1 py-1.5 bg-slate-50 text-slate-400 hover:text-rose-600 hover:bg-white transition-all border border-slate-100 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* COORDINATORS SUB-VIEW */}
              {managementSubTab === 'coordinators' && (
                <div id="panel-principal-coordinators" className="space-y-6 animate-fade-in">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase ">Coordinator List</h1>
                    </div>
                    <button
                      onClick={() => openAddModal('coordinator')}
                      className="flex items-center justify-center gap-2 py-2.5 px-6 bg-slate-900 hover:bg-teal-600 text-white font-black text-xs uppercase tracking-widest transition-all shadow-lg"
                    >
                      <Plus size={14} />
                      Register New Coordinator
                    </button>
                  </div>

                  {/* Search filter bar */}
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-gray-400">
                      <Search size={16} />
                    </span>
                    <input
                      type="text"
                      value={coordinatorSearch}
                      onChange={(e) => setCoordinatorSearch(e.target.value)}
                      placeholder="Search coordinators by name, username, or email..."
                      className="w-full pl-10 pr-4 py-3.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-teal-600 transition-all text-xs font-bold"
                    />
                  </div>

                  {/* Coordinators Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredCoordinators.map(c => {
                      const isExpanded = !!expandedCoordinators[c.id];
                      return (
                        <div key={c.id} className="bg-white border border-slate-200 overflow-hidden hover:border-teal-300 transition-all shadow-xs group">
                          <HoldActionWrapper
                            onEdit={() => openEditModal('coordinator', c.id)}
                            onDelete={() => handleDeleteCoordinator(c.id)}
                          >
                          <div
                            onClick={() => toggleCoordinatorExpanded(c.id)}
                            className="p-5 flex items-center justify-between cursor-pointer group-hover:bg-slate-50/50"
                          >
                            <div className="flex items-center gap-4">
                              <div>
                                <h3 className="font-black text-slate-900 uppercase tracking-tight leading-none mb-1.5">{c.name}</h3>
                                <p className="text-xs font-bold text-teal-600 uppercase tracking-widest leading-none">Academic Coordinator</p>
                              </div>
                            </div>
                            <ChevronDown className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                          </HoldActionWrapper>

                          {isExpanded && (
                            <div className="px-5 pb-5 pt-4 border-t border-slate-100 bg-slate-50/50 space-y-4 animate-fade-in font-sans">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white border border-slate-200 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Login Status</span>
                                  <span className="font-mono text-xs font-bold text-amber-600 bg-amber-50 px-1  uppercase tracking-tighter">Login using Name</span>
                                </div>
                                <div className="p-3 bg-white border border-slate-200 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Access Password</span>
                                  <span className="font-mono text-xs font-bold text-amber-600 bg-amber-50 px-1">{c.password || 'nsb123'}</span>
                                </div>
                                <div className="p-3 bg-white border border-slate-200 col-span-2 shadow-xs">
                                  <span className="text-xs font-black text-slate-400 uppercase block mb-1">Contact Details</span>
                                  <div className="space-y-1.5">
                                    <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                      <Mail size={12} className="text-slate-400" /> {c.email}
                                    </p>
                                    {c.phone && (
                                      <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                        <Phone size={12} className="text-slate-400" /> Phone: {c.phone}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 mt-2">
                                <button
                                  onClick={() => openEditModal('coordinator', c.id)}
                                  className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all shadow-xs"
                                >
                                  Edit Info
                                </button>
                                <button
                                  onClick={() => handleDeleteCoordinator(c.id)}
                                  className="px-3 py-1.5 bg-white border border-rose-200 text-rose-600 font-black text-xs uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all shadow-xs"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== TIMETABLE TABLEAUX ========== */}
        {activeTab === 'timetable' && (
          <div id="panel-principal-timetable" className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Interactive Class Timetable</h1>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Auto-generate, drag & drop, edit periods</p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-center">
                <button
                  onClick={() => {
                    if (!selectedTimetableClass) {
                      toast.error("Select a class first!");
                      return;
                    }
                    const cls = classes.find(c => c.id === selectedTimetableClass);
                    if (!cls) return;

                    const classSubjects = cls.subjects || [];
                    if (classSubjects.length === 0) {
                      toast.error("No subjects assigned to this class. Add subjects first via Management Hub.");
                      return;
                    }

                    const matchedTeachers: { subject: string; teacherId: string }[] = [];
                    classSubjects.forEach(sub => {
                      const teacher = teachers.find(t => t.subject.toLowerCase().includes(sub.toLowerCase()));
                      if (teacher) {
                        matchedTeachers.push({ subject: sub, teacherId: teacher.id });
                      }
                    });

                    if (matchedTeachers.length === 0) {
                      toast.error("No teachers found matching class subjects. Assign teachers first.");
                      return;
                    }

                    const existingForClass = timetable.filter(tt => tt.classId === selectedTimetableClass);
                    if (existingForClass.length > 0) {
                      if (!window.confirm(`This class already has ${existingForClass.length} scheduled entries. Auto-generate will ADD new entries to empty slots only. Continue?`)) return;
                    }

                    const defaultTimeSlots = [
                      '08:30 AM - 09:30 AM',
                      '09:30 AM - 10:30 AM',
                      '10:30 AM - 11:30 AM',
                      '11:30 AM - 12:30 PM',
                      '01:00 PM - 02:00 PM',
                      '02:00 PM - 03:00 PM',
                    ];

                    const classPeriods = allPeriods;
                    const daysToFill = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

                    const newEntries: TimetableEntry[] = [];
                    let teacherRotation: Record<string, number> = {};
                    matchedTeachers.forEach(mt => { teacherRotation[mt.teacherId] = 0; });

                    daysToFill.forEach(day => {
                      classPeriods.forEach((period, pIdx) => {
                        const alreadyExists = timetable.some(
                          tt => tt.classId === selectedTimetableClass && tt.day === day && tt.period === period
                        );
                        if (alreadyExists) return;

                        const timeSlot = defaultTimeSlots[pIdx] || `${String(8 + pIdx).padStart(2, '0')}:00 AM - ${String(9 + pIdx).padStart(2, '0')}:00 AM`;
                        const subjectIdx = (pIdx + daysToFill.indexOf(day)) % matchedTeachers.length;
                        const chosen = matchedTeachers[subjectIdx];

                        newEntries.push({
                          id: `tt_auto_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                          classId: selectedTimetableClass,
                          day: day as DayOfWeek,
                          period,
                          time: timeSlot,
                          subject: chosen.subject,
                          teacherId: chosen.teacherId,
                        });
                      });
                    });

                    if (newEntries.length === 0) {
                      toast.info("All slots already filled! Nothing to auto-generate.");
                      return;
                    }

                    setTimetable(prev => [...prev, ...newEntries]);
                    toast.success(`Auto-generated ${newEntries.length} timetable entries for ${cls.className}!`);
                  }}
                  className="flex items-center justify-center gap-2 py-2 px-4 bg-gradient-to-r from-amber-500 to-teal-500 hover:from-amber-600 hover:to-teal-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                >
                  <Zap size={16} />
                  Auto-Generate
                </button>
                <button
                  id="add-timetable-entry-trigger"
                  onClick={() => openAddModal('timetable')}
                  className="flex items-center justify-center gap-2 py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                >
                  <Plus size={16} />
                  Schedule Period
                </button>
              </div>
            </div>

            {/* Dropdown selectors */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Select Academic Classroom :
              </span>
              <div className="flex-1 max-w-sm">
                <select
                  id="timetable-view-class-select"
                  value={selectedTimetableClass}
                  onChange={(e) => setSelectedTimetableClass(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:border-teal-500 text-sm"
                >
                  <option value="" disabled>Select a Class</option>
                  {classes.map(cl => (
                    <option key={cl.id} value={cl.id}>{cl.className} (Section {cl.section})</option>
                  ))}
                </select>
              </div>
              <button
                  onClick={() => {
                     const currentLength = allPeriods.length;
                     const nextNumber = currentLength + 1;
                     const nextPeriodName = `Period ${nextNumber}`;
                     
                     // Direct open modal with prefilled data
                     setTtClassId(selectedTimetableClass);
                     setTtPeriod(nextPeriodName);
                     setIsCustomPeriod(true); // force custom text input in modal
                     setTtDay('Monday');
                     setTtSubject('');
                     setTtTime('02:00 PM - 03:00 PM'); // guestimate time
                     setModalType('timetable');
                     setModalMode('add');
                     setIsModalOpen(true);
                     
                     toast.info(`Creating schedule slot for ${nextPeriodName}. Fill timetable details to save!`);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold"
               >
                 + Add Period Slot
               </button>
             </div>
             
             {/* Extra Periods Info */}
             <div className="flex flex-wrap gap-1.5 mt-2">
                {allPeriods.length > 5 && (
                  <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-2.5 py-1 rounded-md uppercase tracking-wide">
                    {allPeriods.length - 5} Extra Period(s) Active
                  </span>
                )}
             </div>
              {/* Timetable Grid View */}
            {selectedTimetableClass ? (
              <div className="space-y-4">
                 {DAYS.map(day => (
                   <div key={day} className="space-y-3">
                     <div className="flex items-center justify-between px-2 pt-2 border-l-2 border-slate-200">
                        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">{day} Schedule</h3>
                        <button 
                          onClick={() => {
                            setTtDay(day);
                            setTtClassId(selectedTimetableClass);
                            // Set a sensible default period if possible
                            const existingCount = timetable.filter(tt => tt.classId === selectedTimetableClass && tt.day === day).length;
                            setTtPeriod(`Period ${existingCount + 1}`);
                            openAddModal('timetable');
                          }}
                          className="flex items-center gap-1 px-2 py-1 bg-teal-50 text-teal-600 hover:bg-teal-600 hover:text-white rounded text-xs font-black uppercase tracking-widest transition-all shadow-sm group"
                        >
                          <Plus size={12} className="group-hover:rotate-90 transition-transform" />
                          <span>Append Period</span>
                        </button>
                     </div>
                     <div className="grid grid-cols-5 sm:grid-cols-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 sm:gap-2">
                        {allPeriods.map(p => {
                           const entry = timetable.find(
                             tt => tt.classId === selectedTimetableClass && 
                                  tt.day === day && 
                                  tt.period === p
                           );
                           const col = getPeriodColor(p);
                           const status = getPeriodStatus(entry?.time || '');
                           const statusCol = getStatusColor(status);
                           return (
                             <div 
                               key={p} 
                               draggable={!!entry}
                               onDragStart={e => handleDragStart(e, { day, period: p, entry })}
                               onDragOver={handleDragOver}
                               onDrop={e => handleDrop(e, { day, period: p })}
                               onClick={() => setSelectedSlot({day, period: p})}
                               className={`border border-slate-100 p-1 px-1.5 sm:p-4 transition-all rounded-r-xl ${entry ? 'shadow-xs' : 'hover:bg-slate-50/50'} cursor-pointer ${
                                 selectedSlot?.day === day && selectedSlot?.period === p ? 'ring-2 ring-teal-500' : ''
                               }`}
                               style={{
                                 borderLeft: `4px solid ${statusCol}`,
                                 backgroundColor: entry ? `${statusCol}10` : 'white'
                               }}
                             >
                               <div className="flex justify-between items-center mb-1 sm:mb-2 pb-0.5 sm:pb-1 border-b border-dashed border-slate-100/80">
                                 <div className="flex items-center gap-0.5 sm:gap-1.5 overflow-hidden">
                                    <span className="text-[10px] sm:text-xs font-black uppercase tracking-tight sm:tracking-widest text-slate-500 truncate" style={{ color: statusCol }}>{p}</span>
                                    {allPeriods.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeletePeriod(p, day);
                                        }}
                                        className="p-0.5 rounded text-slate-300 hover:text-red-500 hover:bg-slate-100 transition-all"
                                        title={`Remove "${p}" completely from this class`}
                                      >
                                        <X size={10} className="w-2.5 h-2.5 sm:w-3 sm:h-3 stroke-[2.5] pointer-events-none" />
                                      </button>
                                    )}
                                 </div>
                                 <div className="flex items-center gap-0.5 sm:gap-1.5">
                                   {p === allPeriods[allPeriods.length - 1] && (
                                     <button 
                                       type="button"
                                       onClick={(e) => {
                                         e.stopPropagation();
                                         const currentLength = allPeriods.length;
                                         const nextNumber = currentLength + 1;
                                         const nextPeriodName = `Period ${nextNumber}`;

                                         setTtClassId(selectedTimetableClass);
                                         setTtPeriod(nextPeriodName);
                                         setIsCustomPeriod(true);
                                         setTtDay(day);
                                         setTtSubject('');
                                         setTtTime('02:00 PM - 03:00 PM');
                                         setModalType('timetable');
                                         setModalMode('add');
                                         setIsModalOpen(true);

                                         toast.info(`Creating schedule slot for ${nextPeriodName} on ${day}. Fill timetable details to save!`);
                                       }}
                                       className="p-0.5 sm:p-1 rounded bg-teal-600 hover:bg-teal-700 text-white font-black text-[6px] sm:text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-0.5 sm:gap-1 shadow-sm px-1 sm:px-2"
                                       title="Add Next Period"
                                     >
                                       <Plus size={8} className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 stroke-[3]" /> <span className="hidden xs:inline">Add</span>
                                     </button>
                                    )}
                  </div>
                </div>
                               {entry ? (
                                 <div className="space-y-0.5 sm:space-y-1 overflow-hidden">
                                   <p className="font-extrabold text-xs sm:text-xs uppercase tracking-tight  text-slate-900 truncate" style={{ color: col }} title={entry.subject}>{entry.subject}</p>
                                   <p className="text-slate-500 text-[6px] sm:text-xs font-bold uppercase tracking-wider sm:tracking-widest truncate" title={getTeacherName(entry.teacherId)}>{getTeacherName(entry.teacherId)}</p>
                                   <div className="flex items-center gap-1 sm:gap-2 pt-0.5 sm:pt-2 border-t border-slate-200/50 mt-1 sm:mt-2">
                                     <button onClick={() => openEditModal('timetable', entry.id)} className="text-slate-400 hover:text-slate-700 transition-colors"><Edit2 size={8} className="w-2 h-2 sm:w-2.5 sm:h-2.5" /></button>
                                     <button onClick={() => handleDeleteTimetableEntry(entry.id)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={8} className="w-2 h-2 sm:w-2.5 sm:h-2.5" /></button>
                                   </div>
                                 </div>
                               ) : (
                                 <button 
                                   onClick={() => {
                                       setTtDay(day);
                                       setTtPeriod(p);
                                       openAddModal('timetable');
                                   }}
                                   className="w-full text-slate-400 hover:text-slate-600 font-bold text-[10px] sm:text-xs uppercase  text-left pt-0.5 sm:pt-1 truncate"
                                 >
                                   + Assign
                                 </button>
                               )}
                             </div>
                           );
                        })}
                     </div>
                   </div>
                 ))}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-400 font-sans border border-dashed border-gray-300 rounded-xl bg-white">
                Please configure and select a class to inspect timetables.
              </div>
            )}
          </div>
        )}

        {activeTab === 'monthly_report' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tighter uppercase flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0"><FileText size={18} className="text-teal-600" /></span>
                  Student Report
                </h1>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400 mt-2">
                  Academic & Financial Analytics Hub
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <select 
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase outline-none focus:border-teal-500 shadow-sm"
                  value={reportClassFilter}
                  onChange={(e) => setReportClassFilter(e.target.value)}
                >
                  <option value="all">All Classes</option>
                  {classes.map(c => (
                    <option key={c.id} value={c.id}>{c.className} ({c.section})</option>
                  ))}
                </select>
                <select 
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase outline-none focus:border-teal-500 shadow-sm"
                  value={new Date().getFullYear()}
                  onChange={() => {}}
                >
                  <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
                  <option value={new Date().getFullYear() - 1}>{new Date().getFullYear() - 1}</option>
                </select>
                <select 
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase outline-none focus:border-teal-500 shadow-sm"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value as Month)}
                >
                  {MONTHS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Performance Grid */}
            <div className="grid grid-cols-1 gap-6">
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                  <h2 className="text-sm font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                    <Users size={18} className="text-teal-600" /> 
                    {reportClassFilter === 'all' ? 'All Classes' : `Class ${classes.find(c => c.id === reportClassFilter)?.className}`} Student Summary
                  </h2>
                  <div className="flex gap-2 print:hidden">
                    <button 
                      onClick={handlePrintSummary}
                      className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                      title="Print Summary"
                    >
                      <Printer size={14} className="text-slate-600" />
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-1.5 py-2 text-xs font-black uppercase tracking-tight text-slate-500">Student</th>
                        <th className="px-1.5 py-2 text-xs font-black uppercase tracking-tight text-center">Fee Status</th>
                        <th className="px-1.5 py-2 text-xs font-black uppercase tracking-tight text-center">Test Avg</th>
                        <th className="px-1.5 py-2 text-xs font-black uppercase tracking-tight text-right">Pending</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {students
                        .filter(s => reportClassFilter === 'all' || s.classId === reportClassFilter)
                        .map(s => {
                        const feeData = feeStudents.find(fs => String(fs.id) === String(s.id));
                        const feeSummary = feeData ? getMonthlySummary(feeData, reportMonth, new Date().getFullYear()) : null;
                        const totalPending = feeData ? getTotalPending(feeData) + getTotalOtherFunds(feeData) : 0;
                        
                        const studentMarks = marks.filter(m => m.studentId === s.id);
                        const avg = studentMarks.length > 0 
                          ? Math.round(studentMarks.reduce((sum, m) => sum + Number(m.marksObtained), 0) / studentMarks.length)
                          : 0;
                        
                        const getGrade = (a: number) => {
                          if (a >= 90) return 'A+';
                          if (a >= 80) return 'A';
                          if (a >= 70) return 'B';
                          if (a >= 60) return 'C';
                          if (a >= 50) return 'D';
                          return 'F';
                        };

                        return (
                          <tr 
                            key={s.id} 
                            onClick={() => setSelectedStudentReport(s)}
                            className="hover:bg-slate-50 transition-colors group cursor-pointer"
                          >
                            <td className="px-1.5 py-2">
                              <div className="flex items-center gap-2">
                                <div>
                                  <p className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-teal-600 transition-colors leading-tight">{s.name}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-1.5 py-2 text-center">
                              {feeSummary?.pending === 0 ? (
                                <span className="bg-amber-50 text-amber-600 text-xs font-black px-1.5 py-0.5 rounded-full uppercase border border-amber-100">Paid</span>
                              ) : (
                                <span className="bg-rose-50 text-rose-600 text-xs font-black px-1.5 py-0.5 rounded-full uppercase border border-rose-100">Unpaid</span>
                              )}
                            </td>
                            <td className="px-1.5 py-2 text-center">
                              <span className="text-xs font-black text-slate-900">{avg > 0 ? `${avg}%` : '0%'}</span>
                            </td>
                            <td className="px-1.5 py-2 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <span className={`text-xs font-black leading-none ${totalPending > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                                  {totalPending}
                                </span>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendFeeNotification(s, 'reminder', 0, '');
                                  }}
                                  className="p-1 text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                                  title="Send Fee Reminder"
                                >
                                  <Send size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========== FEATURES HUB SUB-NAVIGATION HEADER (Admin Hub style) ========== */}
        {activeTab === 'features_hub' && (
          <div className="bg-white/95 backdrop-blur border border-slate-200 p-2 shadow-sm flex flex-wrap gap-2 sticky top-0 z-10 rounded-2xl animate-fade-in">
            {FEATURES_HUB_TABS.map(id => {
              const meta = FEATURES_HUB_META[id];
              const Icon = meta.icon;
              return (
                <button
                  key={id}
                  onClick={() => setFeaturesSubTab(id)}
                  className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-[0.2em] transition-all flex items-center justify-center gap-2 rounded-xl ${
                    featuresSubTab === id
                      ? 'bg-teal-600 text-white shadow-md'
                      : 'bg-white text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={14} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'features_hub' && featuresSubTab === 'alerts' && (
          <div id="notification-center" className="space-y-6 animate-fade-in font-sans pb-20">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-6 mb-8">
              <div>
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight ">Notification Hub</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="px-4 py-2 bg-rose-50 border border-rose-100 rounded-lg text-rose-600">
                  <span className="text-xs font-black uppercase block leading-none">High Priority</span>
                  <span className="text-lg font-black leading-none">{fees.filter(f => f.status === 'unpaid').length}</span>
                </div>
                <div className="px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-slate-600">
                  <span className="text-xs font-black uppercase block leading-none">History Logs</span>
                  <span className="text-lg font-black leading-none">{broadcastLogs.length}</span>
                </div>
              </div>
            </div>

            {/* Attendance Completion / Office Alerts Feed */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <Bell size={14} className="text-amber-600" /> Recent Office Alerts
                </h2>
                <div className="flex items-center gap-2">
                  {relevantNotifications.length > 0 && (
                    <button onClick={handleMarkAllRead} className="text-[10px] font-black uppercase tracking-widest text-amber-600 hover:underline">Mark Read</button>
                  )}
                  {relevantNotifications.length > 0 && <span className="text-slate-200">|</span>}
                  <button onClick={handleClearNotifications} className="text-[10px] font-black uppercase tracking-widest text-rose-600 hover:underline">Clear</button>
                </div>
              </div>

              {relevantNotifications.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell size={28} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No office alerts yet</p>
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mt-1">
                    When a teacher completes class attendance, it will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {relevantNotifications.map(notif => (
                    <div 
                      key={notif.id} 
                      className={`p-3.5 rounded-xl border transition-colors ${notif.isUnread ? 'bg-amber-50/50 border-amber-100' : 'bg-slate-50/50 border-slate-100'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-amber-600/10 flex items-center justify-center text-amber-600 shrink-0">
                          {notif.type === 'attendance_complete' ? '✅' : notif.type === 'fee_due' ? '💰' : '📅'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight truncate">{notif.title}</h4>
                            {notif.isUnread && <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0"></span>}
                          </div>
                          <p className="text-xs text-slate-500 font-medium leading-relaxed mt-1 break-words">{notif.message}</p>
                          <span className="text-[10px] font-mono text-slate-300 block mt-1.5">{notif.timestamp}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Teacher Diary Overview */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <FileText size={14} className="text-teal-600" /> Teacher Diary Overview
                </h2>
                <span className="text-[10px] font-black uppercase tracking-widest text-teal-600">{assignments.length} Posted</span>
              </div>

              {assignments.length === 0 ? (
                <div className="py-10 text-center">
                  <FileText size={28} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No assignments posted yet</p>
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mt-1">
                    Teacher-posted homework will be visible here and on student portals.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto">
                  {assignments
                    .slice()
                    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                    .map(assn => {
                      const cls = classesMap.get(String(assn.classId));
                      return (
                        <div key={assn.id} className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="px-2 py-0.5 bg-teal-50 text-teal-600 border border-teal-100 rounded-full text-[9px] font-black uppercase tracking-widest">{assn.subject}</span>
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-[9px] font-black uppercase tracking-widest">
                                  {cls ? `${cls.className}-${cls.section}` : assn.classId}
                                </span>
                              </div>
                              <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight mt-1.5 truncate">{assn.title}</h4>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                By {assn.assignedByName} • Due {assn.dueDate}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2">
              {(() => {
                const unpaidFees = fees.filter(f => f.status === 'unpaid');
                if (unpaidFees.length === 0) {
                  return (
                    <div className="py-20 text-center border-2 border-dashed border-slate-100 rounded-xl">
                      <CheckCircle2 size={32} className="mx-auto text-amber-500 mb-4 opacity-20" />
                      <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">System Ledger Clear</p>
                    </div>
                  );
                }

                const studentDefaultersMap: Record<string, { student: Student; fees: FeeRecord[] }> = {};
                unpaidFees.forEach(f => {
                  const s = students.find(st => st.id === f.studentId);
                  if (s) {
                    if (!studentDefaultersMap[s.id]) {
                      studentDefaultersMap[s.id] = { student: s, fees: [] };
                    }
                    studentDefaultersMap[s.id].fees.push(f);
                  }
                });

                return Object.values(studentDefaultersMap).map(({ student, fees: sFees }) => {
                  const classObj = classes.find(c => c.id === student.classId);
                  const totalPending = sFees.reduce((acc, curr) => acc + curr.amount, 0);
                  const months = sFees.map(f => f.month).join(', ');
                  
                  const waMessage = appSettings.feeTemplate
                    .replace(/{student_name}/g, student.name)
                    .replace(/{class_name}/g, classObj ? `${classObj.className}-${classObj.section}` : '')
                    .replace(/{total_pending}/g, totalPending.toString())
                    .replace(/{months}/g, months || 'Current Month')
                    .replace(/{date}/g, new Date().toISOString().split('T')[0]);
                  
                  const waUrl = `https://api.whatsapp.com/send?phone=${student.parentPhone.replace(/[^0-9]/g, '') || '923001234567'}&text=${encodeURIComponent(waMessage)}`;

                  return (
                    <motion.div 
                      key={student.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-slate-100 p-4 flex flex-col md:flex-row items-center justify-between hover:bg-slate-50/50 transition-all rounded-lg gap-4"
                    >
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="w-10 h-10 bg-slate-900 text-white flex items-center justify-center font-black text-xs uppercase ">
                           <User size={18} />
                        </div>
                        <div className="text-left">
                          <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">{student.name.split(' ').slice(0, 1).join(' ') || student.name}</h3>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">
                            {classObj?.className}-{classObj?.section} • {totalPending}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full md:w-auto">
                        <div className="hidden lg:block text-xs text-slate-400  max-w-[200px] truncate overflow-hidden bg-slate-50 px-2 py-1 rounded">
                          "{waMessage}"
                        </div>
                        <a 
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            setBroadcastLogs(prev => [{
                              id: 'notif_' + Date.now(),
                              recipient: `${student.name}'s Parent`,
                              phone: student.parentPhone || '',
                              type: 'WhatsApp',
                              text: `Sent consolidated alert for ${totalPending}`,
                              timestamp: new Date().toLocaleString(),
                              status: 'Sent'
                            }, ...prev]);
                            toast.success(`Alert dispatched for ${student.name}`);
                          }}
                          className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-amber-600 hover:bg-slate-900 text-white px-5 py-2.5 rounded text-xs font-black uppercase tracking-widest transition-all"
                        >
                          <Phone size={14} fill="currentColor" />
                          Send Alert
                        </a>
                      </div>
                    </motion.div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* ========== AUDIT HUB (REGISTERS / RECORDS) PANEL ========== */}
        {activeTab === 'registers' && (
          <div id="panel-principal-registers" className="space-y-6 animate-fade-in pb-20">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-amber-600 to-teal-700 p-6 sm:p-8 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-8 shadow-lg border-b border-amber-700/50 rounded-b-2xl text-white">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black tracking-tight font-display uppercase leading-none flex items-center gap-3 whitespace-nowrap">
                    <Database size={24} className="text-amber-200 shrink-0" />
                    School Registers & Records
                  </h2>
                </div>
                <div className="flex items-center gap-2 bg-amber-900/40 backdrop-blur-sm px-4 py-2 rounded-xl border border-amber-400/20 text-xs font-bold">
                  <span className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
                  <span>Real-time Ledger Active</span>
                </div>
              </div>
            </div>

            {/* Sub-tab Switcher Buttons */}
            <div className="bg-white/95 backdrop-blur border border-slate-200 p-2 shadow-sm flex flex-wrap gap-2 sticky top-0 z-10 rounded-2xl rounded-2xl mb-8">
              <button
                onClick={() => setRegistersSubTab('fees')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-widest transition-all flex items-center justify-center gap-2.5 rounded-xl cursor-pointer ${
                  registersSubTab === 'fees'
                    ? 'bg-amber-600 text-white shadow-md scale-[1.01]'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <CreditCard size={16} /> Fees
              </button>
              <button
                onClick={() => setRegistersSubTab('attendance')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-widest transition-all flex items-center justify-center gap-2.5 rounded-xl cursor-pointer ${
                  registersSubTab === 'attendance'
                    ? 'bg-amber-600 text-white shadow-md scale-[1.01]'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2 size={16} /> Attendance
              </button>
              <button
                onClick={() => setRegistersSubTab('results')}
                className={`flex-1 min-w-[120px] py-3.5 px-4 text-xs uppercase font-black tracking-widest transition-all flex items-center justify-center gap-2.5 rounded-xl cursor-pointer ${
                  registersSubTab === 'results'
                    ? 'bg-teal-600 text-white shadow-md scale-[1.01]'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Award size={16} /> Results / WhatsApp
              </button>
            </div>

            {registersSubTab === 'fees' ? (
              /* ================= FEES REGISTER & COLLECTION HUB ================= */
              <div id="audit-fees-section" className="space-y-4 sm:space-y-6 animate-fade-in">
                {/* Header & Main Actions */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4 mb-2">
                  <div>
                    <h2 className="text-lg sm:text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                      <CreditCard className="text-amber-600 shrink-0" size={20} /> Student Fee Collection
                    </h2>
                  </div>
                  <div className="flex items-center gap-2.5 w-full md:w-auto">
                    <button
                      onClick={() => {
                        setQuickCollectStudentId(students[0]?.id || '');
                        setShowQuickCollectModal(true);
                      }}
                      className="flex-1 md:flex-none px-4 sm:px-5 py-2.5 bg-amber-600 text-white text-xs sm:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-slate-900 transition-all shadow-md rounded-xl cursor-pointer"
                    >
                      <Plus size={16} /> ⚡ Collect Fee
                    </button>
                    <button
                      onClick={() => { setFeeReminderSentIds(new Set()); setFeeReminderModal(true); }}
                      className="flex-1 md:flex-none px-4 sm:px-5 py-2.5 bg-white border-2 border-amber-600 text-amber-700 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-amber-600 hover:text-white transition-all shadow-md rounded-xl cursor-pointer"
                      title="Send fee reminders to all parents with pending fees"
                    >
                      <Bell size={16} /> 🔔 Fee Reminders
                    </button>
                    <button
                      onClick={() => {
                        setBulkDueClassId('all');
                        setBulkDueDesc('Paper Fund');
                        setBulkDueAmount('');
                        setBulkDueMonth(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);
                        setShowBulkDueModal(true);
                      }}
                      className="flex-1 md:flex-none px-4 sm:px-5 py-2.5 bg-teal-600 text-white text-xs sm:text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-teal-700 transition-all shadow-md rounded-xl cursor-pointer"
                      title="Apply a due (Paper Fund / Annual Fee / Exam Fee) to EVERY student in a class at once"
                    >
                      <Users size={16} /> 👥 Apply Due to Class
                    </button>

                  </div>
                </div>

                {/* Fee Status Filter */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="grid grid-cols-4 gap-1.5 sm:gap-2 flex-1">
                    {[
                      { key: 'all', label: 'All', active: 'bg-slate-900 text-white border-slate-900 shadow-md', idle: 'bg-white text-slate-500 border-slate-200 hover:border-slate-400' },
                      { key: 'unpaid', label: 'Unpaid', active: 'bg-rose-500 text-white border-rose-500 shadow-md', idle: 'bg-white text-rose-500 border-rose-200 hover:border-rose-400' },
                      { key: 'partial', label: 'Remaining', active: 'bg-amber-500 text-white border-amber-500 shadow-md', idle: 'bg-white text-amber-500 border-amber-200 hover:border-amber-400' },
                      { key: 'paid', label: 'Paid', active: 'bg-amber-600 text-white border-amber-600 shadow-md', idle: 'bg-white text-amber-600 border-amber-200 hover:border-amber-400' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setRecordsFeeStatusFilter(opt.key as 'all' | 'paid' | 'partial' | 'unpaid')}
                        className={`py-2.5 text-[10px] sm:text-xs font-black uppercase tracking-widest rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          recordsFeeStatusFilter === opt.key ? `${opt.active} scale-[1.02]` : opt.idle
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Class Filter */}
                  <select
                    value={recordsFeeClassFilter}
                    onChange={(e) => setRecordsFeeClassFilter(e.target.value)}
                    className="sm:w-48 py-2.5 px-3 text-xs font-black uppercase tracking-widest rounded-xl border border-slate-200 bg-white text-slate-700 cursor-pointer focus:outline-none focus:border-amber-500 transition-all"
                  >
                    <option value="all">All Classes</option>
                    {[...classes].sort((a, b) => a.className.localeCompare(b.className) || a.section.localeCompare(b.section)).map(c => (
                      <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                    ))}
                  </select>
                </div>

                {/* Search Filter */}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={recordsFeeSearch}
                    onChange={(e) => setRecordsFeeSearch(e.target.value)}
                    placeholder="Search by student name, roll no, or class..."
                    className="w-full pl-9 pr-3 py-2.5 text-xs font-bold rounded-xl border border-slate-200 bg-white text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 transition-all"
                  />
                </div>

                {/* Student Fee Roster & In-Place Collect */}
                <div className="bg-white border border-slate-200 shadow-sm overflow-hidden rounded-3xl">
                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 whitespace-nowrap">
                        Student Fee Roster
                      </h3>
                    </div>

                    {/* MOBILE CARD VIEW (< md) */}
                    <div className="block md:hidden">
                      {(() => {
                        if (filteredFeesRoster.length === 0) {
                          return (
                            <div className="py-20 text-center px-6">
                              <Search size={32} className="text-slate-200 mx-auto mb-2" />
                              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No matching students</p>
                            </div>
                          );
                        }

                        // Grouping for mobile
                        const groupedStudents: Record<string, Student[]> = {};
                        filteredFeesRoster.forEach(s => {
                          const cid = s.classId || 'other';
                          if (!groupedStudents[cid]) groupedStudents[cid] = [];
                          groupedStudents[cid].push(s);
                        });

                        return Object.entries(groupedStudents).map(([classId, classStudents]) => {
                          const className = classId === 'other' ? 'Other' : getClassName(classId);
                          
                          return (
                            <div key={classId} className="mb-2">
                              {recordsFeeClassFilter === 'all' && (
                                <div className="px-4 py-2 bg-slate-50 border-y border-slate-100 flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none">Class {className} ({classStudents.length})</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); openClassDuesModal(classId === 'other' ? undefined : classId); }}
                                    className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center gap-1 cursor-pointer shrink-0"
                                    title={`Class ${className} ke students ko Due/Paper Fund lagayein ya collect karein`}
                                  >
                                    <Users size={10} /> Apply Dues
                                  </button>
                                </div>
                              )}
                              <div className="divide-y divide-slate-50">
                                {classStudents.map(student => {
                                  const sFees = fees.filter(f => String(f.studentId) === String(student.id));
                                  const totalPaid = sFees.reduce((sum, f) => sum + Number(f.amount || 0), 0);
                                  const monthlyFee = student.baseFee || 5500;
                                  const isPaidCurrent = totalPaid >= monthlyFee;
                                  const isExpanded = expandedStudentFeeId === String(student.id);
                                  const photo = getStudentPhoto(student);

                                  return (
                                    <div key={student.id} className={`bg-white transition-all ${isExpanded ? 'bg-teal-50/10' : ''}`}>
                                      <HoldActionWrapper
                                        onEdit={() => openEditModal('student', String(student.id))}
                                        onDelete={() => handleDeleteStudent(String(student.id))}
                                        onDetail={() => setStudentDetailModal({ isOpen: true, student })}
                                      >
                                      <div
                                        onClick={() => setExpandedStudentFeeId(isExpanded ? null : String(student.id))}
                                        className="p-4 flex items-center justify-between gap-3 cursor-pointer active:bg-slate-50"
                                      >
                                        <div className="flex items-center gap-3 min-w-0">
                                          <div className="relative">
                                            {photo ? (
                                              <img src={photo} alt={student.name} className="w-10 h-10 rounded-xl object-cover ring-1 ring-slate-100" />
                                            ) : (
                                              <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300"><User size={18} /></div>
                                            )}
                                            <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white ${isPaidCurrent ? 'bg-amber-500' : 'bg-rose-500'}`}></div>
                                          </div>
                                          <div className="min-w-0">
                                            <h4 className="font-black text-slate-900 uppercase tracking-tight text-xs truncate mb-0.5">{student.name}</h4>
                                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Roll #{student.rollNumber || '000'}</p>
                                          </div>
                                        </div>
                                        <ChevronDown size={14} className={`text-slate-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                        </div>
                                        </HoldActionWrapper>

                                        {isExpanded && (
                                        <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-lg space-y-4">
                                            <div className="grid grid-cols-2 gap-2">
                                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                <span className="block text-[9px] font-black text-slate-400 uppercase leading-none mb-1">Status</span>
                                                <span className={`text-[10px] font-black uppercase ${isPaidCurrent ? 'text-amber-600' : 'text-rose-600'}`}>
                                                  {isPaidCurrent ? 'Full Paid' : totalPaid > 0 ? `Partial · Remaining PKR ${Math.max(0, monthlyFee - totalPaid).toLocaleString()}` : 'Unpaid'}
                                                </span>
                                              </div>
                                              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                                                <span className="block text-[9px] font-black text-slate-400 uppercase leading-none mb-1">Balance</span>
                                                <span className="text-[10px] font-black text-slate-900">PKR {Math.max(0, monthlyFee - totalPaid).toLocaleString()}</span>
                                              </div>
                                            </div>

                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setQuickCollectStudentId(String(student.id));
                                                setQuickCollectAmount(String(student.baseFee || 5500));
                                                setShowQuickCollectModal(true);
                                              }}
                                              className="w-full py-3 bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                                            >
                                              <Plus size={14} /> Collect Payment
                                            </button>

                                            {/* Month-wise Fee Breakdown - Base Fee / Paid / Remaining (red) */}
                                            <FeeMonthGrid
                                              feeStudent={feeStudents.find(fs => String(fs.id) === String(student.id))}
                                              student={student}
                                              feeRecords={sFees}
                                              year={feeLedgerYear}
                                              onYearChange={(y) => { setFeeLedgerYear(y); setMonthHistoryFilter(null); }}
                                              selectedMonth={monthHistoryFilter && String(monthHistoryFilter.studentId) === String(student.id) ? monthHistoryFilter.month : null}
                                              onSelectMonth={(m) => setMonthHistoryFilter(m ? { studentId: String(student.id), month: m, year: feeLedgerYear } : null)}
                                              onCollect={(month, pending) => openQuickCollectForMonth(String(student.id), month, feeLedgerYear, pending)}
                                              onDeleteMonth={(month, year) => deleteMonthPayments(String(student.id), month, year)}
                                              onPayDues={() => openFeePaymentCenter(String(student.id))}
                                            />

                                            {(() => {
                                              const hf = monthHistoryFilter && String(monthHistoryFilter.studentId) === String(student.id) ? monthHistoryFilter : null;
                                              const historyFees = hf
                                                ? sFees.filter(f => {
                                                    const k = parseMonthKey(f.month, Number(String(f.dueDate || '').split('-')[0]) || hf.year);
                                                    return k.idx === (MONTH_ALIAS[hf.month.toLowerCase()] ?? -1) && k.year === Number(hf.year);
                                                  })
                                                : sFees;
                                              const fsObj = feeStudents.find(fs => String(fs.id) === String(student.id));
                                              const historyDues = (fsObj?.dues || []).filter(d => {
                                                if (!hf) return true;
                                                const k = parseMonthKey(d.month, d.year || hf.year);
                                                return k.idx === (MONTH_ALIAS[hf.month.toLowerCase()] ?? -1) && k.year === Number(hf.year);
                                              });
                                              return (
                                            <div className="space-y-2">
                                              <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{hf ? `History Log · ${hf.month} ${hf.year}` : 'History Log'}</span>
                                                {hf ? (
                                                  <button
                                                    onClick={() => setMonthHistoryFilter(null)}
                                                    className="px-2 py-0.5 bg-teal-50 border border-teal-200 text-teal-600 text-[9px] font-black uppercase rounded-md hover:bg-teal-100 transition-colors cursor-pointer"
                                                  >
                                                    ✕ All Months
                                                  </button>
                                                ) : (
                                                  <span className="text-[10px] font-bold text-slate-400">{sFees.length} Receipts</span>
                                                )}
                                              </div>
                                              {historyFees.length === 0 ? (
                                                <p className="text-[10px] text-center text-slate-300 py-2 font-bold uppercase">{hf ? `${hf.month} ${hf.year}: No transactions` : 'No records found'}</p>
                                              ) : (
                                                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                                  {historyFees.map(f => (
                                                    <div key={f.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between">
                                                      <div>
                                                        <span className="block text-[10px] font-black text-slate-900 uppercase leading-none mb-1">{f.month} Payment</span>
                                                        <span className="block text-[9px] font-bold text-slate-400 uppercase tabular-nums">{f.paidDate}</span>
                                                      </div>
                                                      <span className="text-xs font-black text-amber-600">PKR {Number(f.amount).toLocaleString()}</span>
<div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                          onClick={(e) => { e.stopPropagation(); openFeeActionModal(f); }}
                                                          className="w-7 h-7 rounded-md bg-white border border-teal-200 text-teal-500 hover:bg-teal-500 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                                                          title="Edit this receipt"
                                                        >
                                                          <Edit2 size={10} />
                                                        </button>
                                                        <button
                                                          onClick={(e) => { e.stopPropagation(); deleteFeeRecord(f); }}
                                                          className="w-7 h-7 rounded-md bg-white border border-rose-200 text-rose-500 hover:bg-rose-500 hover:text-white transition-all cursor-pointer flex items-center justify-center"
                                                          title="Delete this receipt"
                                                        >
                                                          <Trash2 size={10} />
                                                        </button>
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                              {historyDues.length > 0 && (
                                                <div className="pt-1">
                                                  <div className="flex items-center justify-between border-t border-slate-100 pt-2 pb-1">
                                                    <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest">Dues</span>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase">{historyDues.length} entries</span>
                                                  </div>
                                                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                                                    {historyDues.map(d => (
                                                      <div key={d.id} className="p-2.5 bg-rose-50/70 border border-rose-100 rounded-xl flex items-center justify-between gap-2">
                                                        <div className="min-w-0">
                                                          <span className="block text-[10px] font-black text-slate-900 uppercase leading-none mb-0.5 truncate">{d.desc}</span>
                                                          <span className="block text-[9px] font-bold text-slate-400 uppercase tabular-nums">{d.month} {d.year} · Added {formatDateDDMMYY(d.date)}</span>
                                                        </div>
                                                        <span className={`text-[10px] font-black shrink-0 ${d.status === 'paid' ? 'text-amber-600' : d.status === 'waived' ? 'text-amber-600' : 'text-rose-600'}`}>
                                                          {d.status === 'paid' ? 'PAID' : d.status === 'waived' ? 'WAIVED' : 'PENDING'}: PKR {(Number(d.amount) || 0).toLocaleString()}
                                                        </span>
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                               );
                                             })()}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                    {/* DESKTOP TABLE VIEW (>= md) */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left border-separate border-spacing-0">
                        <thead className="bg-slate-50/80 border-b border-slate-200 uppercase text-[10px] font-black tracking-[0.2em] text-slate-500 sticky top-0 z-10 backdrop-blur-md">
                          <tr>
                            <th className="px-6 py-4 border-b border-slate-200">Student & Roll No.</th>
                            <th className="px-6 py-4 border-b border-slate-200">Current Status</th>
                            <th className="px-6 py-4 border-b border-slate-200 text-right">Payment Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(() => {
                            if (filteredFeesRoster.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={3} className="py-20 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                      <Search size={32} className="text-slate-200" />
                                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No student matches your search criteria</p>
                                    </div>
                                  </td>
                                </tr>
                              );
                            }

                            // Grouping logic for "terteeb"
                            const groupedStudents: Record<string, Student[]> = {};
                            filteredFeesRoster.forEach(s => {
                              const cid = s.classId || 'other';
                              if (!groupedStudents[cid]) groupedStudents[cid] = [];
                              groupedStudents[cid].push(s);
                            });

                            return Object.entries(groupedStudents).map(([classId, classStudents]) => {
                              const className = classId === 'other' ? 'Other' : getClassName(classId);
                              
                              return (
                                <React.Fragment key={classId}>
                                  {/* Class Group Header - Only show if showing all classes */}
                                  {recordsFeeClassFilter === 'all' && (
                                    <tr className="bg-slate-50">
                                      <td colSpan={3} className="px-6 py-3 border-y border-slate-200/60">
                                        <div className="flex items-center gap-2">
                                          <div className="w-1.5 h-4 bg-amber-500 rounded-full"></div>
                                          <span className="text-[10px] font-black text-slate-900 uppercase tracking-[0.15em]">Class {className} — {classStudents.length} Students</span>
                                        </div>
                                      </td>
                                    </tr>
                                  )}

                                  {classStudents.map(student => {
                                    const sFees = fees.filter(f => String(f.studentId) === String(student.id));
                                    const totalPaid = sFees.reduce((sum, f) => sum + Number(f.amount || 0), 0);
                                    const monthlyFee = student.baseFee || 5500;
                                    const isPaidCurrent = totalPaid >= monthlyFee;
                                    const isExpanded = expandedStudentFeeId === String(student.id);
                                    const photo = getStudentPhoto(student);

                                    return (
                                      <React.Fragment key={student.id}>
                                        <tr
                                          onClick={() => setExpandedStudentFeeId(isExpanded ? null : String(student.id))}
                                          className={`hover:bg-teal-50/30 transition-all cursor-pointer group ${isExpanded ? 'bg-teal-50/20' : ''}`}
                                        >
                                          <td className="px-6 py-4">
                                            <div className="flex items-center gap-4">
                                              <div className="relative">
                                                {photo ? (
                                                  <img
                                                    src={photo}
                                                    alt={student.name}
                                                    className="w-10 h-10 rounded-2xl object-cover border-2 border-white shadow-sm ring-1 ring-slate-100 shrink-0"
                                                  />
                                                ) : (
                                                  <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0 border border-slate-200">
                                                    <User size={18} />
                                                  </div>
                                                )}
                                                <div className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm ${isPaidCurrent ? 'bg-amber-500' : 'bg-rose-500'}`}></div>
                                              </div>
                                              <div>
                                                <span className="block font-black text-slate-900 uppercase tracking-tight text-xs leading-none mb-1 group-hover:text-amber-600 transition-colors">
                                                  {student.name}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                                                  Roll No. {student.rollNumber || '000'} • {className}
                                                </span>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-6 py-4">
                                            {isPaidCurrent ? (
                                              <div className="flex items-center gap-2">
                                                <div className="px-2.5 py-1.5 bg-amber-50 text-amber-700 text-[10px] font-black tracking-wider rounded-lg border border-amber-100 uppercase flex items-center gap-1.5 w-fit shadow-xs">
                                                  <CheckCircle2 size={12} /> Full Paid
                                                </div>
                                              </div>
                                            ) : totalPaid > 0 ? (
                                              <div className="px-2.5 py-1.5 bg-amber-50 text-amber-700 text-[10px] font-black tracking-wider rounded-lg border border-amber-100 uppercase flex items-center gap-1.5 w-fit shadow-xs">
                                                <Clock size={12} /> Partial · Remaining PKR {Math.max(0, monthlyFee - totalPaid).toLocaleString()}
                                              </div>
                                            ) : (
                                              <div className="px-2.5 py-1.5 bg-rose-50 text-rose-700 text-[10px] font-black tracking-wider rounded-lg border border-rose-100 uppercase flex items-center gap-1.5 w-fit shadow-xs">
                                                <AlertTriangle size={12} /> Pending
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setQuickCollectStudentId(String(student.id));
                                                  setQuickCollectAmount(String(student.baseFee || 5500));
                                                  setShowQuickCollectModal(true);
                                                }}
                                                className="h-8 px-3 bg-amber-600 hover:bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                                              >
                                                <Plus size={12} /> Collect
                                              </button>
                                              <div className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
                                                <ChevronDown size={14} className={`text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                              </div>
                                            </div>
                                          </td>
                                        </tr>

                                        {isExpanded && (
                                          <tr>
                                            <td colSpan={3} className="p-0 border-none overflow-hidden">
                                              <div className="px-6 pb-6 pt-2 bg-teal-50/10 border-b border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                                <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-5 shadow-lg">
                                                  {/* History Header */}
                                                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                                                    <div className="flex items-center gap-3">
                                                      <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
                                                        <Receipt size={20} />
                                                      </div>
                                                      <div>
                                                        <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Fee Ledger History</h4>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">Financial Record for {student.name}</p>
                                                      </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                      <div className="text-right mr-4">
                                                        <span className="block text-[10px] font-black text-slate-400 uppercase">Base Fee</span>
                                                        <span className="block text-sm font-black text-slate-900">PKR {monthlyFee.toLocaleString()}</span>
                                                      </div>
                                                      {Math.max(0, monthlyFee - totalPaid) > 0 && (
                                                        <div className="text-right mr-4">
                                                          <span className="block text-[10px] font-black text-amber-600 uppercase">Remaining Balance</span>
                                                          <span className="block text-sm font-black text-rose-600">PKR {Math.max(0, monthlyFee - totalPaid).toLocaleString()}</span>
                                                        </div>
                                                      )}
                                                      <button
                                                        onClick={() => {
                                                          const text = `Fee Reminder: A payment is pending for ${student.name}. Balance: ${monthlyFee - totalPaid}. Please clear it soon. - NSB Academy`;
                                                          if (student.parentPhone) window.open(`https://api.whatsapp.com/send?phone=${student.parentPhone.replace(/[^0-9]/g, '')}&text=${encodeURIComponent(text)}`, '_blank');
                                                        }}
                                                        className="p-2 bg-white border border-slate-200 hover:border-amber-500 hover:text-amber-600 text-slate-700 rounded-xl transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                                        title="Send WhatsApp Fee Reminder"
                                                      >
                                                        <MessageSquare size={14} />
                                                      </button>
                                                    </div>
                                                  </div>

{/* Month-wise Fee Breakdown - Base Fee / Paid / Remaining (red) */}
                                                  <FeeMonthGrid
                                                    feeStudent={feeStudents.find(fs => String(fs.id) === String(student.id))}
                                                    student={student}
                                                    feeRecords={sFees}
                                                    year={new Date().getFullYear()}
                                                    onCollect={(month, pending) => openQuickCollectForMonth(String(student.id), month, new Date().getFullYear(), pending)}
                                                    onDeleteMonth={(month, year) => deleteMonthPayments(String(student.id), month, year)}
                                                    onPayDues={() => openFeePaymentCenter(String(student.id))}
                                                  />
                                                  {/* History Log List (filtered by clicked month card) */}
                                                  {(() => {
                                                    const hfD = monthHistoryFilter && String(monthHistoryFilter.studentId) === String(student.id) ? monthHistoryFilter : null;
                                                    const deskFees = hfD
                                                      ? sFees.filter(f => {
                                                          const k = parseMonthKey(f.month, Number(String(f.dueDate || '').split('-')[0]) || hfD.year);
                                                          return k.idx === (MONTH_ALIAS[hfD.month.toLowerCase()] ?? -1) && k.year === Number(hfD.year);
                                                        })
                                                      : sFees;
                                                    return (
                                                      <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{hfD ? `History Log · ${hfD.month} ${hfD.year}` : `History Log · All Months`}</span>
                                                          {hfD && (
                                                            <button
                                                              onClick={() => setMonthHistoryFilter(null)}
                                                              className="px-2 py-0.5 bg-teal-50 border border-teal-200 text-teal-600 text-[9px] font-black uppercase rounded-md hover:bg-teal-100 transition-colors cursor-pointer"
                                                            >
                                                              ✕ All Months
                                                            </button>
                                                          )}
                                                        </div>
                                                        {deskFees.length === 0 ? (
                                                          <div className="py-10 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{hfD ? `${hfD.month} ${hfD.year}: No transactions` : 'No previous transaction receipts found'}</p>
                                                          </div>
                                                        ) : (
                                                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                                            {deskFees.map(f => (
                                                              <FeeReceiptCard
                                                          key={f.id}
                                                          fee={f}
                                                          student={student}
                                                          onAction={() => openFeeActionModal(f)}
                                                          onDelete={() => deleteFeeRecord(f)}
                                                        />
                                                            ))}
                                                          </div>
                                                        )}
                                                      </div>
                                                    );
                                                  })()}
                                                </div>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
              </div>
            ) : registersSubTab === 'attendance' ? (
              /* ================= ATTENDANCE REGISTER ================= */
              <div id="audit-attendance-section" className="space-y-6 animate-fade-in">
                {/* Filters & Control Bar */}
                <div className="bg-white p-4 border border-slate-200 rounded-2xl shadow-sm space-y-3">
                  <div className="space-y-3">
                    {/* Row 1: All Classes & Mark Attendance */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="relative flex-1">
                        <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <select
                          value={attendanceFilterClass}
                          onChange={(e) => setAttendanceFilterClass(e.target.value)}
                          className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 text-xs font-bold uppercase tracking-wider focus:outline-none focus:border-amber-500 rounded-xl appearance-none cursor-pointer"
                        >
                          <option value="all">All Classes</option>
                          {classes.map(c => {
                            const classStudentIds = students.filter(s => s.classId === c.id).map(s => s.id);
                            const isMarked = attendance.some(a => a.date === attendanceFilterDate && classStudentIds.includes(a.studentId));
                            return (
                              <option key={c.id} value={c.id}>
                                {c.className} - {c.section} {isMarked ? '✓' : ''}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowMarkAttendanceModal(true);
                            setMarkAttendanceClassId(attendanceFilterClass !== 'all' ? attendanceFilterClass : '');
                          }}
                          className="px-3 py-1.5 bg-slate-900 text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center justify-center hover:bg-amber-600 transition-all shadow-xs rounded-lg cursor-pointer whitespace-nowrap"
                        >
                          Mark Attendance
                        </button>

                        {(userSession.role === 'coordinator' || userSession.role === 'principal') && (
                          <button
                            onClick={handleSendBulkAbsenceWhatsApp}
                            title="WhatsApp Absents"
                            className="p-1.5 bg-amber-600 text-white hover:bg-amber-700 transition-all shadow-sm rounded-lg cursor-pointer flex items-center justify-center"
                          >
                            <MessageSquare size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Row 2: History Mode */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-1">
                        <div className="relative w-full">
                          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                          <input
                            type="date"
                            value={attendanceFilterDate}
                            onChange={(e) => {
                              setAttendanceFilterDate(e.target.value);
                              if (e.target.value) setAttendanceShowAllDates(false);
                            }}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 text-xs font-bold uppercase tracking-wider focus:outline-none focus:border-amber-500 rounded-xl"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Text Search Input */}
                  <div className="relative w-full pt-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                    <input
                      type="text"
                      value={attendanceSearch}
                      onChange={(e) => setAttendanceSearch(e.target.value)}
                      placeholder="Search attendance list by student name or roll number..."
                      className="w-full pl-10 pr-4 py-2 text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-amber-500 transition-all placeholder:text-slate-400 placeholder:font-normal"
                    />
                    {attendanceSearch && (
                      <button
                        onClick={() => setAttendanceSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Summary Metrics & Absentee Alert Pill */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-5 border border-slate-200 shadow-sm flex items-center justify-between rounded-2xl">
                    <div>
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">
                        Daily Attendance Average
                      </p>
                      <h3 className="text-3xl font-black text-amber-600">
                        {attendanceFilterClass === 'all'
                          ? (filteredAttendance.length > 0
                            ? Math.round((filteredAttendance.filter(a => a.status === 'present').length / filteredAttendance.length) * 100)
                            : 0)
                          : (() => {
                              const rows = attendanceRosterRows;
                              const present = rows.filter(r => r.record?.status === 'present').length;
                              return rows.length > 0 ? Math.round((present / rows.length) * 100) : 0;
                            })()}%
                      </h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                      <TrendingUp size={24} />
                    </div>
                  </div>

                  {/* Absentees List Card - Shows all absent students inline */}
                  <div className="md:col-span-2 bg-rose-50/60 border border-rose-100 p-4 rounded-2xl shadow-xs">
                    {(() => {
                      const absents = attendance.filter(a => {
                        const student = students.find(s => String(s.id) === String(a.studentId));
                        const matchesClass = attendanceFilterClass === 'all' || student?.classId === attendanceFilterClass;
                        return a.date === attendanceFilterDate && matchesClass && a.status === 'absent';
                      });

                      if (absents.length === 0) {
                        return (
                          <div className="flex items-center justify-between p-4 bg-amber-50 border border-amber-100 rounded-xl">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                              <p className="text-xs font-black text-amber-600 uppercase tracking-widest">No Absentees Today 🎉</p>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-black text-rose-600 uppercase tracking-widest">
                              Today's Absentees ({absents.length})
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  absents.forEach(acc => {
                                    const st = students.find(s => String(s.id) === String(acc.studentId));
                                    if (st && st.parentPhone) handleSendIndividualWhatsApp(st, acc.date);
                                  });
                                  toast.success(`WhatsApp sent to ${absents.filter(a => {
                                    const st = students.find(s => String(s.id) === String(a.studentId));
                                    return st && st.parentPhone;
                                  }).length} parents.`);
                                }}
                                className="px-3 py-1.5 bg-amber-600 text-white text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-amber-700 transition-all shadow-sm cursor-pointer"
                              >
                                <Send size={12} /> WhatsApp All
                              </button>
                              <button
                                onClick={() => setAbsenteesModalOpen(true)}
                                className="px-3 py-1.5 bg-rose-600 text-white text-[9px] font-black uppercase tracking-wider rounded-lg hover:bg-rose-700 transition-all shadow-sm cursor-pointer"
                              >
                                <MessageSquare size={12} /> View All
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {absents.map(acc => {
                              const st = students.find(s => String(s.id) === String(acc.studentId));
                              const phone = st?.parentPhone || st?.studentPhone || '';
                              const hasPhone = (phone || '').replace(/\D/g, '').length > 0;
                              return (
                                <div key={acc.id} className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2 shadow-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-7 h-7 rounded-full bg-rose-500 text-white flex items-center justify-center font-black text-xs shrink-0">
                                      <User size={12} />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-xs font-black text-slate-900 uppercase tracking-tight truncate">{st?.name || `Student #${String(acc.studentId).slice(-4)}`}</p>
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
                                        {st?.classId ? getClassName(st.classId) : 'N/A'} | Roll: {st?.rollNumber || 'N/A'}
                                      </p>
                                      <p className={`text-[9px] font-black uppercase tracking-wider ${hasPhone ? 'text-amber-600' : 'text-rose-500'}`}>
                                        {hasPhone ? phone : 'No Phone Number'}
                                      </p>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => st && handleSendIndividualWhatsApp(st, acc.date)}
                                    disabled={!st || !hasPhone}
                                    title={hasPhone ? `Send WhatsApp to ${st?.name}'s parent` : 'No phone number'}
                                    className={`p-2 flex items-center justify-center rounded-lg transition-all shadow-sm active:scale-95 cursor-pointer shrink-0 ${
                                      hasPhone ? 'bg-amber-600 hover:bg-slate-900 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                    }`}
                                  >
                                    <Send size={12} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Attendance Table */}
                <div className="bg-white border border-slate-200 shadow-sm overflow-hidden rounded-2xl">
                  <div className="p-3.5 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-amber-600 shrink-0" /> Attendance Ledger List
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg font-black tabular-nums">
                        {attendanceFilterDate}
                      </span>
                      {attendanceFilterClass !== 'all' && (
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-lg font-black tabular-nums">
                          {getClassName(attendanceFilterClass)} · {attendanceRosterRows.length} Student(s)
                        </span>
                      )}
                    </h3>
<div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                    <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                      Live Sync
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Status:</label>
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5">
                      {['all', 'present', 'absent', 'late', 'leave'].map(filter => (
                        <button
                          key={filter}
                          onClick={() => setAttendanceStatusFilter(filter as 'all' | 'present' | 'absent' | 'late' | 'leave')}
                          className={`px-2.5 py-1 text-[9px] font-black uppercase rounded-lg transition-all ${
                            attendanceStatusFilter === filter
                              ? 'bg-amber-600 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                  {/* MOBILE ATTENDANCE CARDS (< md) */}
                  <div className="block md:hidden divide-y divide-slate-100">
                    {(() => {
                      if (attendanceDisplayRows.length === 0) {
                        return (
                          <div className="py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-xs px-4">
                            {attendanceSearch ? `No attendance records matching "${attendanceSearch}"` : attendanceFilterClass !== 'all' ? `No students found in this class for ${attendanceFilterDate}` : `No attendance recorded for date ${attendanceFilterDate}`}
                          </div>
                        );
                      }

                      return (
                        <>
                          {attendanceDisplayRows.map(row => {
                            const { student, record, isRoster } = row;
                            const feeStudent = student ? feeStudentsMap.get(String(student.id)) : undefined;
                            const sName = student?.name || feeStudent?.name || (record as any)?.studentName || (`Student #${String(record?.studentId || '').slice(-4)}`);
                            const sRoll = student?.rollNumber ? `Roll #${student.rollNumber}` : feeStudent?.class ? feeStudent.class : 'Roster Student';
                            const sClass = student?.classId ? getClassName(student.classId) : feeStudent?.class || 'N/A';
                            const photo = getStudentPhoto(student || { name: sName });
                            const status = record?.status || 'unmarked';

                            return (
                              <div key={record?.id || `roster_${student?.id || sName}`} className="p-4 space-y-3 bg-white">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-3 min-w-0">
                                    {photo ? (
                                      <img
                                        src={photo}
                                        alt={sName}
                                        className="w-10 h-10 rounded-full object-cover border border-slate-200 bg-slate-100 shrink-0"
                                      />
                                    ) : (
                                      <div className="w-10 h-10 rounded-full border border-slate-200 bg-slate-50 shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <h4 className="font-black text-slate-900 uppercase tracking-tight text-xs truncate">
                                        {sName}
                                      </h4>
                                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                                        {sRoll} {isRoster && <span className="text-teal-500">· {sClass}</span>}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between pt-1 border-t border-slate-100 gap-2">
                                  <div>
                                    {status === 'absent' && student && (
                                      <button
                                        onClick={() => handleSendIndividualWhatsApp(student, record!.date)}
                                        className="p-1.5 bg-amber-100 text-amber-700 hover:bg-amber-600 hover:text-white rounded-lg flex items-center justify-center transition-colors cursor-pointer"
                                        title="Send WhatsApp Alert to Parent"
                                      >
                                        <Phone size={14} fill="currentColor" />
                                      </button>
                                    )}
                                  </div>

                                  <select
                                    value={status}
                                    onChange={(e) => {
                                      const newStatus = e.target.value as 'present' | 'absent' | 'late' | 'leave' | 'unmarked';
                                      if (newStatus === 'unmarked') return;
                                      if (record && !isRoster) {
                                        setAttendance(prev => prev.map(a => a.id === record.id ? { ...a, status: newStatus } : a));
                                        toast.success(`Updated attendance for ${sName} to ${newStatus.toUpperCase()}`);
                                      } else if (student) {
                                        handleRosterAttendanceChange(student, newStatus);
                                      }
                                    }}
                                    className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider border outline-none cursor-pointer rounded-xl transition-all ${getAttendanceStatusClass(status)}`}
                                  >
                                    {!record && <option value="unmarked">Not Marked</option>}
                                    <option value="present">Present</option>
                                    <option value="absent">Absent</option>
                                    <option value="late">Late</option>
                                    <option value="leave">Excused / Leave</option>
                                  </select>
                                </div>
                              </div>
                            );
                          })}
                          {attendanceFilterClass === 'all' && filteredAttendance.length > attendanceDisplayLimit && (
                            <div className="p-6 flex justify-center bg-white border-t border-slate-50">
                              <button 
                                onClick={() => setAttendanceDisplayLimit(prev => prev + 100)}
                                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-md active:scale-95"
                              >
                                Load More History ({filteredAttendance.length - attendanceDisplayLimit} remaining)
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* DESKTOP ATTENDANCE TABLE (>= md) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50/80 border-b border-slate-100 uppercase text-xs font-black tracking-widest text-slate-500">
                        <tr>
                          <th className="px-5 py-4">Student & Roll</th>
                          <th className="px-5 py-4">Marked By</th>
                          <th className="px-5 py-4 text-right">Attendance Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(() => {
                          if (attendanceDisplayRows.length === 0) {
                            return (
                              <tr>
                                <td colSpan={3} className="py-16 text-center text-slate-400 font-bold uppercase tracking-wider text-xs">
                                  {attendanceSearch ? `No attendance records matching "${attendanceSearch}"` : attendanceFilterClass !== 'all' ? `No students found in this class for ${attendanceFilterDate}` : `No attendance recorded for date ${attendanceFilterDate}`}
                                </td>
                              </tr>
                            );
                          }

                          return (
                            <>
                              {attendanceDisplayRows.map(row => {
                                const { student, record, isRoster } = row;
                                const feeStudent = student ? feeStudentsMap.get(String(student.id)) : undefined;
                                const sName = student?.name || feeStudent?.name || (record as any)?.studentName || (`Student #${String(record?.studentId || '').slice(-4)}`);
                                const sRoll = student?.rollNumber ? `Roll #${student.rollNumber}` : feeStudent?.class ? feeStudent.class : 'Roster Student';
                                const sClass = student?.classId ? getClassName(student.classId) : feeStudent?.class || 'N/A';
                                const photo = getStudentPhoto(student || { name: sName });
                                const status = record?.status || 'unmarked';

                                return (
                                  <tr key={record?.id || `roster_${student?.id || sName}`} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="px-5 py-4">
                                      <div className="flex items-center gap-3">
                                        {photo ? (
                                          <img
                                            src={photo}
                                            alt={sName}
                                            className="w-9 h-9 rounded-full object-cover border border-slate-200 bg-slate-100 shrink-0"
                                          />
                                        ) : (
                                          <div className="w-9 h-9 rounded-full border border-slate-200 bg-slate-50 shrink-0" />
                                        )}
                                        <div>
                                          <span className="font-black text-slate-900 block truncate uppercase tracking-tight text-sm leading-tight">
                                            {sName}
                                          </span>
                                          <span className="text-xs text-slate-500 font-bold uppercase tracking-wider block mt-0.5">
                                            {sRoll} {isRoster && <span className="text-teal-500">· {sClass}</span>}
                                          </span>
                                        </div>
                                      </div>
                                    </td>

                                    <td className="px-5 py-4">
                                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-full">
                                        <User size={11} className="text-teal-500" />
                                        {record?.markedBy || (isRoster ? 'Not Marked Yet' : '—')}
                                      </span>
                                    </td>

                                    <td className="px-5 py-4 text-right flex items-center justify-end gap-2">
                                      {status === 'absent' && student && record && (
                                        <button
                                          onClick={() => handleSendIndividualWhatsApp(student, record.date)}
                                          className="p-1.5 bg-amber-100 text-amber-700 hover:bg-amber-600 hover:text-white rounded-lg transition-all cursor-pointer"
                                          title="Send WhatsApp Alert to Parent"
                                        >
                                          <Phone size={14} fill="currentColor" />
                                        </button>
                                      )}

                                      <select
                                        value={status}
                                        onChange={(e) => {
                                          const newStatus = e.target.value as 'present' | 'absent' | 'late' | 'leave' | 'unmarked';
                                          if (newStatus === 'unmarked') return;
                                          if (record && !isRoster) {
                                            setAttendance(prev => prev.map(a => a.id === record.id ? { ...a, status: newStatus } : a));
                                            toast.success(`Updated attendance for ${sName} to ${newStatus.toUpperCase()}`);
                                          } else if (student) {
                                            handleRosterAttendanceChange(student, newStatus);
                                          }
                                        }}
                                        className={`px-3 py-1.5 text-sm font-black uppercase tracking-wider border outline-none cursor-pointer rounded-xl transition-all ${getAttendanceStatusClass(status)}`}
                                      >
                                        {!record && <option value="unmarked">Not Marked</option>}
                                        <option value="present">Present</option>
                                        <option value="absent">Absent</option>
                                        <option value="late">Late</option>
                                        <option value="leave">Excused / Leave</option>
                                      </select>
                                    </td>
                                  </tr>
                                );
                              })}
                              {attendanceFilterClass === 'all' && filteredAttendance.length > attendanceDisplayLimit && (
                                <tr>
                                  <td colSpan={3} className="px-5 py-8 text-center bg-white">
                                    <button 
                                      onClick={() => setAttendanceDisplayLimit(prev => prev + 100)}
                                      className="px-8 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg active:scale-95"
                                    >
                                      Load More History ({filteredAttendance.length - attendanceDisplayLimit} remaining)
                                    </button>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              /* ================= RESULTS REGISTER & WHATSAPP DISPATCH ================= */
              <div id="audit-results-section" className="space-y-6 animate-fade-in">
                {/* Filters & Control Bar */}
                <div className="bg-white p-4 border border-slate-200 rounded-2xl shadow-sm space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                      <select
                        value={resultsClassFilter}
                        onChange={(e) => setResultsClassFilter(e.target.value)}
                        className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 text-xs font-bold uppercase tracking-wider focus:outline-none focus:border-teal-400 rounded-xl appearance-none cursor-pointer"
                      >
                        <option value="all">All Classes</option>
                        {classes.map(c => (
                          <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div className="relative flex-1">
                      <Award className="absolute left-3 top-1/2 -translate-y-1/2 text-teal-400" size={14} />
                      <input
                        list="results-exam-names-list"
                        value={resultsExamDraft}
                        onChange={(e) => setResultsExamDraft(e.target.value)}
                        placeholder="Exam / Test name — e.g. 1st Term, 2nd Term, 3rd Term, Annual, Monthly Test..."
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-400 rounded-xl"
                      />
                      <datalist id="results-exam-names-list">
                        {Array.from(new Set([...availableExamTypes, ...EXAM_NAME_OPTIONS])).filter(Boolean).map(opt => <option key={opt} value={opt} />)}
                      </datalist>
                    </div>
                    <button
                      onClick={() => {
                        const exam = resultsExamDraft.trim();
                        if (!exam) { toast.error('Please type an exam / test name first.'); return; }
                        setResultsExam(exam);
                        const count = students.filter(s => resultsClassFilter === 'all' || s.classId === resultsClassFilter).filter(s => marks.some(m => String(m.studentId) === String(s.id) && (m.examType || '').trim().toLowerCase() === exam.toLowerCase())).length;
                        if (count === 0) {
                          toast.warning(`No marks found for "${exam}" yet. Ask teachers to enter them first.`);
                        } else {
                          toast.success(`Reports built for "${exam}" — ${count} student(s) with marks.`);
                        }
                      }}
                      className="px-4 py-2.5 bg-teal-600 text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center justify-center hover:bg-teal-700 transition-all shadow-xs rounded-xl cursor-pointer whitespace-nowrap"
                    >
                      Build Reports
                    </button>
                  </div>
                </div>

                  {/* Saved Tests / Exams — track what teachers have entered */}
                  {availableExamTypes.length > 0 && (
                    <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-4 sm:p-5">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <div className="bg-teal-100 text-teal-700 p-1.5 rounded-lg"><Award size={16} /></div>
                          <h3 className="text-sm font-bold text-slate-700">Saved Tests / Exams (entered by teachers)</h3>
                        </div>
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Click to track</span>
                      </div>
                      <div className="flex flex-wrap gap-2 items-start">
                        {availableExamTypes.map(tn => {
                          const cnt = students.filter(s => marks.some(m => String(m.studentId) === String(s.id) && (m.examType || '').trim().toLowerCase() === tn.trim().toLowerCase())).length;
                          const isOpen = openExamChip === tn;
                          const examStudents = students
                            .filter(s => marks.some(m => String(m.studentId) === String(s.id) && (m.examType || '').trim().toLowerCase() === tn.trim().toLowerCase()))
                            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
                          return (
                            <div key={tn} className="flex flex-col gap-1 max-w-full">
                              <button type="button" onClick={() => { setResultsExamDraft(tn); setResultsExam(tn); setOpenExamChip(isOpen ? null : tn); }} className="text-left bg-teal-50 border border-teal-100 hover:bg-teal-100 text-teal-800 text-xs font-bold px-3 py-2 rounded-xl flex flex-col gap-0.5 cursor-pointer">
                                <span>{tn}</span>
                                <span className="text-[10px] font-semibold text-teal-400">{cnt} students {isOpen ? '▲' : '▼'}</span>
                              </button>
                              {isOpen && (
                                <div className="bg-white border border-teal-100 rounded-xl p-2 max-h-44 overflow-y-auto custom-scrollbar space-y-1 shadow-sm min-w-[180px]">
                                  {examStudents.length === 0 ? (
                                    <p className="text-[10px] font-bold text-slate-400 uppercase px-1">No marks yet</p>
                                  ) : examStudents.map(s => {
                                    const sms = marks.filter(m => String(m.studentId) === String(s.id) && (m.examType || '').trim().toLowerCase() === tn.trim().toLowerCase());
                                    const tot = sms.reduce((a, m) => a + (Number(m.marksObtained) || 0), 0);
                                    const mx = sms.reduce((a, m) => a + (Number(m.maxMarks) || 0), 0);
                                    return (
                                      <div key={s.id} className="flex items-center justify-between gap-2 text-[10px] font-bold text-slate-600 px-1">
                                        <span className="truncate">{s.name} <span className="text-slate-300 font-semibold">· Roll #{s.rollNumber || '000'}</span></span>
                                        <span className="text-teal-600 font-black shrink-0">{tot}/{mx}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary Metrics */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-5 border border-slate-200 shadow-sm flex items-center justify-between rounded-2xl">
                    <div>
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Students with Marks</p>
                      <h3 className="text-3xl font-black text-teal-600">{resultsRows.filter(r => r.hasMarks).length}</h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center text-teal-600">
                      <Award size={24} />
                    </div>
                  </div>
                  <div className="bg-white p-5 border border-slate-200 shadow-sm flex items-center justify-between rounded-2xl">
                    <div>
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Total Students</p>
                      <h3 className="text-3xl font-black text-slate-900">{resultsRows.length}</h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-600">
                      <Users size={24} />
                    </div>
                  </div>
                  <div className="bg-white p-5 border border-slate-200 shadow-sm flex items-center justify-between rounded-2xl">
                    <div>
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Average %</p>
                      <h3 className="text-3xl font-black text-amber-600">
                        {(() => {
                          const withMarks = resultsRows.filter(r => r.hasMarks && r.totalMax > 0);
                          return withMarks.length > 0 ? Math.round(withMarks.reduce((s, r) => s + r.pct, 0) / withMarks.length) : 0;
                        })()}%
                      </h3>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                      <TrendingUp size={24} />
                    </div>
                  </div>
                </div>

                {/* Results Table */}
                <div className="bg-white border border-slate-200 shadow-sm overflow-hidden rounded-2xl">
                  <div className="p-3.5 sm:p-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                      <Award size={16} className="text-teal-600 shrink-0" /> {resultsExam ? `Result Reports — ${resultsExam}` : 'Result Reports'}
                      {resultsExam && (
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-lg font-black tabular-nums">
                          {resultsRows.filter(r => r.hasMarks).length} with marks
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-2">
                      {resultsExam && resultsRows.some(r => r.hasMarks) && (
                        <button
                          onClick={() => setResultWAModal({ isOpen: true, exam: resultsExam })}
                          className="px-4 py-2 bg-amber-600 text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-amber-700 transition-all shadow-xs rounded-xl cursor-pointer"
                        >
                          <MessageSquare size={13} /> Bulk Send to Parents
                        </button>
                      )}
                    </div>
                  </div>

                  {!resultsExam ? (
                    <div className="py-16 text-center px-6">
                      <Award size={32} className="text-slate-200 mx-auto mb-2" />
                      <p className="text-xs font-black text-slate-400 uppercase tracking-widest">
                        Select an exam/test name and press "Build Reports"
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* MOBILE CARDS */}
                      <div className="block md:hidden divide-y divide-slate-100">
                        {resultsRows.length === 0 ? (
                          <div className="py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-xs px-4">
                            No students found for this class selection.
                          </div>
                        ) : (
                          resultsRows.map((row, idx) => (
                            <div key={row.student.id} className="p-4 bg-white">
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-xs font-black text-teal-400 w-6 shrink-0">#{idx + 1}</span>
                                  <div className="min-w-0">
                                    <h4 className="font-black text-slate-900 uppercase tracking-tight text-xs truncate">{row.student.name}</h4>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
                                      Roll #{row.student.rollNumber} · {getClassName(row.student.classId)}
                                    </p>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className={`block text-sm font-black ${row.hasMarks ? (row.pct >= 40 ? 'text-amber-600' : 'text-rose-600') : 'text-slate-300'}`}>
                                    {row.hasMarks ? `${row.pct}%` : '—'}
                                  </span>
                                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    {row.hasMarks ? (row.pct >= 40 ? 'PASS' : 'RE-STUDY') : 'No Marks'}
                                  </span>
                                </div>
                              </div>
                              {row.hasMarks && (
                                <div className="pt-2 mt-2 border-t border-slate-100 space-y-1">
                                  {row.examMarks.map(m => (
                                    <div key={m.id} className="flex items-center justify-between text-xs">
                                      <span className="font-bold text-slate-600 uppercase tracking-tight">{m.subject}</span>
                                      <span className="font-black text-slate-800 tabular-nums">{m.marksObtained}/{m.maxMarks}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100">
                                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                                  Total: {row.hasMarks ? `${row.totalObtained}/${row.totalMax}` : '—'}
                                </span>
                                <button
                                  onClick={() => handleSendResultWhatsApp(row.student, resultsExam)}
                                  disabled={!row.hasMarks}
                                  className="px-3.5 py-2 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer"
                                >
                                  <Send size={13} /> Send Report
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* DESKTOP TABLE */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50/80 border-b border-slate-100 uppercase text-xs font-black tracking-widest text-slate-500">
                            <tr>
                              <th className="px-5 py-4">Student & Roll</th>
                              <th className="px-5 py-4">Subject Marks</th>
                              <th className="px-5 py-4 text-center">Total</th>
                              <th className="px-5 py-4 text-center">%</th>
                              <th className="px-5 py-4 text-center">Status</th>
                              <th className="px-5 py-4 text-right">Send</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {resultsRows.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-16 text-center text-slate-400 font-bold uppercase tracking-wider text-xs">
                                  No students found for this class selection.
                                </td>
                              </tr>
                            ) : (
                              resultsRows.map((row, idx) => (
                                <tr key={row.student.id} className="hover:bg-slate-50/60 transition-colors">
                                  <td className="px-5 py-4">
                                    <div className="flex items-center gap-3">
                                      <span className="text-xs font-black text-teal-400 w-5 shrink-0">{idx + 1}</span>
                                      <div>
                                        <span className="font-black text-slate-900 block truncate uppercase tracking-tight text-sm leading-tight">
                                          {row.student.name}
                                        </span>
                                        <span className="text-xs text-slate-500 font-bold uppercase tracking-wider block mt-0.5">
                                          Roll #{row.student.rollNumber} · {getClassName(row.student.classId)}
                                        </span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-5 py-4">
                                    {row.hasMarks ? (
                                      <div className="flex flex-wrap gap-1.5 max-w-md">
                                        {row.examMarks.map(m => (
                                          <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-800 border border-teal-100 rounded-full text-[10px] font-black uppercase">
                                            {m.subject}: <span className="tabular-nums">{m.marksObtained}/{m.maxMarks}</span>
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">No marks entered</span>
                                    )}
                                  </td>
                                  <td className="px-5 py-4 text-center text-sm font-black text-slate-800 tabular-nums">
                                    {row.hasMarks ? `${row.totalObtained}/${row.totalMax}` : '—'}
                                  </td>
                                  <td className="px-5 py-4 text-center text-sm font-black text-teal-600 tabular-nums">
                                    {row.hasMarks ? `${row.pct}%` : '—'}
                                  </td>
                                  <td className="px-5 py-4 text-center">
                                    {row.hasMarks ? (
                                      <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-wider rounded-full ${
                                        row.pct >= 40 ? 'bg-amber-50 text-amber-700 border border-amber-100' : 'bg-rose-50 text-rose-700 border border-rose-100'
                                      }`}>
                                        {row.pct >= 40 ? 'PASS' : 'RE-STUDY'}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-slate-300">—</span>
                                    )}
                                  </td>
                                  <td className="px-5 py-4 text-right">
                                    <button
                                      onClick={() => handleSendResultWhatsApp(row.student, resultsExam)}
                                      disabled={!row.hasMarks}
                                      title={row.hasMarks ? `Send ${resultsExam} report to parent` : 'No marks to send'}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                    >
                                      <Send size={12} /> Send
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}


        {/* ========== NEW SCHOOL FEE MANAGEMENT MODULE OLD (REPLACED BY AUDIT HUB) ========== */}
        {activeTab === 'fees' && (
          <div id="panel-principal-fees" className="space-y-6 animate-fade-in font-sans pb-20">
            {/* 1. Global Dashboard Stats Row */}
            {(() => {
              const stats = getGlobalStats(feeStudents);
              return (
                <div className="grid grid-cols-3 sm:grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-4">
                  <div className="bg-white p-2 sm:p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-xs sm:text-xs font-black text-slate-400 uppercase tracking-tight sm:tracking-widest truncate">Total Students</p>
                    <p className="text-xs sm:text-xl font-black text-slate-900">{stats.totalStudents}</p>
                  </div>
                  <div className="bg-amber-50 p-2 sm:p-4 rounded-2xl border border-amber-100 shadow-sm">
                    <p className="text-xs sm:text-xs font-black text-amber-600 uppercase tracking-tight sm:tracking-widest truncate">Collected</p>
                    <p className="text-xs sm:text-xl font-black text-amber-700">{stats.totalCollected.toLocaleString()}</p>
                  </div>
                  <button onClick={() => openFeePaymentCenter()} className="bg-rose-50 p-2 sm:p-4 rounded-2xl border border-rose-100 hover:border-rose-400 hover:shadow-md transition-all cursor-pointer text-left" title="Click karein — Fee Payment Center khulega">
                    <p className="text-xs sm:text-xs font-black text-rose-600 uppercase tracking-tight sm:tracking-widest truncate">Pending</p>
                    <p className="text-xs sm:text-xl font-black text-rose-700">{stats.totalPending.toLocaleString()}</p>
                    <p className="text-[9px] font-black text-rose-400 uppercase tracking-widest mt-1">Pay Now →</p>
                  </button>
                  <button onClick={() => openFeePaymentCenter()} className="bg-amber-50 p-2 sm:p-4 rounded-2xl border border-amber-100 hover:border-amber-400 hover:shadow-md transition-all cursor-pointer text-left" title="Click karein — Fee Payment Center khulega">
                    <p className="text-xs sm:text-xs font-black text-amber-600 uppercase tracking-tight sm:tracking-widest truncate">Other Funds</p>
                    <p className="text-xs sm:text-xl font-black text-amber-700">{stats.totalOther.toLocaleString()}</p>
                    <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mt-1">Pay Dues →</p>
                  </button>
                </div>
              );
            })()}

            {/* 1.5 Global Dues Section - Non-Fee Funds (Paper Fund, Other Fund, dues entries) */}
            {(() => {
              const allDues: { studentName: string; studentId: string | number; className: string; desc: string; amount: number; date: string; status: string; pending: number }[] = [];
              feeStudents.forEach(s => {
                (s.otherFunds || []).forEach(f => {
                  allDues.push({ studentName: s.name, studentId: s.id, className: s.class, desc: f.desc, amount: f.amount, date: f.date, status: 'PAID', pending: 0 });
                });
                (s.dues || []).forEach(d => {
                  const rem = getDueRemaining(d);
                  allDues.push({ studentName: s.name, studentId: s.id, className: s.class, desc: d.desc, amount: getDuePaid(d), date: d.date, status: rem > 0 ? (getDuePaid(d) > 0 ? 'PARTIAL' : 'PENDING') : 'PAID', pending: rem });
                });
              });
              allDues.sort((a, b) => b.date.localeCompare(a.date));
              const totalDuesAmount = allDues.reduce((sum, d) => sum + d.amount, 0);
              const totalPendingDues = allDues.reduce((sum, d) => sum + d.pending, 0);

              if (allDues.length === 0) return null;

              const fundBreakdown: Record<string, number> = {};
              allDues.forEach(d => { fundBreakdown[d.desc] = (fundBreakdown[d.desc] || 0) + d.amount; });

              return (
                <div className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                        <AlertCircle size={18} className="text-amber-500" />
                        Dues (Non-Fee Funds)
                      </h2>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Paper Fund, Summer Pack & Other Funds across all students</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {Object.entries(fundBreakdown).map(([desc, amt]) => (
                        <span key={desc} className="px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-xl text-xs font-black text-amber-700 uppercase tracking-widest">
                          {desc}: {Number(amt).toLocaleString()}
                        </span>
                      ))}
                      <span className="px-3 py-1.5 bg-rose-50 border border-rose-100 rounded-xl text-xs font-black text-rose-700 uppercase tracking-widest">
                        Collected: {totalDuesAmount.toLocaleString()}
                      </span>
                      {totalPendingDues > 0 && (
                        <span className="px-3 py-1.5 bg-rose-100 border border-rose-200 rounded-xl text-xs font-black text-rose-700 uppercase tracking-widest">
                          Pending: {totalPendingDues.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-100 uppercase text-[10px] font-black tracking-widest text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Student</th>
                          <th className="px-4 py-3">Class</th>
                          <th className="px-4 py-3">Fund Type</th>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3 text-right">Status</th>
                          <th className="px-4 py-3 text-right">Collected</th>
                          <th className="px-4 py-3 text-right">Pending</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-bold">
                        {allDues.map((d, idx) => (
                          <tr
                            key={idx}
                            onClick={d.pending > 0 ? () => openFeePaymentCenter(String(d.studentId)) : undefined}
                            title={d.pending > 0 ? 'Click karein — Fee Payment Center se pay karein' : undefined}
                            className={`transition-colors ${d.pending > 0 ? 'hover:bg-amber-50/60 cursor-pointer' : 'hover:bg-amber-50/30'}`}
                          >
                            <td className="px-4 py-3 text-slate-900 font-black">
                              {d.studentName}
                              {d.pending > 0 && <span className="ml-2 text-[9px] font-black text-amber-600 uppercase tracking-widest">Pay →</span>}
                            </td>
                            <td className="px-4 py-3 text-slate-500">{d.className}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600">
                                {d.desc}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-400">{formatDateDDMMYY(d.date)}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                                d.pending > 0 ? (d.amount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700') : 'bg-amber-100 text-amber-700'
                              }`}>
                                {d.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-amber-600 text-right">{d.amount.toLocaleString()}</td>
                            <td className="px-4 py-3 text-rose-600 text-right">{d.pending > 0 ? d.pending.toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}

            {/* 2. Main Interface Header & Student Matcher */}
            <div className="bg-white p-4 sm:p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                  <CreditCard size={24} className="text-teal-600" />
                  Fee Portal (2026)
                </h1>
                <button 
                  onClick={() => handleTabChange('registers')}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-all rounded-xl border border-slate-100 sm:border-none"
                >
                  <ArrowLeft size={16} /> Return to Audits
                </button>
              </div>
              
              <div className="flex flex-col gap-3">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Search student by name or ID..." 
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none"
                    value={feeSearch}
                    onChange={(e) => setFeeSearch(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    className="w-full sm:w-auto px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-700 font-bold text-xs rounded-xl outline-none focus:ring-2 focus:ring-teal-500"
                    value={feeClassFilter}
                    onChange={(e) => setFeeClassFilter(e.target.value)}
                  >
                    <option value="all">All Classes</option>
                    {Array.from(new Set(feeStudents.map(s => s.class))).filter(Boolean).map(c => (
                      <option key={String(c)} value={String(c)}>{String(c)}</option>
                    ))}
                  </select>
                  <select
                    className="w-full flex-1 px-4 py-2.5 bg-teal-600 text-white font-black text-xs uppercase tracking-widest rounded-xl cursor-pointer hover:bg-teal-700 transition-colors"
                    value={selectedStudentForFee}
                    onChange={(e) => setSelectedStudentForFee(e.target.value)}
                  >
                    <option value="">Select Student...</option>
                    {feeStudents
                      .filter(s => {
                        const matchesSearch = s.name.toLowerCase().includes(feeSearch.toLowerCase()) || String(s.id).includes(feeSearch);
                        const matchesClass = feeClassFilter === 'all' ? true : s.class === feeClassFilter;
                        return matchesSearch && matchesClass;
                      })
                      .map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.class})</option>
                      ))
                    }
                  </select>
                </div>
              </div>
            </div>

            {(() => {
              const student = feeStudents.find(s => String(s.id) === selectedStudentForFee);
              const studentProfile = students.find(s => String(s.id) === String(selectedStudentForFee));
              
              if (!student) {
                return (
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm p-6">
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Student Fee Roster & Account Index</h3>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50 border-b border-slate-100 uppercase text-xs font-black tracking-widest text-slate-400">
                          <tr>
                            <th className="px-6 py-4">Student</th>
                            <th className="px-6 py-4">Class</th>
                            <th className="px-6 py-4">Monthly Fee</th>
                            <th className="px-6 py-4">Paid Total</th>
                            <th className="px-6 py-4">Pending Amount</th>
                            <th className="px-6 py-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs font-bold">
                          {feeStudents.map(st => {
                            const totalPaid = (st.payments || []).reduce((sum, p) => sum + p.amount, 0);
                            const pending = getTotalPending(st);
                            return (
                              <tr key={st.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 text-slate-900 font-black">{st.name}</td>
                                <td className="px-6 py-4 text-slate-500">{st.class}</td>
                                <td className="px-6 py-4 text-slate-700">{st.monthlyFee}</td>
                                <td className="px-6 py-4 text-amber-600 font-black">{totalPaid}</td>
                                <td className="px-6 py-4 text-rose-600 font-black">{pending}</td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => setSelectedStudentForFee(String(st.id))}
                                    className="px-3 py-1.5 bg-teal-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-teal-700 transition-all shadow-xs"
                                  >
                                    Manage Account
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              }

              const account = getStudentFullAccount(student, 2026);

              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* Selected Student Identity Header Card */}
                  <div className="lg:col-span-12">
                    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center gap-6">
                      <div className="w-24 h-24 rounded-3xl bg-slate-100 border-4 border-teal-50 overflow-hidden shadow-inner flex items-center justify-center shrink-0">
                        {studentProfile?.photo ? (
                          <img src={studentProfile.photo} alt={student.name} className="w-full h-full object-cover" />
                        ) : (
                          <User size={40} className="text-slate-200" />
                        )}
                      </div>
                      <div className="flex-1 text-center sm:text-left space-y-1">
                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{student.name.split(' ').slice(0, 1).join(' ') || student.name}</h2>
                          <span className="bg-teal-100 text-teal-700 text-xs font-black px-2 py-1 rounded-lg uppercase tracking-widest">Roll: {studentProfile?.rollNumber || 'N/A'}</span>
                        </div>
                        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center justify-center sm:justify-start gap-2">
                          <Users size={14} /> {student.class}
                        </p>
                        <div className="flex items-center justify-center sm:justify-start gap-3 pt-2">
                           <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 rounded-full border border-amber-100">
                             <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                             <span className="text-xs font-black text-amber-700 uppercase">Active Profile</span>
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Left Column: Recording & Quick Actions */}
                  <div className="lg:col-span-4 space-y-6">
                    {/* Refactored Other Funds Interface */}
                    <div className="grid grid-cols-1 gap-4">
                      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2 flex items-center gap-2">
                          <BookOpen size={14} className="text-teal-500" /> Fund Entry Cards
                        </h3>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {[
                            { label: 'Paper Fund', desc: 'Paper Fund', icon: BookOpen, color: 'text-teal-600', bg: 'bg-teal-50' },
                            { label: 'Summer Pack', desc: 'Summer Pack', icon: Sun, color: 'text-orange-600', bg: 'bg-orange-50' },
                            { label: 'Other Fund', desc: 'Miscellaneous', icon: PlusCircle, color: 'text-teal-600', bg: 'bg-teal-50' }
                          ].map((fund, idx) => (
                            <div key={idx} className={`${fund.bg} p-4 rounded-2xl border border-slate-100 flex flex-col gap-3`}>
                              <div className="flex items-center gap-2">
                                <fund.icon size={16} className={fund.color} />
                                <span className={`text-xs font-black uppercase tracking-wider ${fund.color}`}>{fund.label}</span>
                              </div>
                              <div className="flex gap-2">
                                <input 
                                  id={`fundAmt_${idx}`} 
                                  type="number" 
                                  placeholder="Amount" 
                                  className="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-xs font-black outline-none focus:border-teal-500"
                                />
                                <button 
                                  onClick={() => {
                                    const amtInput = document.getElementById(`fundAmt_${idx}`) as HTMLInputElement;
                                    const amt = Number(amtInput.value);
                                    if (amt <= 0) { toast.error("Enter valid amount"); return; }
                                    
                                    setFeeStudents(prev => addOtherFund(prev, student.id, fund.desc, amt));
                                    handleSendFeeNotification(student, 'charge', amt, fund.desc);
                                    amtInput.value = '';
                                    toast.success(`${fund.label} entry added!`);
                                  }}
                                  className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Manual Reminder Card */}
                      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2 flex items-center gap-2">
                          <Send size={14} className="text-amber-500" /> Dispatch Alerts
                        </h3>
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                          <p className="text-xs text-slate-500 font-black uppercase tracking-widest leading-none mb-1">Total Pending</p>
                          <p className="text-2xl font-black text-rose-600 ">{getTotalPending(student) + getTotalOtherFunds(student)}</p>
                        </div>
                        <button 
                          onClick={() => handleSendFeeNotification(student, 'reminder', 0, '')}
                          title="Send WhatsApp Reminder"
                          className="w-full py-2.5 bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center hover:bg-amber-700 transition-all shadow-md active:scale-95 cursor-pointer"
                        >
                          <Send size={18} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Complete Yearly Account & History */}
                  <div className="lg:col-span-8 space-y-6">
                    
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                        <span className="text-xs font-black uppercase text-slate-400 tracking-widest mb-1">Total Yearly Due</span>
                        <span className="text-xl font-black text-slate-900">{account.totalDue}</span>
                      </div>
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                        <span className="text-xs font-black uppercase text-slate-400 tracking-widest mb-1">Total Yearly Paid</span>
                        <span className="text-xl font-black text-amber-600">{account.totalPaid}</span>
                      </div>
                      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
                        <span className="text-xs font-black uppercase text-slate-400 tracking-widest mb-1">Other Funds</span>
                        <span className="text-xl font-black text-amber-500">{account.otherFundsTotal}</span>
                      </div>
                      <div className="bg-slate-900 p-5 rounded-3xl border border-slate-800 shadow-xl flex flex-col justify-center text-white">
                        <span className="text-xs font-black uppercase text-slate-400 tracking-widest mb-1">Grand Pending</span>
                        <span className="text-xl font-black text-rose-500">{account.grandTotalPending}</span>
                      </div>
                    </div>

                    {/* Yearly Breakdown Grid */}
                    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Yearly Ledger (Jan-Dec 2026)</h3>
                        <div className="flex gap-4 text-xs font-black uppercase">
                          <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-amber-500"></div> Paid</span>
                          <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div> Pending</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-4 p-2 sm:p-4 bg-slate-50/50">
                        {account.yearlyBreakdown.map(m => (
                          <div 
                            key={m.month} 
                            onClick={() => {
                              if (m.isFutureMonth) {
                                toast.info(`Fee for ${m.month} is not yet due.`);
                                return;
                              }
                              
                              const allMonthlyPending = account.yearlyBreakdown.reduce((sum, curr) => sum + curr.pending, 0);
                              const previousArrears = allMonthlyPending - m.pending + account.otherFundsTotal;

                              setFeePaymentModal({
                                isOpen: true,
                                studentId: String(student.id),
                                month: m.month,
                                pending: m.pending,
                                previousArrears: previousArrears,
                                amount: (m.pending + previousArrears).toString(),
                                year: 2026,
                                feeType: 'School Fee'
                              });
                            }}
                            className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-teal-300 group cursor-pointer transition-all active:scale-95 flex flex-col justify-between"
                            title={`Click to record payment for ${m.month}`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-xs sm:text-xs font-black text-slate-900 uppercase truncate pr-1">{m.month}</span>
                              {m.isFutureMonth ? (
                                <span className="text-xs font-black uppercase text-slate-300">Upcoming</span>
                              ) : m.isComplete ? (
                                <CheckCircle2 size={14} className="text-amber-500 shrink-0" />
                              ) : (
                                <AlertCircle size={14} className="text-rose-500 animate-pulse group-hover:text-teal-600 shrink-0" />
                              )}
                            </div>
                            <div className="space-y-1 mb-2">
                              <div className="flex flex-col text-xs sm:text-xs font-bold">
                                <span className="text-slate-400">Paid:</span>
                                <span className={m.paid > 0 ? "text-amber-600" : "text-slate-300"}>{m.paid}</span>
                              </div>
                              <div className="flex flex-col text-xs sm:text-xs font-black">
                                <span className="text-slate-400 uppercase">Pend:</span>
                                <span className={m.pending > 0 ? "text-rose-600" : "text-slate-300"}>{m.pending}</span>
                              </div>
                            </div>
                            <div className="mt-auto w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                <div className={`h-full transition-all duration-500 ${m.isFutureMonth ? 'bg-slate-200' : m.isComplete ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${m.isFutureMonth ? 100 : (m.paid / Math.max(1, m.due)) * 100}%` }}></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Summary Totals */}
                      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Account Summary</h3>
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">Total Yearly Due:</span>
                            <span className="text-sm font-black text-slate-900">{account.totalDue.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">Total Yearly Paid:</span>
                            <span className="text-sm font-black text-amber-600">{account.totalPaid.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center pb-2">
                            <span className="text-xs font-bold text-slate-500">Other Funds (Fine/Dues):</span>
                            <span className="text-sm font-black text-amber-600">{account.otherFundsTotal.toLocaleString()}</span>
                          </div>
                          <div className="pt-3 border-t border-slate-200 flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-black text-rose-600 uppercase">Grand Total Pending:</span>
                              <span className="text-lg font-black text-rose-700">{account.grandTotalPending.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Other Funds History */}
                      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-black uppercase text-slate-400 tracking-widest border-b pb-2">Other Funds Entries</h3>
                        <div className="h-40 overflow-y-auto custom-scrollbar space-y-2">
                          {account.otherFunds.length > 0 ? account.otherFunds.map((f) => (
                            <div key={f.id} className="p-3 bg-slate-50 rounded-xl flex justify-between items-center border border-slate-100 group">
                              <div className="flex-1">
                                <p className="text-xs font-black text-slate-800 capitalize">{f.desc}</p>
                                <p className="text-xs text-slate-400 font-bold">{f.date}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs font-black text-slate-900">{f.amount}</span>
                                <div className="flex items-center gap-1 transition-opacity">
                                  <button 
                                    onClick={() => setFeeEditModal({ isOpen: true, type: 'other', recordId: f.id, studentId: String(student.id), amount: String(f.amount), desc: f.desc, feeType: '' })}
                                    className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      if(window.confirm("Delete this entry?")) {
                                        setFeeStudents(prev => deleteOtherFund(prev, student.id, f.id));
                                        toast.success("Entry deleted");
                                      }
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )) : (
                            <div className="h-full flex items-center justify-center text-xs text-slate-300 font-bold  uppercase">No extra entries found</div>
                          )}
                        </div>
                      </div>

                      {/* Dues Management (Separate from Monthly Fee) */}
                      <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                          <h3 className="text-xs font-black uppercase text-rose-600 tracking-widest border-b pb-2 flex items-center gap-2">
                            <AlertCircle size={14} className="text-rose-500" /> Dues Management (Separate from Monthly Fee)
                          </h3>
                          <button
                            onClick={() => {
                              setAddDueStudentId(String(student.id));
                              setAddDueDesc('');
                              setAddDueAmount('');
                              setAddDueMonth(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);
                              setShowAddDueModal(true);
                            }}
                            className="px-3 py-2 bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-rose-700 transition-all shadow-sm"
                          >
                            <Plus size={12} /> Add Due
                          </button>
                          <button
                            onClick={() => {
                              setBulkDueClassId('all');
                              setBulkDueDesc('Paper Fund');
                              setBulkDueAmount('');
                              setBulkDueMonth(`${MONTHS[new Date().getMonth()]} ${new Date().getFullYear()}`);
                              setShowBulkDueModal(true);
                            }}
                            title="Apply a due (Paper Fund/Annual Fee etc.) to EVERY student in a class at once"
                            className="px-3 py-2 bg-teal-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-teal-700 transition-all shadow-sm flex items-center gap-1.5"
                          >
                            <Users size={12} /> Apply to Class
                          </button>
                        </div>

                        {/* Add Due Modal */}
                        {showAddDueModal && addDueStudentId === String(student.id) && (
                          <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
                            <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl animate-in fade-in zoom-in-95">
                              <h4 className="text-sm font-black text-slate-900 mb-4 flex items-center gap-2">
                                <AlertCircle size={16} className="text-rose-500" /> Add New Due Entry
                              </h4>
                              <div className="space-y-4">
                                <div>
                                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Description</label>
                                  <input
                                    type="text"
                                    value={addDueDesc}
                                    onChange={(e) => setAddDueDesc(e.target.value)}
                                    placeholder="e.g., Library Fine, Transport, Uniform"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-rose-500 outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Amount</label>
                                  <input
                                    type="number"
                                    value={addDueAmount}
                                    onChange={(e) => setAddDueAmount(e.target.value)}
                                    placeholder="Amount in PKR"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-rose-500 outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Month</label>
                                  <select
                                    value={addDueMonth}
                                    onChange={(e) => setAddDueMonth(e.target.value)}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-rose-500 outline-none"
                                  >
                                    {MONTHS.map(m => (
                                      <option key={m} value={`${m} ${new Date().getFullYear()}`}>{m} {new Date().getFullYear()}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex gap-2 pt-2">
                                  <button
                                    onClick={() => setShowAddDueModal(false)}
                                    className="flex-1 py-2 bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-widest rounded-lg hover:bg-slate-300 transition-all"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => {
                                      const amt = Number(addDueAmount);
                                      if (!addDueDesc.trim() || amt <= 0) {
                                        toast.error("Enter valid description and amount");
                                        return;
                                      }
                                      const [monthStr, yearStr] = addDueMonth.split(' ');
                                      setFeeStudents(prev => addDue(prev, student.id, addDueDesc, amt, monthStr, Number(yearStr)));
                                      handleSendFeeNotification(student, 'charge', amt, addDueDesc);
                                      setShowAddDueModal(false);
                                      setAddDueDesc('');
                                      setAddDueAmount('');
                                      toast.success(`Due entry "${addDueDesc}" added for ${student.name}!`);
                                    }}
                                    className="flex-1 py-2 bg-rose-600 text-white text-xs font-black uppercase tracking-widest rounded-lg hover:bg-rose-700 transition-all shadow-sm"
                                  >
                                    Add Due
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Bulk "Apply Due to Whole Class" modal ab fixed overlay (modals section) mein hai */}

                        {/* Dues Filter */}
                        <div className="flex flex-wrap gap-2 mb-4">
                          <select
                            value={duesFilterStatus}
                            onChange={(e) => setDuesFilterStatus(e.target.value as 'all' | 'pending' | 'paid')}
                            className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-xs font-bold rounded-lg focus:border-rose-500 outline-none"
                          >
                            <option value="all">All Status</option>
                            <option value="pending">Pending</option>
                            <option value="paid">Paid</option>
                          </select>
                          <select
                            value={duesFilterClass}
                            onChange={(e) => setDuesFilterClass(e.target.value)}
                            className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-xs font-bold rounded-lg focus:border-rose-500 outline-none"
                          >
                            <option value="all">All Classes</option>
                            {classes.map(c => (
                              <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                            ))}
                          </select>
                        </div>

                        {/* Dues List */}
                        <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-2">
                          {(() => {
                            const studentDues = (student.dues || []).filter(d => {
                              const matchesStatus = duesFilterStatus === 'all' || d.status === duesFilterStatus;
                              const matchesClass = duesFilterClass === 'all' || student.class === duesFilterClass;
                              return matchesStatus && matchesClass;
                            });
                            
                            if (studentDues.length === 0) {
                              return (
                                <div className="py-10 flex flex-col items-center justify-center text-slate-300 gap-2">
                                  <AlertCircle size={24} />
                                  <p className="text-xs font-black uppercase tracking-widest">No dues entries found</p>
                                </div>
                              );
                            }

                            return studentDues.map((d) => (
                              <div key={d.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-black text-slate-900 uppercase">{d.desc}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest ${
                                      d.status === 'paid' ? 'bg-amber-100 text-amber-600' :
                                      d.status === 'waived' ? 'bg-amber-100 text-amber-600' :
                                      'bg-rose-100 text-rose-600'
                                    }`}>
                                      {d.status.toUpperCase()}
                                    </span>
                                  </div>
                                  <p className="text-xs text-slate-400 font-bold mt-0.5">
                                    Month: {d.month} {d.year} · Added: {formatDateDDMMYY(d.date)}
                                    {d.paidDate && ` · Paid: ${formatDateDDMMYY(d.paidDate)} (${d.paymentMethod || 'Cash'})`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="text-right">
                                    {getDuePaid(d) > 0 ? (
                                      <>
                                        <div className="text-xs font-black text-amber-600">{getDuePaid(d).toLocaleString()} paid</div>
                                        {getDueRemaining(d) > 0 && (
                                          <div className="text-[10px] font-black text-rose-600">{getDueRemaining(d).toLocaleString()} pending</div>
                                        )}
                                      </>
                                    ) : (
                                      <span className="text-xs font-black text-rose-600">{d.amount.toLocaleString()}</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {getDueRemaining(d) > 0 && (
                                      <button
                                        onClick={() => {
                                          const dRemaining = getDueRemaining(d);
                                          setCollectDuesModal({ isOpen: true, studentId: String(student.id), dueId: d.id, desc: d.desc, amount: d.amount, remaining: dRemaining, month: d.month, year: d.year });
                                          setCollectDuesAmount(String(dRemaining));
                                          setCollectDuesPaymentMethod('Cash');
                                        }}
                                        className="p-1.5 text-amber-600 hover:bg-amber-100 rounded-lg transition-all"
                                        title="Collect Due"
                                      >
                                        <CheckCircle2 size={12} />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => setFeeEditModal({ isOpen: true, type: 'other', recordId: d.id, studentId: String(student.id), amount: String(d.amount), desc: d.desc, feeType: 'Due' })}
                                      className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
                                      title="Edit"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                    <button
                                      onClick={() => {
                                        if(window.confirm("Delete this due entry?")) {
                                          setFeeStudents(prev => deleteDue(prev, student.id, d.id));
                                          toast.success("Due entry deleted");
                                        }
                                      }}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                      title="Delete"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>

                      {/* Payment Transactions History (Monthly Fees) */}
                      <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
                        <h3 className="text-xs font-black uppercase text-teal-600 tracking-widest border-b pb-2 flex justify-between items-center">
                          Monthly Fee Payment History
                          <span className="text-xs text-slate-400 font-bold ">Latest transactions first</span>
                        </h3>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-2">
                          {student.payments && student.payments.length > 0 ? student.payments.slice().reverse().map((p) => (
                            <HoldActionWrapper
                              key={p.id}
                              onEdit={() => setFeeEditModal({ isOpen: true, type: 'payment', recordId: p.id, studentId: String(student.id), amount: String(p.amount), desc: `${p.month} ${p.year}`, feeType: p.feeType || (fees.find(f => f.id === p.id)?.feeType) || 'School Fee' })}
                              onDelete={() => {
                                if(window.confirm("Delete this payment record?")) {
                                  setFeeStudents(prev => deletePayment(prev, student.id, p.id));
                                  toast.success("Payment deleted");
                                }
                              }}
                              className="p-3 bg-slate-50 rounded-xl border border-slate-100 group"
                            >
                              <div
                                className="flex justify-between items-center cursor-pointer"
                                onClick={() => setFeeEditModal({ isOpen: true, type: 'payment', recordId: p.id, studentId: String(student.id), amount: String(p.amount), desc: `${p.month} ${p.year}`, feeType: p.feeType || (fees.find(f => f.id === p.id)?.feeType) || 'School Fee' })}
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-black text-slate-900 uppercase ">{formatDateDDMMYY(p.date) || `${p.month} ${p.year}`}</span>
                                    <span className="text-[10px] bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded font-black uppercase tracking-widest">{p.feeType || (fees.find(f => f.id === p.id)?.feeType) || 'School Fee'}</span>
                                  </div>
                                  <p className="text-xs text-slate-400 font-bold mt-0.5">Paid on: {formatDateDDMMYY(p.date) || p.date} · {String(p.month).replace(/ \d{4}$/, '')} {p.year}</p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <span className="text-xs font-black text-amber-600">{p.amount}</span>
                                  <div className="flex items-center gap-1 transition-opacity" onPointerDown={(e) => e.stopPropagation()}>
                                    <button 
                                      onClick={() => setFeeEditModal({ isOpen: true, type: 'payment', recordId: p.id, studentId: String(student.id), amount: String(p.amount), desc: `${p.month} ${p.year}`, feeType: p.feeType || (fees.find(f => f.id === p.id)?.feeType) || 'School Fee' })}
                                      className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        if(window.confirm("Delete this payment record?")) {
                                          setFeeStudents(prev => deletePayment(prev, student.id, p.id));
                                          toast.success("Payment deleted");
                                        }
                                      }}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </HoldActionWrapper>
                          )) : (
                            <div className="py-10 flex flex-col items-center justify-center text-slate-300 gap-2">
                              <CreditCard size={24} />
                              <p className="text-xs font-black uppercase tracking-widest">No payment records found</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {/* ========== ANALYTICS ========== */}
        {activeTab === 'analytics' && (
          <AnalyticsTab userSession={userSession} students={students} classes={classes} attendance={attendance} marks={marks} fees={fees} />
        )}
        {/* ========== NOTICE BOARD ========== */}
        {activeTab === 'features_hub' && featuresSubTab === 'notices' && (
          <div className="bg-white/40 rounded-2xl p-2 sm:p-4">
            <NoticeBoard userSession={userSession} />
          </div>
        )}
        {/* ========== SCHOOL CALENDAR ========== */}
        {activeTab === 'features_hub' && featuresSubTab === 'calendar' && (
          <EventsCalendar userSession={userSession} />
        )}
        {/* ========== CERTIFICATES + EXPORT ========== */}
        {activeTab === 'features_hub' && featuresSubTab === 'certificates' && (
          <CertificateTab userSession={userSession} students={students} classes={classes} attendance={attendance} fees={fees} />
        )}
        {/* ========== AI PAPER GENERATOR ========== */}
        {activeTab === 'features_hub' && featuresSubTab === 'ai_paper' && (
          <div className="bg-white/40 rounded-2xl p-2 sm:p-4">
            <AiPaperGenerator userSession={userSession} classes={classes} />
          </div>
        )}
        {/* ========== TEACHER PAY & GPS ATTENDANCE MANAGER ========== */}
        {activeTab === 'teacher_pay' && (
          <div id="panel-principal-teacher-pay" className="space-y-8 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Teacher Pay & Hisab</h1>
                <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Salary config · GPS attendance linked payslips · Payment status (Digital Registrar)</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-widest text-slate-500">Month:</span>
                <input
                  type="month"
                  value={payMonthSelP}
                  onChange={(e) => setPayMonthSelP(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                />
              </div>
            </div>

            {/* School location card */}
            <div className="bg-white rounded-xl p-5 border-2 border-teal-200 shadow-md flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="flex-1 space-y-2.5">
                <div className="flex items-center gap-2 text-base font-black text-slate-800 uppercase tracking-tight">
                  <MapPin size={18} className="text-teal-600" /> School GPS Location (Attendance Radius)
                </div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  Teacher check-in sirf is location ke radius ke ANDAR hota hai. Coordinates Google Maps se copy karein.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Latitude</label>
                    <input value={locLat} onChange={(e) => setLocLat(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Longitude</label>
                    <input value={locLng} onChange={(e) => setLocLng(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Radius (m)</label>
                    <input type="number" min={100} value={locRadius} onChange={(e) => setLocRadius(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Location Name</label>
                    <input value={locName} onChange={(e) => setLocName(e.target.value)} className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
                  </div>
                </div>
              </div>
              <button
                onClick={saveSchoolLocation}
                className="shrink-0 px-6 py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-all flex items-center gap-2 cursor-pointer"
              >
                <Navigation size={15} /> {showLocSaved ? 'Saved ✓' : 'Save Location'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {teachers.map((t) => {
                const cfg = teacherPayConfigs.find(c => String(c.teacherId) === String(t.id)) || defaultPayConfig(t.id);
                const slip = teacherPayslipsMap[t.id];
                const key = `${t.id}_${payYearP}_${payMonthIdxP}`;
                const paid = teacherPaySlips[key]?.paid === true;
                return (
                  <div key={t.id} className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all flex flex-col">
                    <div className={`px-4 py-3 flex items-center gap-3 ${paid ? 'bg-teal-600' : 'bg-slate-900'}`}>
                      <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white font-black shrink-0"><User size={16} /></div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-black text-white uppercase tracking-tight truncate">{t.name}</h3>
                        <p className="text-[10px] text-white/80 font-bold uppercase tracking-widest truncate">{t.subject}</p>
                      </div>
                      <span className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${paid ? 'bg-white text-teal-900' : 'bg-amber-400 text-slate-950'}`}>{paid ? 'PAID' : 'PENDING'}</span>
                    </div>
                    <div className="px-4 py-3 space-y-1.5">
                      <div className="flex justify-between"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Base Salary</span><span className="text-[11px] font-black text-slate-900">{formatPKR(cfg.baseSalary)}</span></div>
                      <div className="flex justify-between"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Monthly Allowance</span><span className="text-[11px] font-black text-teal-600">+ {formatPKR(cfg.allowances)}</span></div>
                      <div className="flex justify-between"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Present Bonus/day</span><span className="text-[11px] font-black text-teal-600">+ {formatPKR(cfg.bonusPerPresentDay)}</span></div>
                      <div className="flex justify-between"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Late Docking/day</span><span className="text-[11px] font-black text-rose-600">- {formatPKR(cfg.lateDeductionPerDay)}</span></div>
                      <div className="flex justify-between"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Absent Docking/day</span><span className="text-[11px] font-black text-rose-600">- {formatPKR(cfg.absentDeductionPerDay)}</span></div>
                      <div className="flex justify-between"><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fixed Deductions</span><span className="text-[11px] font-black text-rose-600">- {formatPKR(cfg.deductions)}</span></div>
                    </div>
                    <div className="border-t border-slate-100 px-4 py-3 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-teal-50 text-teal-700 border border-teal-200">Present {slip.presentDays}</span>
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-200">Late {slip.lateDays}</span>
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-rose-50 text-rose-700 border border-rose-200">Absent {slip.absentDays}</span>
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-slate-50 text-slate-600 border border-slate-200">Leave {slip.leaveDays}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Net Pay · {monthLabel(slip.year, slip.month)}</span>
                        <span className="text-base font-black text-teal-700 tabular-nums">{formatPKR(slip.netPay)}</span>
                      </div>
                    </div>
                    <div className="px-4 py-2.5 flex gap-2">
                      <button onClick={() => openPayEditor(t)} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                        <Edit2 size={13} /> Config
                      </button>
                      <button onClick={() => markTeacherPaid(t.id)} disabled={paid} className="flex-1 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-400 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed">
                        <Banknote size={13} /> {paid ? 'Paid ✓' : 'Mark Paid'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <AnimatePresence>
              {editingPayTeacherId && payForm && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.9, opacity: 0, y: 20 }}
                    className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                  >
                    <div className="px-6 py-4 bg-teal-600 text-white flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet size={18} />
                        <h3 className="text-sm font-black uppercase tracking-tight">Pay Config — {teachers.find(t => String(t.id) === String(editingPayTeacherId))?.name || '-'}</h3>
                      </div>
                      <button onClick={() => { setEditingPayTeacherId(null); setPayForm(null); }} className="p-1.5 rounded-full text-white/80 hover:text-white transition-colors"><X size={18} /></button>
                    </div>
                    <div className="p-6 space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Base Salary</label>
                          <input type="number" value={payForm.baseSalary} onChange={(e) => setPayForm({ ...payForm, baseSalary: Number(e.target.value) || 0 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800" />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Present Bonus / Day</label>
                          <input type="number" value={payForm.bonusPerPresentDay} onChange={(e) => setPayForm({ ...payForm, bonusPerPresentDay: Number(e.target.value) || 0 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800" />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Late Docking / Day</label>
                          <input type="number" value={payForm.lateDeductionPerDay} onChange={(e) => setPayForm({ ...payForm, lateDeductionPerDay: Number(e.target.value) || 0 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800" />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Absent Docking / Day</label>
                          <input type="number" value={payForm.absentDeductionPerDay} onChange={(e) => setPayForm({ ...payForm, absentDeductionPerDay: Number(e.target.value) || 0 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800" />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Monthly Allowance</label>
                          <input type="number" value={payForm.allowances} onChange={(e) => setPayForm({ ...payForm, allowances: Number(e.target.value) || 0 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800" />
                        </div>
                        <div className="space-y-1">
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Fixed Deductions</label>
                          <input type="number" value={payForm.deductions} onChange={(e) => setPayForm({ ...payForm, deductions: Number(e.target.value) || 0 })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-800" />
                        </div>
                      </div>
                      <p className="text-[10px] bg-amber-50 border border-amber-100 text-amber-800 font-bold leading-relaxed">
                        Net Pay = Base + (Present × Bonus) + Allowances − (Late × Docking) − (Absent × Docking) − Fixed.
                        Attendance data teacher ke GPS check-in se aata hai.
                      </p>
                    </div>
                    <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-4">
                      <button onClick={() => { setEditingPayTeacherId(null); setPayForm(null); }} className="px-5 py-2 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest hover:bg-white transition-all rounded-lg">Cancel</button>
                      <button onClick={() => savePayConfig(payForm)} className="px-7 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-black uppercase tracking-[0.15em] flex items-center gap-2 rounded-lg transition-all shadow-md">
                        <Save size={14} /> Save Config
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </div>
        )}
        {/* end teacher_pay panel */}
        {/* ========== SETTINGS & CONFIGURATION PORTAL ========== */}
        {activeTab === 'features_hub' && featuresSubTab === 'settings' && (
          <div id="panel-principal-settings" className="space-y-8 animate-fade-in font-sans bg-slate-50 dark:bg-slate-900/40 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-inner">

            {/* ===== Settings Hero Banner ===== */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 via-teal-600 to-slate-900 p-6 text-white shadow-xl ring-1 ring-white/10">
              <div aria-hidden className="pointer-events-none absolute -top-20 -right-10 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
              <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 w-72 h-72 rounded-full bg-emerald-400/20 blur-3xl" />
              <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/15 backdrop-blur rounded-2xl ring-1 ring-white/20">
                    <span className="text-2xl leading-none">⚙️</span>
                  </div>
                  <div>
                    <h2 className="text-lg font-black uppercase tracking-tight">School Settings &amp; Configuration</h2>
                    <p className="text-xs text-teal-100/90">AI • Attendance • WhatsApp • Theme — sab kuch yahin se manage karein</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur ring-1 ring-white/20 text-[10px] font-black uppercase tracking-widest w-fit">
                  <HardDrive size={12} /> {isDemoMode() ? 'Local Mode' : 'Cloud Connected'}
                </span>
              </div>
            </div>
            
            {/* ========== AI (GEMINI) — Settings se key enter karein ========== */}
            <AiSettingsSection />

            {/* ========== ATTENDANCE COLLECTION — GPS SETTINGS ========== */}
            <AttendanceSettingsSection
              schoolLocation={schoolLocation}
              onSaved={(loc) => setSchoolLocationP(loc)}
            />

            {/* ========== MANUAL CLOUD DATA SYNC ========== */}
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 my-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 text-amber-600">
                  <Database size={22} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    Cloud Ledger Sync
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${isDemoMode() ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
                      {isDemoMode() ? 'DEMO MODE — LOCAL STORAGE' : 'CONNECTED'}
                    </span>
                  </h3>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const confirm = window.confirm("Are you sure you want to download all data from the cloud (Supabase)? This will overwrite your local unsaved data.");
                    if(!confirm) return;
                    
                    toast.info("Downloading data from Cloud...");
                    try {
                      const syncConfig = [
                        { col: 'teachers', key: 'acadamis_teachers', type: 'list' },
                        { col: 'classes', key: 'acadamis_classes', type: 'list' },
                        { col: 'students', key: 'acadamis_students', type: 'list' },
                        { col: 'timetable', key: 'acadamis_timetable', type: 'list' },
                        { col: 'attendance', key: 'acadamis_attendance', type: 'list' },
                        { col: 'marks', key: 'acadamis_marks', type: 'list' },
                        { col: 'fees', key: 'acadamis_fees', type: 'list' },
                        { col: 'coordinators', key: 'acadamis_coordinators', type: 'list' },
                        { col: 'fee_data', key: 'school_fee_data', type: 'list' },
                        { col: 'app_settings', key: 'acadamis_app_settings', type: 'object', docId: 'global' }
                      ];

                      for (const item of syncConfig) {
                        if (item.type === 'list') {
                          const itemsList = await loadCollectionFromSupabase(item.col);
                          if (itemsList) safeStorage.setItem(item.key, JSON.stringify(itemsList));
                        } else if (item.type === 'object' && item.docId) {
                          const objs = await loadCollectionFromSupabase(item.col);
                          const docData = (objs || []).find((o: any) => String(o.id) === item.docId);
                          if (docData) safeStorage.setItem(item.key, JSON.stringify(docData));
                        }
                      }
                      toast.success("Successfully downloaded all data from cloud!");
                      setTimeout(() => window.location.reload(), 1500);
                    } catch (error: any) {
                      toast.error("Error downloading data: " + error.message);
                    }
                  }}
                  className="bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-teal-600 border border-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm"
                >
                  <DownloadCloud size={14} />
                  Download
                </button>

                <button
                  type="button"
                  onClick={handleUploadToCloud}
                  className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm shadow-amber-500/10"
                >
                  <UploadCloud size={14} />
                  Upload from Localhost
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    toast.info("Force syncing to cloud...");
                    try {
                      await pushLocalToCloud();
                      toast.success("Data synced to Supabase!");
                    } catch (err: any) {
                      toast.error("Sync failed: " + err.message);
                    }
                  }}
                  className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm shadow-teal-500/10"
                >
                  <RefreshCw size={14} />
                  Force Sync to Cloud
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (isDemoMode()) {
                      toast.info('Demo Mode active — app local storage par chalti hai. Cloud connection live mode (VITE_DATA_MODE hata kar) test hoga.');
                      return;
                    }
                    toast.info("Testing Supabase connection...");
                    try {
                      const connected = await testSupabaseConnection();
                      if (connected) {
                        toast.success("Supabase connected successfully!");
                      } else {
                        toast.error("Supabase connection failed - check schema/policies");
                      }
                    } catch (err: any) {
                      toast.error("Connection test failed: " + err.message);
                    }
                  }}
                  className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm shadow-teal-500/10"
                >
                  <Wifi size={14} />
                  Test Connection
                </button>

                <div className="h-4 w-[1px] bg-slate-200 mx-1 hidden sm:block"></div>

                <button
                  type="button"
                  onClick={async () => {
                    const pass = window.prompt("DANGER: This will permanently DELETE ALL records. Please enter Principal password to confirm:");
                    if (pass === null) return;
                    if (pass !== '111222') {
                      toast.error("Incorrect password. Access denied.");
                      return;
                    }

                    const confirm = window.confirm("Final Warning: This action cannot be undone. All student, teacher, and academic records in the cloud will be wiped. Proceed?");
                    if(!confirm) return;

                    toast.info("Nuking database...");
                    try {
                      const collections = ['teachers', 'classes', 'students', 'timetable', 'attendance', 'marks', 'fees', 'coordinators', 'fee_data', 'app_settings'];
                      for (const col of collections) {
                        const itemsList = await loadCollectionFromSupabase(col);
                        if (!itemsList) continue;
                        for (const d of itemsList) {
                          if (d && d.id !== undefined && d.id !== null) sbQueueDelete(col, String(d.id));
                        }
                      }
                      await flushSupabase();
                      toast.success("All cloud records successfully deleted.");
                    } catch (error: any) {
                      toast.error("Error nuking database: " + error.message);
                    }
                  }}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 border border-rose-100 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm"
                >
                  <Trash2 size={14} />
                  Clear Cloud
                </button>
              </div>
            </div>

            {/* ========== LOCAL DEVICE BACKUP ========== */}
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 my-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-teal-50 rounded-xl border border-teal-100 text-teal-600">
                  <HardDrive size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                    Local Device Backup
                  </h3>
                  <p className="text-xs text-slate-400 font-bold mt-1">Download or upload data directly to your device without cloud</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadJSON}
                  className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm shadow-teal-500/10"
                >
                  <Download size={14} />
                  Download Backup
                </button>

                <div className="h-4 w-[1px] bg-slate-200 mx-1 hidden sm:block"></div>

                <input
                  type="file"
                  id="local-import-input"
                  className="hidden"
                  accept=".json"
                  onChange={handleImportJSON}
                />
                <label
                  htmlFor="local-import-input"
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm shadow-amber-500/10"
                >
                  <Upload size={14} />
                  Upload Backup
                </label>
              </div>
            </div>

            {/* ========== PRINCIPAL PROFILE & OFFLINE BACKUP GRID ========== */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Profile/Security Section */}
              <div className="bg-white rounded-none p-8 border border-slate-200 shadow-sm border-t-4 border-t-teal-600">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-teal-50 rounded-none border border-teal-100">
                    <Sparkles size={24} className="text-teal-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Security & Profile</h2>
                  </div>
                </div>

                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.target as HTMLFormElement;
                    const newID = (form.elements.namedItem('username') as HTMLInputElement).value;
                    const newPass = (form.elements.namedItem('password') as HTMLInputElement).value;
                    const confirmPass = (form.elements.namedItem('confirm_password') as HTMLInputElement).value;

                    if (!newID.trim() || !newPass.trim()) {
                      toast.error("ID and Password cannot be empty.");
                      return;
                    }

                    if (newPass !== confirmPass) {
                      toast.error("Passwords do not match.");
                      return;
                    }

                    if (userSession.role === 'coordinator') {
                      // Update coordinator record
                      const updatedCoords = coordinators.map(c => 
                        c.id === userSession.id ? { ...c, username: newID, password: newPass } : c
                      );
                      setCoordinators(updatedCoords);
                      toast.success("Coordinator credentials updated successfully!");
                    } else {
                      // Principal/Developer update (Shared state for this demo)
                      toast.success("Principal credentials updated successfully!");
                    }
                    form.reset();
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">New Administrative ID</label>
                    <input name="username" type="text" placeholder="Enter new username/ID..." className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-teal-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest">New Password</label>
                      <input name="password" type="password" placeholder="••••••••" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-teal-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Confirm Password</label>
                      <input name="confirm_password" type="password" placeholder="••••••••" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-teal-500" />
                    </div>
                  </div>
                  <button type="submit" className="w-full py-3 bg-teal-600 text-white font-black uppercase tracking-widest text-xs hover:bg-slate-900 transition-all rounded-lg mt-2 shadow-md">
                    Update System Credentials
                  </button>
                </form>
              </div>



              {/* Data Import / System Restore Section (Developer Only) */}
              {userSession.role === 'developer' && (
                <div className="bg-white rounded-none p-8 border border-slate-200 shadow-sm border-t-4 border-t-rose-500 flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-rose-50 rounded-none border border-rose-100">
                      <UploadCloud size={24} className="text-rose-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">System Restore</h2>
                    </div>
                  </div>
                  
                  <div className="flex-1 space-y-4">
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                      Upload a previously exported JSON backup to overwrite current data. This action is irreversible once completed.
                    </p>
                    <div className="p-3 bg-rose-50 border border-dashed border-rose-200 rounded-lg">
                      <p className="text-xs text-rose-700 font-bold uppercase leading-tight ">
                        Caution: All existing records (Attendance, Fees, Marks) will be replaced by the contents of the uploaded file.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6">
                    <input 
                      type="file" 
                      id="system-import-input" 
                      className="hidden" 
                      accept=".json" 
                      onChange={handleImportJSON}
                    />
                    <label 
                      htmlFor="system-import-input"
                      className="w-full py-4 bg-rose-600 text-white font-black uppercase tracking-[0.2em] text-xs hover:bg-slate-900 transition-all rounded-xl flex items-center justify-center gap-3 shadow-lg cursor-pointer group"
                    >
                      <Upload size={20} className="group-hover:-translate-y-1 transition-transform" />
                      Restore Records (JSON)
                    </label>
                  </div>
                </div>
              )}
            </div>
            <div className="bg-white p-8 border border-slate-200 shadow-sm border-t-4 border-t-slate-900">
              <div className="flex items-center gap-4 mb-8 border-b pb-4">
                <div className="p-3 bg-slate-100 rounded-none border border-slate-200">
                  <Menu size={24} className="text-slate-900" />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">System Management & Settings</h1>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {/* Fee Collection Methods Section */}
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-2">
                      <CreditCard size={18} className="text-teal-600" />
                      Fee Collection Protocols (Collection Policy)
                    </h3>
                  </div>

                  <div className="bg-slate-50 p-5 border border-slate-200 space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Primary Bank Account</label>
                      <input 
                        type="text" 
                        defaultValue="Allied Bank - A/C 2233-4455-6677"
                        className="w-full bg-white border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-400" 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Cash Collection Hours</label>
                      <input 
                        type="text" 
                        defaultValue="08:00 AM to 01:30 PM (Mon-Sat)"
                        className="w-full bg-white border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-400" 
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-black uppercase tracking-widest text-slate-400">Collection Notes for Parents</label>
                      <textarea 
                        rows={3}
                        defaultValue="Fees must be submitted by the 10th of each month. Late surcharges of 50 apply after the due date. Please present the original voucher copy at the registrar desk."
                        className="w-full bg-white border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-400"
                      />
                    </div>
                    <button className="bg-slate-900 text-white text-xs font-black uppercase tracking-widest py-2 px-4 hover:bg-slate-800 transition-all">
                      Save Protocols
                    </button>
                  </div>
                </div>

                {/* User Access Control Section */}
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-2">
                      <Users size={18} className="text-amber-600" />
                      Access Control & Portal Security
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Manage default security settings for teachers and students during registration.
                    </p>
                  </div>

                  <div className="bg-slate-50 p-5 border border-slate-200 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black uppercase text-slate-800">Auto-Generate Credentials</p>
                        <p className="text-xs text-slate-400">Automatically creates IDs for new students/teachers.</p>
                      </div>
                      <div className="w-10 h-5 bg-amber-500 rounded-full flex items-center px-1">
                        <div className="w-3 h-3 bg-white rounded-full ml-auto"></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black uppercase text-slate-800">Allow Password Resets</p>
                        <p className="text-xs text-slate-400">Enables users to change passwords from their dashboards.</p>
                      </div>
                      <div className="w-10 h-5 bg-amber-500 rounded-full flex items-center px-1">
                        <div className="w-3 h-3 bg-white rounded-full ml-auto"></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white border border-slate-200">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black uppercase text-slate-800">Strict Teacher Isolation</p>
                        <p className="text-xs text-slate-400">Lock teachers to their assigned classroom data only.</p>
                      </div>
                      <div className="w-10 h-5 bg-amber-500 rounded-full flex items-center px-1">
                        <div className="w-3 h-3 bg-white rounded-full ml-auto"></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Visual Customization & Appearance */}
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-sm font-black uppercase text-slate-800 dark:text-slate-100 flex items-center gap-2">
                      <Sun size={18} className="text-amber-500" />
                      Appearance & Custom Display (Visual Theme)
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      Toggle between Light and Dark visual mode templates across all students and teachers devices.
                    </p>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900 p-5 border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                      <div className="space-y-0.5">
                        <p className="text-xs font-black uppercase text-slate-800 dark:text-white">Dark Theme / Dark Mode</p>
                        <p className="text-xs text-slate-405">Enable an eye-friendly dark look for all management dashboards.</p>
                      </div>
                      <button 
                        type="button"
                        onClick={handleToggleTheme}
                        className={`w-12 h-6 rounded-full flex items-center px-1 transition-colors ${darkTheme ? 'bg-teal-600' : 'bg-slate-300'}`}
                        id="btn-toggle-dark-mode"
                      >
                        <div className={`w-4 h-4 rounded-full bg-white flex items-center justify-center transition-transform ${darkTheme ? 'translate-x-6' : 'translate-x-0'}`}>
                          <span key={String(darkTheme)} className="animate-theme-pop inline-flex">
                            {darkTheme ? <Moon size={10} className="text-teal-600" /> : <Sun size={10} className="text-amber-500" />}
                          </span>
                        </div>
                      </button>
                    </div>

                    <div className="p-3 bg-teal-50/60 dark:bg-teal-900/40 border border-teal-100 dark:border-teal-900 text-xs text-teal-800 dark:text-teal-200 leading-relaxed rounded-none">
                      <strong>✨ Note:</strong> Theme preference is synchronized in real-time. Changing this updates your portal view immediately and sets your persistent local workspace styling preference.
                    </div>
                  </div>
                </div>

                {/* WhatsApp & Communication Settings */}
                <div className="space-y-6 md:col-span-2">
                  <div className="space-y-2">
                    <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-2">
                      <Phone size={18} className="text-amber-600" />
                      WhatsApp & Automated Communication (WhatsApp Settings)
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-5 border border-slate-200 space-y-4">
                      <div className="flex items-center justify-between p-3 bg-white border border-slate-200 ring-2 ring-amber-500/20">
                        <div className="space-y-0.5">
                          <p className="text-xs font-black uppercase text-teal-600 flex items-center gap-1">
                            <Zap size={10} /> Auto-Redirect WhatsApp
                          </p>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Open WA tab automatically</p>
                        </div>
                        <button 
                          onClick={() => {
                            updateSetting('autoWhatsAppRedirect', !appSettings.autoWhatsAppRedirect);
                          }}
                          className={`w-10 h-5 rounded-full flex items-center px-1 transition-all duration-300 ${appSettings.autoWhatsAppRedirect ? 'bg-teal-600' : 'bg-slate-300'}`}
                        >
                          <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-300 ${appSettings.autoWhatsAppRedirect ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-white border border-slate-200">
                        <div className="space-y-0.5">
                          <p className="text-xs font-black uppercase text-slate-800">Fee Auto-Reminders</p>
                          <p className="text-xs text-slate-400">Auto-send WhatsApp on invoice generation.</p>
                        </div>
                        <button 
                          onClick={() => updateSetting('whatsAppAutoFee', !appSettings.whatsAppAutoFee)}
                          className={`w-10 h-5 rounded-full flex items-center px-1 transition-colors ${appSettings.whatsAppAutoFee ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                          <div className={`w-3 h-3 bg-white rounded-full transition-transform ${appSettings.whatsAppAutoFee ? 'ml-auto' : 'mr-auto'}`}></div>
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-white border border-slate-200">
                        <div className="space-y-0.5">
                          <p className="text-xs font-black uppercase text-slate-800">Absence Alerts</p>
                          <p className="text-xs text-slate-400">Auto-ping parents when student is marked absent.</p>
                        </div>
                        <button 
                          onClick={() => updateSetting('whatsAppAutoAbsence', !appSettings.whatsAppAutoAbsence)}
                          className={`w-10 h-5 rounded-full flex items-center px-1 transition-colors ${appSettings.whatsAppAutoAbsence ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                          <div className={`w-3 h-3 bg-white rounded-full transition-transform ${appSettings.whatsAppAutoAbsence ? 'ml-auto' : 'mr-auto'}`}></div>
                        </button>
                      </div>

                      <div className="flex items-center justify-between p-3 bg-white border border-slate-200">
                        <div className="space-y-0.5">
                          <p className="text-xs font-black uppercase text-slate-800">Results Broadcasting</p>
                          <p className="text-xs text-slate-400">Send report cards via WhatsApp automatically.</p>
                        </div>
                        <button 
                          onClick={() => updateSetting('whatsAppAutoResult', !appSettings.whatsAppAutoResult)}
                          className={`w-10 h-5 rounded-full flex items-center px-1 transition-colors ${appSettings.whatsAppAutoResult ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                          <div className={`w-3 h-3 bg-white rounded-full transition-transform ${appSettings.whatsAppAutoResult ? 'ml-auto' : 'mr-auto'}`}></div>
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-900 text-white p-5 space-y-4 shadow-xl">
                      <h4 className="text-xs font-black uppercase tracking-widest text-amber-400">Bulk Execution Logs</h4>
                      <div className="space-y-2 h-40 overflow-y-auto pr-2 custom-scrollbar">
                        {broadcastLogs.length === 0 ? (
                          <p className="text-xs text-slate-500 ">No recent autopilot activity.</p>
                        ) : (
                          broadcastLogs.map(log => (
                            <div key={log.id} className="p-2 border-b border-white/10 last:border-0">
                              <div className="flex justify-between items-start gap-2">
                                <p className="text-xs font-bold text-slate-200">{log.recipient}</p>
                                <span className="text-xs px-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">{log.status}</span>
                              </div>
                              <p className="text-xs text-slate-400 truncate mt-0.5">{log.text}</p>
                              <p className="text-[10px] text-slate-600 mt-0.5">{log.timestamp}</p>
                            </div>
                          ))
                        )}
                      </div>
                      <button 
                        onClick={() => {
                          const unpaidCount = fees.filter(f => f.status !== 'paid').length;
                          if (unpaidCount === 0) return;
                          toast.success(`Security Policy: Batch broadcast for ${unpaidCount} parents initiated via settings.`);
                          setBroadcastLogs(prev => [
                            {
                              id: 'batch_' + Date.now(),
                              recipient: 'System-Wide Defaulters',
                              phone: 'Multiple',
                              type: 'Settings Batch',
                              text: `Manual trigger of pending reminder for ${unpaidCount} students.`,
                              timestamp: new Date().toLocaleString(),
                              status: 'Autopilot'
                            },
                            ...prev
                          ]);
                          toast.success(`Pending reminder triggered for ${unpaidCount} students.`);
                        }}
                        className="w-full bg-amber-600 hover:bg-amber-500 text-white font-black text-xs uppercase py-2 tracking-widest transition-all"
                      >
                        ⚡ Run Batch Fee Reminders
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* CUSTOM SHORTCODE/PLACEHOLDER TEMPLATES SECTION */}
              <div className="mt-10 pt-10 border-t border-slate-200 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-sm font-black uppercase text-slate-800 flex items-center gap-2 font-display">
                    <MessageSquare size={18} className="text-teal-600" />
                    SMS & WhatsApp Message Templates Settings
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Personalize default automated template copies dispatched on pupil absences or fee issuance incidents. Use the shortcut system tags dynamically replaced on dispatch.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-slate-50 p-6 border border-slate-200">
                  {/* Absentee Template custom box */}
                  <div className="space-y-3 bg-white p-5 border border-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-400 block">Absent Alarm Template</span>
                      <span className="text-xs bg-teal-50 text-teal-700 border border-teal-100 font-bold px-2 py-0.5 rounded-full uppercase">Absent Alert</span>
                    </div>
                    
                    <textarea 
                      rows={4}
                      value={appSettings.absentTemplate}
                      onChange={(e) => updateSetting('absentTemplate', e.target.value)}
                      placeholder="Insert your custom absent template copy..."
                      className="w-full bg-slate-50 text-xs border border-slate-200 p-3  font-medium focus:outline-none focus:border-teal-600 focus:bg-white"
                    />
                    
                    <div className="space-y-1 bg-slate-50 p-3 text-xs text-slate-500 font-mono">
                      <p className="font-bold uppercase text-xs text-teal-700">Available Tags (Auto Replaced):</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li><code className="text-rose-600 font-bold">{`{student_name}`}</code> - Name of the absentee</li>
                        <li><code className="text-rose-600 font-bold">{`{roll_number}`}</code> - Roll registry number</li>
                        <li><code className="text-rose-600 font-bold">{`{date}`}</code> - Scheduled attendance date pointer</li>
                      </ul>
                    </div>

                    <div className="pt-2 border-t text-[9.5px]">
                      <span className="font-bold text-slate-500 block uppercase">Draft Sample Live Preview:</span>
                      <p className="text-slate-700 font-medium  mt-1 bg-slate-100 p-2 border leading-normal">
                        "{appSettings.absentTemplate
                          .replace(/{student_name}/g, "Zain")
                          .replace(/{roll_number}/g, "12")
                          .replace(/{date}/g, new Date().toLocaleDateString())}"
                      </p>
                    </div>
                  </div>

                  {/* Fee Reminder Template custom box */}
                  <div className="space-y-3 bg-white p-5 border border-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-400 block">Dues & Fee Reminder Template</span>
                      <div className="flex gap-2">
                        <select 
                          className="text-xs bg-white border border-slate-200 font-bold px-2 py-0.5 rounded uppercase focus:ring-1 focus:ring-amber-500 outline-none"
                          onChange={(e) => {
                            const val = e.target.value;
                            let newTpl = "";
                            if (val === "short") newTpl = "Reminder: {total_pending} pending for {student_name}. Please settle soon. - Principal.";
                            else if (val === "standard") newTpl = "Greetings! Demo School Reminder: Guardian of {student_name}. Pending balance: {total_pending}. Kindly settle today. Thank you.";
                            else if (val === "urgent") newTpl = "🚨 URGENT: {total_pending} pending for {student_name}. Pay today to avoid portal suspension. - Principal Demo School.";
                            
                            if (newTpl) {
                              updateSetting('feeTemplate', newTpl);
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>Select Preset...</option>
                          <option value="short">Short (Quick)</option>
                          <option value="standard">Standard (Polite)</option>
                          <option value="urgent">Urgent (Warning)</option>
                        </select>
                        <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 font-bold px-2 py-0.5 rounded-full uppercase">Fee Dues</span>
                      </div>
                    </div>
                    
                    <textarea 
                      rows={4}
                      value={appSettings.feeTemplate}
                      onChange={(e) => updateSetting('feeTemplate', e.target.value)}
                      placeholder="Insert your custom outstanding fee template copy..."
                      className="w-full bg-slate-50 text-xs border border-slate-200 p-3  font-medium focus:outline-none focus:border-amber-600 focus:bg-white"
                    />
                    
                    <div className="space-y-1 bg-slate-50 p-3 text-xs text-slate-500 font-mono">
                      <p className="font-bold uppercase text-xs text-amber-700">Available Tags (Auto Replaced):</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li><code className="text-rose-600 font-bold">{`{student_name}`}</code> - Name of the student debtor</li>
                        <li><code className="text-rose-600 font-bold">{`{class_name}`}</code> - Enrolled classroom handle</li>
                        <li><code className="text-rose-600 font-bold">{`{total_pending}`}</code> - Total unpaid ledger sum</li>
                        <li><code className="text-rose-600 font-bold">{`{months}`}</code> - Months list needing settlement</li>
                        <li><code className="text-rose-600 font-bold">{`{date}`}</code> - Issue / settlement deadline date</li>
                      </ul>
                    </div>

                    <div className="pt-2 border-t text-[9.5px]">
                      <span className="font-bold text-slate-500 block uppercase">Draft Sample Live Preview:</span>
                      <p className="text-slate-700 font-medium  mt-1 bg-slate-100 p-2 border leading-normal whitespace-pre-wrap">
                        "{appSettings.feeTemplate
                          .replace(/{student_name}/g, "Zain")
                          .replace(/{class_name}/g, "Class-A")
                          .replace(/{total_pending}/g, "1500")
                          .replace(/{months}/g, "June, July")
                          .replace(/{date}/g, new Date().toLocaleDateString())}"
                      </p>
                    </div>
                  </div>

                  {/* Result / Report Card Template custom box */}
                  <div className="space-y-3 bg-white p-5 border border-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-400 block">Result / Report Card Template</span>
                      <div className="flex gap-2">
                        <select 
                          className="text-xs bg-white border border-slate-200 font-bold px-2 py-0.5 rounded uppercase focus:ring-1 focus:ring-teal-400 outline-none"
                          onChange={(e) => {
                            const val = e.target.value;
                            let newTpl = "";
                            if (val === "standard") newTpl = "Greetings, Respected Parent! Result of {student_name} (Roll: {roll_number}, {class_name}) for {exam_name}:\n{subjects}\nTotal: {total_obtained}/{total_max} ({percentage}%). Status: {status}.\n- Demo Academy.";
                            else if (val === "detailed") newTpl = "Assalam-o-Alaikum! {exam_name} RESULT of {student_name} (Roll: {roll_number}, {class_name}):\n{subjects}\nGRAND TOTAL: {total_obtained} out of {total_max} ({percentage}%)\nRemarks: {status}\nBest regards, Demo Academy.";
                            else if (val === "short") newTpl = "{exam_name} result {student_name}: {percentage}% ({status}). Total {total_obtained}/{total_max}. Demo Academy.";
                            
                            if (newTpl) {
                              updateSetting('resultTemplate', newTpl);
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="" disabled>Select Preset...</option>
                          <option value="standard">Standard</option>
                          <option value="detailed">Detailed</option>
                          <option value="short">Short (Quick)</option>
                        </select>
                        <span className="text-xs bg-teal-50 text-teal-700 border border-teal-100 font-bold px-2 py-0.5 rounded-full uppercase">Result</span>
                      </div>
                    </div>
                    
                    <textarea 
                      rows={4}
                      value={appSettings.resultTemplate}
                      onChange={(e) => updateSetting('resultTemplate', e.target.value)}
                      placeholder="Insert your custom result/report card template copy..."
                      className="w-full bg-slate-50 text-xs border border-slate-200 p-3  font-medium focus:outline-none focus:border-teal-600 focus:bg-white"
                    />
                    
                    <div className="space-y-1 bg-slate-50 p-3 text-xs text-slate-500 font-mono">
                      <p className="font-bold uppercase text-xs text-teal-700">Available Tags (Auto Replaced):</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        <li><code className="text-rose-600 font-bold">{`{student_name}`}</code> - Name of the student</li>
                        <li><code className="text-rose-600 font-bold">{`{roll_number}`}</code> - Roll registry number</li>
                        <li><code className="text-rose-600 font-bold">{`{class_name}`}</code> - Classroom handle</li>
                        <li><code className="text-rose-600 font-bold">{`{exam_name}`}</code> - Exam / test / term name (any)</li>
                        <li><code className="text-rose-600 font-bold">{`{subjects}`}</code> - Subject-wise marks lines</li>
                        <li><code className="text-rose-600 font-bold">{`{total_obtained}`}</code> - Total obtained marks</li>
                        <li><code className="text-rose-600 font-bold">{`{total_max}`}</code> - Total maximum marks</li>
                        <li><code className="text-rose-600 font-bold">{`{percentage}`}</code> - Overall percentage</li>
                        <li><code className="text-rose-600 font-bold">{`{status}`}</code> - PASS / RE-STUDY</li>
                      </ul>
                    </div>

                    <div className="pt-2 border-t text-[9.5px]">
                      <span className="font-bold text-slate-500 block uppercase">Draft Sample Live Preview:</span>
                      <p className="text-slate-700 font-medium  mt-1 bg-slate-100 p-2 border leading-normal whitespace-pre-wrap">
                        "{(appSettings.resultTemplate || '').replace(/{student_name}/g, "Zain")
                          .replace(/{roll_number}/g, "12")
                          .replace(/{class_name}/g, "Class-A")
                          .replace(/{exam_name}/g, "1st Term")
                          .replace(/{subjects}/g, "- English: 85/100\n- Math: 78/100")
                          .replace(/{total_obtained}/g, "163")
                          .replace(/{total_max}/g, "200")
                          .replace(/{percentage}/g, "81")
                          .replace(/{status}/g, "PASS")}"
                      </p>
                    </div>
                  </div>

                  <div className="md:col-span-2 flex justify-between items-center bg-white p-3.5 border border-slate-200">
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                      ✨ Status: Personalized template patterns are instantly autosaved to regional memory.
                    </p>
                    <button 
                      type="button"
                      onClick={() => {
                        toast.success("Templates are automatically synced to the cloud!");
                      }}
                      className="bg-slate-900 hover:bg-slate-850 text-white font-black text-xs uppercase tracking-widest py-2 px-6 shadow-md transition-all active:scale-95"
                    >
                      Sync Status
                    </button>
                  </div>
                </div>
              </div>



              <div className="mt-12 pt-8 border-t border-dashed border-slate-200">
                <div className="bg-amber-50 p-6 border border-amber-100 flex items-start gap-4">
                  <AlertCircle className="text-amber-600 shrink-0" size={20} />
                  <div>
                    <h4 className="text-xs font-black uppercase text-amber-900 tracking-wider">Principal Security Override</h4>
                    <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                      As the principal coordinator, you have master access to all system data. Ensure you keep your master credentials secure. You can manually override any teacher password or student record from the primary rosters.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ========== COMMON MODAL FORM DIALOG ========== */}
      {isModalOpen && (
        <div id="modal-container" className="fixed inset-0 bg-black/65 flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h2 className="text-base font-bold text-gray-900 uppercase tracking-wide">
                {modalMode === 'add' ? 'Create' : 'Configure'} {modalType.substring(0, 1).toUpperCase() + modalType.substring(1)}
              </h2>
              <button
                id="modal-close-btn"
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-all"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Form Wrapper */}
            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
              
              {/* Form Errors Banner */}
              {formErrors.length > 0 && (
                <div id="modal-validation-errors" className="p-3.5 bg-red-50 text-red-700 border border-red-100 rounded-xl space-y-1">
                  <p className="font-bold text-xs flex items-center gap-1.5 uppercase tracking-wide">
                    <AlertCircle size={14} /> Please resolve form issues:
                  </p>
                  <ul className="list-disc pl-5 text-xs space-y-0.5">
                    {formErrors.map((err, idx) => <li key={idx}>{err}</li>)}
                  </ul>
                </div>
              )}

              {/* ============ TEACHER FORM FIELDS ============ */}
              {modalType === 'teacher' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Teacher Name</label>
                    <input
                      type="text"
                      required
                      value={tName}
                      onChange={(e) => setTName(e.target.value)}
                      placeholder="e.g. Johnathan Miller"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1 col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Password</label>
                      <input
                        type="text"
                        required
                        value={tPassword}
                        onChange={(e) => setTPassword(e.target.value)}
                        placeholder="nsb123"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Email Address (Optional)</label>
                    <input
                      type="email"
                      value={tEmail}
                      onChange={(e) => setTEmail(e.target.value)}
                      placeholder="e.g. jmiller@school.com"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Teaching Discipline/Subject</label>
                    <input
                      type="text"
                      required
                      value={tSubject}
                      onChange={(e) => setTSubject(e.target.value)}
                      placeholder="e.g. Physics, History, etc."
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Phone number</label>
                    <input
                      type="text"
                      required
                      value={tPhone}
                      onChange={(e) => setTPhone(e.target.value)}
                      placeholder="e.g. +1-555-0819"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>
                </div>
              )}

              {/* ============ COORDINATOR FORM FIELDS ============ */}
              {modalType === 'coordinator' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Coordinator Name</label>
                    <input
                      type="text"
                      required
                      value={tName}
                      onChange={(e) => setTName(e.target.value)}
                      placeholder="e.g. Sarah Connor"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1 col-span-2">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Password</label>
                      <input
                        type="text"
                        required
                        value={tPassword}
                        onChange={(e) => setTPassword(e.target.value)}
                        placeholder="nsb123"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Email Address</label>
                    <input
                      type="email"
                      required
                      value={tEmail}
                      onChange={(e) => setTEmail(e.target.value)}
                      placeholder="e.g. sconnor@school.com"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Phone number</label>
                    <input
                      type="text"
                      required
                      value={tPhone}
                      onChange={(e) => setTPhone(e.target.value)}
                      placeholder="e.g. +1-555-4321"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    />
                  </div>
                </div>
              )}

              {/* ============ STUDENT FORM FIELDS ============ */}
              {modalType === 'student' && (
                <div className="space-y-6">
                  {/* Step Progress Indicator */}
                  <div className="flex items-center justify-between mb-8 px-4">
                    {[
                      { step: 1, label: 'Identity', icon: User },
                      { step: 2, label: 'Academic', icon: BookOpen },
                      { step: 3, label: 'Account', icon: CreditCard }
                    ].map((s, i) => (
                      <React.Fragment key={s.step}>
                        <div className="flex flex-col items-center gap-2 group">
                          <div 
                            onClick={() => setFormStep(s.step)}
                            className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all cursor-pointer ${
                              formStep === s.step 
                                ? 'bg-teal-600 text-white shadow-lg shadow-teal-200 scale-110' 
                                : formStep > s.step 
                                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-100'
                                  : 'bg-slate-100 text-slate-400 grayscale hover:grayscale-0'
                            }`}
                          >
                            <s.icon size={18} strokeWidth={2.5} />
                          </div>
                          <span className={`text-xs font-black uppercase tracking-widest ${formStep === s.step ? 'text-teal-600' : 'text-slate-400'}`}>
                            {s.label}
                          </span>
                        </div>
                        {i < 2 && (
                          <div className={`flex-1 h-0.5 mx-2 rounded-full transition-colors ${formStep > s.step + 1 ? 'bg-amber-500' : 'bg-slate-100'}`}></div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  {/* STEP 1: PERSONAL IDENTITY */}
                  {formStep === 1 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <div className="p-4 bg-teal-50/50 border border-teal-100 rounded-2xl flex items-center gap-4">
                        <div className="relative group">
                          <div className="w-16 h-16 bg-white rounded-2xl border-2 border-dashed border-teal-200 flex items-center justify-center overflow-hidden shadow-sm transition-all group-hover:border-teal-400">
                            {sPhoto ? (
                              <img src={sPhoto} alt="Profile" className="w-full h-full object-cover" />
                            ) : (
                              <User size={24} className="text-teal-300" />
                            )}
                          </div>
                          <label className="absolute -bottom-2 -right-2 bg-teal-600 text-white p-1.5 rounded-xl cursor-pointer shadow-lg hover:bg-teal-700 transition-all border-2 border-white">
                            <Upload size={12} strokeWidth={3} />
                            <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                          </label>
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-teal-900 uppercase tracking-tight">Student Profile Image</h4>
                          <p className="text-xs text-teal-500 font-bold uppercase tracking-wider">A clear photo helps in identification</p>
                        </div>
                      </div>

                      <div className="space-y-4 pt-2">
                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Full Student Name</label>
                          <input
                            type="text"
                            required
                            value={sName}
                            onChange={(e) => setSName(e.target.value)}
                            placeholder="e.g. Muhammad Ali"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Username</label>
                            <input
                              type="text"
                              required
                              value={sUsername}
                              onChange={(e) => setSUsername(e.target.value)}
                              placeholder="login_id"
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Password</label>
                            <input
                              type="text"
                              required
                              value={sPassword}
                              onChange={(e) => setSPassword(e.target.value)}
                              placeholder="nsb123"
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Parent's WhatsApp Number</label>
                          <div className="relative">
                            <Phone size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              type="text"
                              required
                              value={sParentPhone}
                              onChange={(e) => setSParentPhone(e.target.value)}
                              placeholder="e.g. 03001234567"
                              className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-amber-500 outline-none transition-all"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 flex justify-end">
                        <button 
                          type="button" 
                          onClick={() => setFormStep(2)}
                          className="px-8 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2"
                        >
                          Continue to Academic <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 2: ACADEMIC DETAILS */}
                  {formStep === 2 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Assigned Class</label>
                          <select
                            value={sClassId}
                            onChange={(e) => {
                              const newClassId = e.target.value;
                              setSClassId(newClassId);
                              // Auto-generate next roll number when class changes
                              if (newClassId) {
                                const classStudents = students.filter(s => s.classId === newClassId);
                                const maxRoll = classStudents.reduce((max, s) => {
                                  const num = parseInt(s.rollNumber, 10);
                                  return !isNaN(num) && num > max ? num : max;
                                }, 0);
                                setSRoll(String(maxRoll + 1));
                              } else {
                                setSRoll('');
                              }
                            }}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                          >
                            <option value="">-- Choose Class --</option>
                            {classes.map(cl => (
                              <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Roll Number</label>
                          <input
                            type="text"
                            required
                            value={sRoll}
                            onChange={(e) => setSRoll(e.target.value)}
                            placeholder="e.g. 101"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Student Contact (Optional)</label>
                          <input
                            type="text"
                            value={sStudentPhone}
                            onChange={(e) => setSStudentPhone(e.target.value)}
                            placeholder="e.g. 03217654321"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Email Address</label>
                          <input
                            type="email"
                            value={sEmail}
                            onChange={(e) => setSEmail(e.target.value)}
                            placeholder="e.g. ali@school.com"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-1 pt-2">
                        <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Enrollment Date</label>
                        <select
                          value={sEnrollmentMonth}
                          onChange={(e) => setSEnrollmentMonth(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                        >
                          {MONTHS.map(m => (
                            <option key={m} value={m}>{m} 2026</option>
                          ))}
                        </select>
                      </div>

                      <div className="pt-6 flex justify-between gap-4">
                        <button 
                          type="button" 
                          onClick={() => setFormStep(1)}
                          className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                        >
                          Back to Identity
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setFormStep(3)}
                          className="flex-1 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95"
                        >
                          Next: Fee & Academy
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* STEP 3: FINANCIAL & ACADEMY */}
                  {formStep === 3 && (
                    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                      <div className="p-6 bg-amber-50 border border-amber-100 rounded-3xl space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-white text-amber-600 rounded-xl shadow-sm">
                            <CreditCard size={20} />
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-amber-900 uppercase tracking-tight ">Fee Management</h4>
                            <p className="text-xs text-amber-600 font-bold uppercase tracking-wider">Set the monthly base fee for this student</p>
                          </div>
                        </div>
                        
                        <div className="space-y-1">
                          <label className="text-xs font-black uppercase tracking-widest text-amber-700 ml-1">Monthly School Fee ()</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600 font-black text-xs"></span>
                            <input
                              type="number"
                              required
                              value={sBaseFee}
                              onChange={(e) => setSBaseFee(e.target.value)}
                              placeholder="e.g. 2000"
                              className="w-full pl-12 pr-4 py-4 bg-white border border-amber-200 rounded-2xl text-xl font-black text-amber-600 focus:ring-4 focus:ring-amber-200/50 outline-none transition-all placeholder:text-amber-200"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="p-6 bg-teal-900 text-white rounded-3xl space-y-6 shadow-xl shadow-teal-200 border-l-8 border-teal-500">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <h4 className="text-sm font-black uppercase tracking-tight  flex items-center gap-2">
                              <Zap size={18} className="text-amber-400" /> Academy Enrollment
                            </h4>
                            <p className="text-xs text-teal-300 font-medium leading-relaxed max-w-[200px]">
                              Is this student also attending evening academy classes?
                            </p>
                          </div>
                          <button 
                            type="button" 
                            onClick={() => setSIsAcademy(!sIsAcademy)}
                            className={`w-14 h-7 rounded-full flex items-center px-1 transition-all ${sIsAcademy ? 'bg-teal-500' : 'bg-slate-700'}`}
                          >
                            <div className={`w-5 h-5 bg-white rounded-full shadow-lg transition-transform ${sIsAcademy ? 'translate-x-7' : 'translate-x-0'}`}></div>
                          </button>
                        </div>

                        {sIsAcademy && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-2 border-t border-white/10">
                            <label className="text-xs font-black text-teal-300 uppercase tracking-widest">Select Academy Subjects</label>
                            <input
                              type="text"
                              value={sAcademySubjects}
                              onChange={(e) => setSAcademySubjects(e.target.value)}
                              placeholder="e.g. Physics, Chemistry, Biology"
                              className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-2xl text-sm font-bold text-white placeholder:text-white/20 focus:bg-white/20 outline-none transition-all"
                            />
                          </motion.div>
                        )}
                      </div>

                      <div className="pt-4 flex flex-col gap-3">
                        <div className="flex gap-4">
                          <button 
                            type="button" 
                            onClick={() => setFormStep(2)}
                            className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
                          >
                            Back to Academic
                          </button>
                          <button 
                            type="submit"
                            className="flex-[2] py-4 bg-teal-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-teal-700 transition-all shadow-xl shadow-teal-200 active:scale-95 flex items-center justify-center gap-2"
                          >
                            <Save size={16} /> Complete Registration
                          </button>
                        </div>
                        <p className="text-xs text-center text-slate-400 font-bold uppercase tracking-widest">Ensure all data is correct before committing to cloud ledger</p>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* ============ CLASS FORM FIELDS ============ */}
              {modalType === 'class' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Class Name</label>
                      <input
                        type="text"
                        required
                        value={cClassName}
                        onChange={(e) => setCClassName(e.target.value)}
                        placeholder="e.g. Grade 10"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Section</label>
                      <input
                        type="text"
                        required
                        value={cSection}
                        onChange={(e) => setCSection(e.target.value)}
                        placeholder="e.g. A"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Assigned Class Teacher</label>
                    <select
                      value={cTeacherId}
                      onChange={(e) => setCTeacherId(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                    >
                      <option value="">Choose Class Teacher</option>
                      {teachers.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.subject})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-3 p-4 bg-slate-50 border border-slate-200">
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest">Manage Class Subjects</label>
                    
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <select 
                          className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-md text-xs focus:outline-none focus:border-teal-500"
                          onChange={(e) => {
                            const sub = e.target.value;
                            if (sub === 'OTHER_MANUAL') {
                              setShowOtherSubjectInput(true);
                            } else if (sub && !cSubjects.includes(sub)) {
                              setCSubjects([...cSubjects, sub]);
                              setShowOtherSubjectInput(false);
                            }
                            e.target.value = '';
                          }}
                        >
                          <option value="">Select subject to add...</option>
                          {STANDARD_SUBJECTS_LIST.filter(s => !cSubjects.includes(s)).map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                          <option value="OTHER_MANUAL" className="font-bold text-teal-600">+ Other (Manual Entry)</option>
                        </select>
                      </div>

                      {showOtherSubjectInput && (
                        <div className="flex gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                          <input 
                            type="text"
                            placeholder="Enter custom subject name..."
                            value={manualSubjectName}
                            onChange={(e) => setManualSubjectName(e.target.value)}
                            className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:border-teal-500 font-bold uppercase"
                          />
                          <button 
                            type="button"
                            onClick={() => {
                              const trimmed = manualSubjectName.trim();
                              if (trimmed && !cSubjects.includes(trimmed)) {
                                setCSubjects([...cSubjects, trimmed]);
                                setManualSubjectName('');
                                setShowOtherSubjectInput(false);
                              } else if (!trimmed) {
                                setShowOtherSubjectInput(false);
                              } else {
                                toast.error("Subject already exists in list.");
                              }
                            }}
                            className="px-4 py-2 bg-teal-600 text-white text-xs font-black uppercase tracking-widest rounded-md"
                          >
                            Add
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {cSubjects.map(sub => (
                        <span key={sub} className="flex items-center gap-1.5 bg-teal-100 text-teal-700 text-xs font-bold px-2.5 py-1 rounded-full border border-teal-200">
                          {sub}
                          <button 
                            type="button"
                            onClick={() => setCSubjects(cSubjects.filter(s => s !== sub))}
                            className="hover:text-teal-900"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      {cSubjects.length === 0 && (
                        <p className="text-xs text-slate-400 ">No subjects added yet. Pick from the dropdown above.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ============ TIMETABLE FORM FIELDS ============ */}
              {modalType === 'timetable' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Target Class</label>
                      <select
                        value={ttClassId}
                        onChange={(e) => setTtClassId(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      >
                        {classes.map(cl => (
                          <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Week Day</label>
                      <select
                        value={ttDay}
                        onChange={(e) => setTtDay(e.target.value as DayOfWeek)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      >
                        {DAYS.map(day => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Period slot</label>
                      <div className="flex gap-2">
                        {!isCustomPeriod ? (
                          <select
                            value={ttPeriod}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setIsCustomPeriod(true);
                                setTtPeriod('');
                              } else {
                                setTtPeriod(e.target.value);
                              }
                            }}
                            className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                          >
                            {['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5', ...(appSettings.extraPeriods[ttClassId || selectedTimetableClass] || [])].map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                            <option value="__custom__">+ Enter Custom / Next Period...</option>
                          </select>
                        ) : (
                          <div className="flex-1 flex gap-2">
                            <input
                              type="text"
                              required
                              value={ttPeriod}
                              onChange={(e) => setTtPeriod(e.target.value)}
                              placeholder="e.g. Period 6"
                              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setIsCustomPeriod(false);
                                setTtPeriod('Period 1');
                              }}
                              className="px-2 py-1 text-xs border border-gray-300 hover:bg-gray-100 rounded-lg"
                            >
                              Reset
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Assigned Teaching Time</label>
                      <input
                        type="text"
                        required
                        value={ttTime}
                        onChange={(e) => setTtTime(e.target.value)}
                        placeholder="e.g. 08:30 AM - 09:30 AM"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Subject Title</label>
                      <input
                        type="text"
                        required
                        value={ttSubject}
                        onChange={(e) => setTtSubject(e.target.value)}
                        placeholder="e.g. Algebra"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Instructing Teacher</label>
                      <select
                        value={ttTeacherId}
                        onChange={(e) => setTtTeacherId(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-teal-500"
                      >
                        <option value="">Select Instructor</option>
                        {teachers.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.subject})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 hover:bg-gray-250 border border-gray-250 text-gray-700 rounded-xl text-xs font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  id="modal-submit-btn"
                  type="submit"
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-all"
                >
                  Save Entity
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ========== STUDENT DETAIL REPORT MODAL ========== */}
      <AnimatePresence>
        {selectedStudentReport && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-3 sm:p-5 overflow-y-auto z-[150] animate-in fade-in duration-300 print:static print:bg-white print:p-0">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col my-auto sm:my-8 max-h-none print:max-h-none print:shadow-none print:rounded-none print:border-none print:w-full"
            >
              {/* Modal Top Banner & Student Info */}
              <div className="pt-2 pb-5 px-4 sm:pt-4 sm:pb-8 sm:px-8 bg-slate-900 text-white flex justify-between items-start relative overflow-hidden print:bg-white print:text-slate-950 print:border-b print:p-4">
                <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 rounded-full -mr-32 -mt-32 blur-3xl print:hidden"></div>
                
                <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-5 -mt-1">
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border-2 border-teal-300/40 shadow-xl bg-slate-800 shrink-0">
                    {getStudentPhoto(selectedStudentReport) ? (
                      <img 
                        src={getStudentPhoto(selectedStudentReport)} 
                        alt={selectedStudentReport.name} 
                        className="w-full h-full object-cover object-top" 
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-800 flex items-center justify-center" />
                    )}
                  </div>
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-widest bg-teal-500/20 text-teal-300 border border-teal-500/30 mb-1.5">
                      Student Official Report
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">{selectedStudentReport.name}</h2>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="bg-white/10 text-white/90 px-3 py-1 rounded-lg text-xs font-mono font-bold border border-white/10">
                        Roll #{selectedStudentReport.rollNumber}
                      </span>
                      <span className="bg-teal-500/30 text-teal-200 px-3 py-1 rounded-lg text-xs font-bold border border-teal-400/20">
                        {selectedStudentReport.category || 'General'}
                      </span>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedStudentReport(null)}
                  className="relative z-10 p-2 hover:bg-white/10 rounded-xl transition-all text-white/70 hover:text-white print:hidden cursor-pointer"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 bg-slate-50/60 print:bg-white print:p-4 print:overflow-visible">
                {/* Contact & Profile Quick Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">Parent Phone</p>
                    <p className="text-sm font-mono font-bold text-slate-800 mt-1">{selectedStudentReport.parentPhone || 'N/A'}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">Guardian Name</p>
                    <p className="text-sm font-bold text-slate-800 mt-1">{selectedStudentReport.guardianName || 'N/A'}</p>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400">Academic Email</p>
                    <p className="text-sm font-bold text-slate-800 mt-1 truncate">{selectedStudentReport.email || 'N/A'}</p>
                  </div>
                </div>

                {/* Stats Overview */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:grid-cols-3">
                  {/* Attendance Card */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Attendance Rate</span>
                      <CalendarDays size={18} className="text-teal-500 print:hidden" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-slate-900">
                        {(() => {
                          const stats = attendance.filter(a => a.studentId === selectedStudentReport.id);
                          if (stats.length === 0) return '0%';
                          const present = stats.filter(a => a.status === 'present' || a.status === 'leave').length;
                          return `${Math.round((present / stats.length) * 100)}%`;
                        })()}
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Average Presence</p>
                    </div>
                  </div>

                  {/* Academics Card */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Academic Score</span>
                      <Award size={18} className="text-teal-500 print:hidden" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-slate-900">
                        {(() => {
                          const sMarks = marks.filter(m => m.studentId === selectedStudentReport.id);
                          if (sMarks.length === 0) return 'N/A';
                          const avg = Math.round(sMarks.reduce((sum, m) => sum + Number(m.marksObtained), 0) / sMarks.length);
                          return `${avg}%`;
                        })()}
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Average Marks</p>
                    </div>
                  </div>

                  {/* Financials Card */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Fee Balance</span>
                      <CreditCard size={18} className="text-amber-500 print:hidden" />
                    </div>
                    <div>
                      <div className="text-3xl font-black text-slate-900">
                        {(() => {
                          const fData = feeStudents.find(fs => String(fs.id) === String(selectedStudentReport.id));
                          if (!fData) return '0';
                          return `${getTotalPending(fData) + getTotalOtherFunds(fData)}`;
                        })()}
                      </div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5">Total Pending Dues</p>
                    </div>
                  </div>
                </div>

                {/* Detailed Sections */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:grid-cols-2">
                  {/* Test History */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                    <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider mb-4 flex items-center gap-2">
                      <BookOpen size={16} className="text-teal-600 print:hidden" /> Recent Exam Marks
                    </h3>
                    <div className="space-y-2.5">
                      {marks.filter(m => m.studentId === selectedStudentReport.id).length === 0 ? (
                        <p className="text-xs text-slate-400  py-4 text-center">No academic records found for this student.</p>
                      ) : (
                        marks
                          .filter(m => m.studentId === selectedStudentReport.id)
                          .slice(0, 5)
                          .map((m, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div>
                                <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{m.subject}</p>
                                <p className="text-xs font-bold text-slate-400 uppercase">{m.examType}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-black text-teal-600">{m.marksObtained} / {m.maxMarks}</p>
                              </div>
                            </div>
                          ))
                      )}
                    </div>
                  </div>

                  {/* Attendance Log */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                    <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider mb-4 flex items-center gap-2">
                      <Calendar size={16} className="text-teal-600 print:hidden" /> Monthly Attendance Summary
                    </h3>
                    <div className="space-y-2">
                      {MONTHS.map(month => {
                        const monthLogs = attendance.filter(a => {
                          const aDate = new Date(a.date);
                          return a.studentId === selectedStudentReport.id && MONTHS[aDate.getMonth()] === month;
                        });
                        
                        if (monthLogs.length === 0) return null;

                        const present = monthLogs.filter(l => l.status === 'present').length;
                        const leave = monthLogs.filter(l => l.status === 'leave').length;
                        const absent = monthLogs.filter(l => l.status === 'absent').length;

                        return (
                          <div key={month} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                            <span className="text-xs font-bold text-slate-800 uppercase">{month}</span>
                            <div className="flex gap-3 text-xs">
                              <span className="font-bold text-amber-600">P: {present}</span>
                              <span className="font-bold text-amber-600">L: {leave}</span>
                              <span className="font-bold text-rose-600">A: {absent}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Financial Ledger Section */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                  <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <CreditCard size={18} className="text-amber-600 print:hidden" /> Financial Payments & Ledger
                  </h3>
                  <div>
                    {(() => {
                      const fData = feeStudents.find(fs => String(fs.id) === String(selectedStudentReport.id));
                      if (!fData) return <p className="text-center text-slate-400  py-3 text-xs">No financial record on file.</p>;

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div>
                            <p className="text-xs font-black uppercase text-slate-400 tracking-wider mb-2">Paid History</p>
                            <div className="space-y-2">
                              {fData.payments.length === 0 ? (
                                <p className="text-xs text-slate-400 ">No payments recorded.</p>
                              ) : (
                                fData.payments.slice(0, 5).map((p, i) => (
                                  <div key={i} className="flex items-center justify-between p-2.5 bg-amber-50/60 rounded-xl border border-amber-100 gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-amber-900 uppercase">
                                        {formatDateDDMMYY((p as any).date) || `${p.month} ${p.year}`}
                                        <span className="text-[10px] font-black text-slate-400 normal-case"> · {String(p.month).replace(/ \d{4}$/, '')} {p.year}</span>
                                      </p>
                                      <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider mt-0.5">{p.feeType || (fees.find(f => f.id === p.id)?.feeType) || 'School Fee'}</p>
                                    </div>
                                    <span className="text-xs font-black text-amber-700 shrink-0">{p.amount}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-black uppercase text-slate-400 tracking-wider mb-2">Other Charges</p>
                            <div className="space-y-2">
                              {fData.otherFunds.length === 0 ? (
                                <p className="text-xs text-slate-400 ">No extra charges on record.</p>
                              ) : (
                                fData.otherFunds.slice(0, 5).map((f, i) => (
                                  <div key={i} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                                    <span className="text-xs font-bold text-slate-800 uppercase">{f.desc}</span>
                                    <span className="text-xs font-black text-slate-900">{f.amount}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="p-4 sm:p-5 bg-slate-100 border-t border-slate-200 flex justify-end gap-3 print:hidden">
                <button 
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-50 transition-all cursor-pointer"
                >
                  <Printer size={16} /> Print Report
                </button>
                <button 
                  onClick={() => setSelectedStudentReport(null)}
                  className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-all shadow-md cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========== PRINCIPAL ATTENDANCE MARKING MODAL ========== */}
      <AnimatePresence>
        {showMarkAttendanceModal && (
          <div className="fixed inset-0 bg-slate-900/80 flex items-center justify-center p-4 z-[110] backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-xl rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border-t-8 border-t-amber-600"
            >
              <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-50 text-amber-600">
                    <CheckCircle2 size={24} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight leading-tight">Direct Attendance Marking</h2>
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest tracking-[0.2em]">{attendanceFilterDate}</p>
                  </div>
                </div>
                
                <div className="relative">
                  <select
                    value={attendanceMode}
                    onChange={(e) => {
                      const mode = e.target.value as 'grid' | 'list' | 'swipe';
                      setAttendanceMode(mode);
                      if (mode === 'swipe') setActiveSwipeIndex(0);
                    }}
                    className="appearance-none pl-3 pr-8 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer"
                  >
                    <option value="grid">Grid View</option>
                    <option value="list">List View</option>
                    <option value="swipe">Swipe Mode</option>
                  </select>
                  <ChevronDown size={10} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                <button 
                  onClick={() => setShowMarkAttendanceModal(false)}
                  className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all border border-slate-200"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500 block">Target Class</label>
                    <select 
                      value={markAttendanceClassId}
                      onChange={(e) => setMarkAttendanceClassId(e.target.value)}
                      className="w-full bg-white border border-slate-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 focus:outline-none focus:border-amber-500"
                    >
                      <option value="">-- Choose Class --</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.className} - {c.section}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500 block">Recording Date</label>
                    <input 
                      type="date"
                      value={attendanceFilterDate}
                      onChange={(e) => setAttendanceFilterDate(e.target.value)}
                      className="w-full bg-white border border-slate-200 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-slate-700 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                {!markAttendanceClassId ? (
                   <div className="py-20 text-center border-2 border-dashed border-slate-100 ">
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Select a class to load student roster</p>
                   </div>
                ) : attendanceMode === 'swipe' ? (
                  /* Swipe Mode in Principal Modal */
                  <div className="flex flex-col items-center py-4 font-sans">
                    {markAttRecords.length > 0 ? (
                      activeSwipeIndex < markAttRecords.length ? (
                        (() => {
                          const currentRecord = markAttRecords[activeSwipeIndex];
                          const currentStudent = students.find(s => s.id === currentRecord.studentId);
                          const photoUrl = getStudentPhoto(currentStudent);

                          return (
                            <div className="w-full max-w-sm space-y-5">
                              {/* Progress indicators */}
                              <div className="flex justify-between items-center text-xs text-slate-600 font-bold px-1">
                                <span>Student {activeSwipeIndex + 1} of {markAttRecords.length}</span>
                                <span className="font-mono bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-teal-100">
                                  {Math.round((activeSwipeIndex / markAttRecords.length) * 100)}% Complete
                                </span>
                              </div>
                              
                              <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                                <div 
                                  className="bg-teal-600 h-full transition-all duration-300 rounded-full" 
                                  style={{ width: `${((activeSwipeIndex + 1) / markAttRecords.length) * 100}%` }}
                                ></div>
                              </div>

                              {/* Swipe Card */}
                              <div className="relative h-[22rem] w-full flex items-center justify-center bg-slate-100/70 border-2 border-dashed border-slate-200 p-3 rounded-3xl overflow-hidden">
                                <AnimatePresence mode="popLayout">
                                  <motion.div
                                    key={currentRecord.studentId}
                                    drag="x"
                                    dragConstraints={{ left: -160, right: 160 }}
                                    onDragEnd={(event, info) => {
                                      if (info.offset.x > 100) {
                                        // Swipe right -> Present
                                        setMarkAttRecords(prev => prev.map(p => p.studentId === currentRecord.studentId ? {...p, status: 'present'} : p));
                                        setActiveSwipeIndex(idx => idx + 1);
                                        toast.success(`Marked ${currentStudent?.name} as Present`);
                                      } else if (info.offset.x < -100) {
                                        // Swipe left -> Absent
                                        setMarkAttRecords(prev => prev.map(p => p.studentId === currentRecord.studentId ? {...p, status: 'absent'} : p));
                                        setActiveSwipeIndex(idx => idx + 1);
                                        toast.error(`Marked ${currentStudent?.name} as Absent`);
                                      }
                                    }}
                                    whileTap={{ scale: 1.02 }}
                                    initial={{ scale: 0.92, y: 15, opacity: 0 }}
                                    animate={{ scale: 1, y: 0, opacity: 1 }}
                                    exit={{
                                      x: currentRecord.status === 'present' ? 260 : -260,
                                      opacity: 0,
                                      scale: 0.8,
                                      transition: { duration: 0.3 }
                                    }}
                                    className="absolute inset-0 m-3 bg-white shadow-xl rounded-2xl border border-slate-200 flex flex-col p-6 cursor-grab active:cursor-grabbing"
                                  >
                                    <div className="text-center flex-1 flex flex-col justify-center">
                                      <div className="w-28 h-28 mx-auto mb-6">
                                        {photoUrl ? (
                                          <img 
                                            src={photoUrl} 
                                            alt={currentStudent?.name} 
                                            className="w-full h-full rounded-2xl object-cover border-4 border-slate-50 shadow-md"
                                          />
                                        ) : (
                                          <div className="w-full h-full rounded-2xl border-4 border-slate-50 shadow-md bg-slate-100" />
                                        )}
                                      </div>
                                      <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">{currentStudent?.name}</h2>
                                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Roll Number #{currentStudent?.rollNumber}</p>
                                      
                                      <div className="mt-8 flex justify-center gap-6">
                                        <div className="flex flex-col items-center gap-2">
                                          <div className="w-10 h-10 rounded-full border-2 border-rose-100 flex items-center justify-center text-rose-500">
                                            <ArrowLeft size={20} />
                                          </div>
                                          <span className="text-xs font-black text-rose-500 uppercase tracking-widest">Swipe Left: Absent</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-2">
                                          <div className="w-10 h-10 rounded-full border-2 border-amber-100 flex items-center justify-center text-amber-500">
                                            <ArrowRight size={20} />
                                          </div>
                                          <span className="text-xs font-black text-amber-500 uppercase tracking-widest">Swipe Right: Present</span>
                                        </div>
                                      </div>
                                    </div>
                                  </motion.div>
                                </AnimatePresence>
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div className="py-20 text-center animate-fade-in">
                          <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 size={32} />
                          </div>
                          <h3 className="text-lg font-black text-slate-900 uppercase ">Roster Complete</h3>
                          <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">You have reviewed all student attendance records.</p>
                          <button
                            onClick={() => setActiveSwipeIndex(0)}
                            className="mt-6 px-6 py-2 bg-slate-900 text-white text-xs font-black uppercase tracking-widest"
                          >
                            Restart Swipe Session
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="py-20 text-center">
                         <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No students found in this class</p>
                      </div>
                    )}
                  </div>
                ) : attendanceMode === 'list' ? (
                  /* List Mode - Compact */
                  <div className="space-y-3">
                    <div className="divide-y divide-slate-100 border border-slate-100 rounded-none">
                      {markAttRecords.map((rec, idx) => {
                        const student = students.find(s => s.id === rec.studentId);
                        return (
                          <div key={rec.studentId} className="flex items-center justify-between p-3 bg-white hover:bg-slate-50">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-black text-slate-400 w-6">#{idx+1}</span>
                              <p className="text-xs font-black text-slate-900 uppercase truncate max-w-[120px]">{student?.name}</p>
                            </div>
                            <div className="flex items-center gap-1">
                               {(['present', 'absent', 'late', 'leave'] as const).map(status => (
                                <button
                                  key={status}
                                  onClick={() => {
                                    setMarkAttRecords(prev => prev.map(p => p.studentId === rec.studentId ? {...p, status} : p));
                                  }}
                                  className={`px-2 py-1 text-xs font-black uppercase tracking-tighter ${
                                    rec.status === status 
                                      ? status === 'present' ? 'bg-amber-600 text-white shadow-sm' :
                                        status === 'absent' ? 'bg-rose-600 text-white shadow-sm' :
                                        status === 'late' ? 'bg-amber-500 text-white shadow-sm' :
                                        'bg-teal-600 text-white shadow-sm'
                                      : 'bg-slate-100 text-slate-400'
                                  }`}
                                >
                                  {status === 'present' ? 'P' : status === 'absent' ? 'A' : status === 'late' ? 'L' : 'LV'}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Grid Mode (Default) */
                  <div className="space-y-3">
                    <div className="flex justify-between items-center mb-1">
                       <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Student Roll Call ({markAttRecords.length})</h3>
                       <div className="flex gap-2">
                          <button 
                            onClick={() => setMarkAttRecords(prev => prev.map(p => ({...p, status: 'present'})))}
                            className="text-xs font-black uppercase tracking-widest text-amber-600 hover:bg-amber-50 px-2 py-1"
                          >
                            All Present
                          </button>
                          <button 
                            onClick={() => setMarkAttRecords(prev => prev.map(p => ({...p, status: 'absent'})))}
                            className="text-xs font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50 px-2 py-1"
                          >
                            All Absent
                          </button>
                       </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {markAttRecords.map((rec, idx) => {
                        const student = students.find(s => s.id === rec.studentId);
                        return (
                          <div key={rec.studentId} className="flex flex-col p-4 bg-white border border-slate-100 rounded-none hover:border-amber-200 transition-colors">
                            <div className="flex items-center gap-3 mb-3">
                              {getStudentPhoto(student) ? (
                                <img src={getStudentPhoto(student)} alt={student?.name || 'Student'} className="w-10 h-10 rounded-xl object-cover border border-slate-100 bg-slate-50" />
                              ) : (
                                <div className="w-10 h-10 rounded-xl border border-slate-100 bg-slate-50" />
                              )}
                              <div>
                                <p className="text-xs font-black text-slate-900 uppercase leading-none">{student?.name}</p>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Roll #{student?.rollNumber}</p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-1 p-1 bg-slate-50 rounded-none">
                              {(['present', 'absent', 'late', 'leave'] as const).map(status => (
                                <button
                                  key={status}
                                  onClick={() => {
                                    setMarkAttRecords(prev => prev.map(p => p.studentId === rec.studentId ? {...p, status} : p));
                                  }}
                                  className={`flex-1 py-1.5 text-xs font-black uppercase tracking-widest transition-all ${
                                    rec.status === status 
                                      ? status === 'present' ? 'bg-amber-600 text-white shadow-md' :
                                        status === 'absent' ? 'bg-rose-600 text-white shadow-md' :
                                        status === 'late' ? 'bg-amber-500 text-white shadow-md' :
                                        'bg-teal-600 text-white shadow-md'
                                      : 'text-slate-400 hover:text-slate-900 hover:bg-white'
                                  }`}
                                >
                                  {status === 'present' ? 'P' : status === 'absent' ? 'A' : status === 'late' ? 'L' : 'LV'}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-4">
                <button
                  onClick={() => setShowMarkAttendanceModal(false)}
                  className="px-6 py-3 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest hover:bg-white transition-all rounded-none"
                >
                  Discard Changes
                </button>
                <button
                  disabled={!markAttendanceClassId}
                  onClick={handlePrincipalMarkAttendance}
                  className="px-8 py-3 bg-slate-950 text-white text-xs font-black uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-amber-600 disabled:opacity-50 disabled:bg-slate-400 transition-all rounded-none shadow-xl"
                >
                  <Save size={14} /> Commit Attendance Record
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========== MOBILE RESPONSIVE BOTTOM FOOTER NAVIGATION ========== */}
      <div id="principal-mobile-footer-nav" className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 text-white z-50 shadow-2xl px-1 pb-safe select-none print:hidden">
        <div className="flex justify-around items-center h-16">
          {[
            { id: 'dashboard', label: 'Home', icon: BarChart2, color: 'emerald' },
            { id: 'management_hub', label: 'Admin', icon: Shield, color: 'indigo' },
            { id: 'monthly_report', label: 'Reports', icon: FileText, color: 'violet' },
            { id: 'registers', label: 'Records', icon: Database, color: 'teal', extraMatch: 'fees' },
          ].map((item) => {
            const isActive = activeTab === item.id || (item.extraMatch && activeTab === item.extraMatch);
            const Icon = item.icon;
            
            return (
              <div key={item.id} className={`flex-1 flex justify-center transition-all duration-300 ${isActive ? '-translate-y-4' : 'translate-y-0'}`}>
                <button
                  onClick={() => { handleTabChange(item.id as any); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className={`flex flex-col items-center justify-center transition-all duration-300 ${
                    isActive 
                      ? `rounded-full p-2.5 shadow-2xl border-4 border-slate-900 scale-110 bg-${item.color === 'emerald' ? 'amber' : item.color === 'indigo' ? 'teal' : item.color === 'violet' ? 'rose' : 'teal'}-600 text-white` 
                      : 'text-slate-400 hover:text-white p-2'
                  }`}
                  style={isActive ? { minHeight: '52px', minWidth: '52px' } : {}}
                >
                  <Icon size={isActive ? 20 : 18} className={isActive ? 'stroke-[2.5]' : ''} />
                  <span className={`text-[10px] uppercase tracking-widest mt-0.5 whitespace-nowrap ${isActive ? 'font-black' : 'font-bold'}`}>
                    {item.label}
                  </span>
                </button>
              </div>
            );
          })}
          
          <div className="flex-1 flex justify-center">
            <button
              id="mobile-nav-menu"
              onClick={() => setSidebarOpen(true)}
              className="flex flex-col items-center justify-center py-1 transition-all text-center text-slate-400 hover:text-amber-400 focus:outline-none"
            >
              <Menu size={18} />
              <span className="text-[10px] mt-0.5 font-bold uppercase tracking-wider">Menu</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========== INTERACTIVE CLASS INSIGHTS MODAL ========== */}
      {isClassDetailModalOpen && selectedClassForDetails && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100] backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-none w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scale-up border-t-8 border-t-teal-600">
            {/* Modal Header */}
            <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-slate-950 text-white flex flex-col items-center justify-center font-black  border-l-4 border-teal-600">
                  <span className="text-xl">{selectedClassForDetails.className}</span>
                  <span className="text-xs uppercase tracking-widest bg-teal-600 w-full text-center py-0.5">{selectedClassForDetails.section}</span>
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Interactive Class Insights</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Timetable & Student Roster Overview</p>
                </div>
              </div>
              <button
                onClick={() => setIsClassDetailModalOpen(false)}
                className="p-2 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-900 transition-all border border-slate-200 shadow-sm"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
              {/* Section 0: Academic Scope / Subjects */}
              {selectedClassForDetails.subjects && selectedClassForDetails.subjects.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                    <BookOpen size={18} className="text-teal-600" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Academic Curriculum / Subjects</h3>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {selectedClassForDetails.subjects.map(sub => (
                      <div key={sub} className="bg-slate-50 border border-slate-200 px-4 py-2 flex items-center gap-2 shadow-sm">
                        <div className="w-2 h-2 bg-teal-500 rounded-full"></div>
                        <span className="text-xs font-black text-slate-700 uppercase ">{sub}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 1: Timetable */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Calendar size={18} className="text-teal-600" />
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Period Schedule (Weekly)</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  {DAYS.map(day => (
                    <div key={day} className="space-y-2">
                      <div className="bg-slate-900 text-white text-xs font-black uppercase py-1.5 px-3 tracking-widest flex items-center justify-between shadow-md">
                        <span>{day}</span>
                        <button 
                          onClick={() => {
                            setIsClassDetailModalOpen(false);
                            if (selectedClassForDetails) {
                              setSelectedTimetableClass(selectedClassForDetails.id);
                              setTtClassId(selectedClassForDetails.id);
                              setTtDay(day);
                              const existingCount = timetable.filter(tt => tt.classId === selectedClassForDetails.id && tt.day === day).length;
                              setTtPeriod(`Period ${existingCount + 1}`);
                              handleTabChange('timetable');
                              openAddModal('timetable');
                            }
                          }}
                          className="bg-teal-600 hover:bg-teal-500 p-1 rounded transition-colors"
                          title="Add entry to this day"
                        >
                          <Plus size={8} />
                        </button>
                      </div>
                      <div className="space-y-1.5 min-h-[100px] bg-slate-50/50 p-2 border border-slate-100">
                        {timetable
                          .filter(tt => tt.classId === selectedClassForDetails.id && tt.day === day)
                          .sort((a,b) => a.period.localeCompare(b.period))
                          .map(entry => (
                            <div key={entry.id} className="p-2 bg-white border border-slate-200 shadow-xs border-l-2 border-l-teal-500">
                              <p className="text-xs font-black text-teal-600 uppercase tracking-tighter leading-none mb-1">{entry.period}</p>
                              <p className="text-xs font-extrabold text-slate-900 uppercase  truncate leading-none mb-0.5">{entry.subject}</p>
                              <p className="text-xs text-slate-400 font-bold uppercase truncate">{getTeacherName(entry.teacherId)}</p>
                            </div>
                          ))}
                        {timetable.filter(tt => tt.classId === selectedClassForDetails.id && tt.day === day).length === 0 && (
                          <div className="h-full flex items-center justify-center py-8">
                             <p className="text-xs text-slate-400 font-bold uppercase tracking-widest text-center ">No Lectures</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2: Students Dropdown/List */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Users size={18} className="text-amber-600" />
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Enrolled Student Roster</h3>
                  </div>
                  <span className="bg-amber-50 text-amber-700 text-xs font-black px-3 py-1 rounded-full uppercase border border-amber-100">
                    {students.filter(s => s.classId === selectedClassForDetails.id).length} Active Pupils
                  </span>
                </div>

                <div className="relative group">
                  <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Jump to Student Profile:</label>
                  <select 
                    id="class-modal-student-jump"
                    className="w-full bg-slate-50 border border-slate-200 p-3 rounded-none focus:ring-1 focus:ring-teal-600 outline-none font-bold text-xs uppercase tracking-wider"
                    onChange={(e) => {
                      if (e.target.value) {
                         toast.info(`Reviewing profile for Student Registry #${e.target.value}...`);
                      }
                    }}
                  >
                    <option value="">Select a student from this class...</option>
                    {students
                      .filter(s => s.classId === selectedClassForDetails.id)
                      .map(s => (
                        <option key={s.id} value={s.id}>
                          Roll #{s.rollNumber} - {s.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {students.filter(s => s.classId === selectedClassForDetails.id).map(s => (
                    <div key={s.id} className="p-4 bg-white border border-slate-100 shadow-sm flex items-center gap-3">
                      {s.photo ? (
                        <img src={s.photo} alt={s.name} className="w-10 h-10 rounded-xl object-cover border border-slate-200 shadow-sm" />
                      ) : (
                        <div className="w-10 h-10 bg-slate-900 text-white flex items-center justify-center font-black text-xs border border-slate-800">
                          <User size={18} />
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight truncate leading-none mb-0.5">{s.name}</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Roll #{s.rollNumber}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
               <button
                 onClick={() => setIsClassDetailModalOpen(false)}
                 className="px-8 py-3 bg-slate-900 hover:bg-teal-600 text-white font-black text-xs uppercase tracking-[0.2em] transition-all shadow-lg shadow-slate-200"
               >
                 Close Insights
               </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== CUSTOM PERIOD DELETION CONFIRMATION MODAL ========== */}
      {periodToDeletePending && (
        <div id="delete-period-modal" className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in animate-duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-6 border border-slate-150 animate-scale-up">
            <div className="flex items-center gap-3 text-red-600 mb-4 bg-red-50 p-3.5 rounded-xl border border-red-100">
              <AlertCircle size={24} className="shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-red-950">Confirm Slot Removal</h3>
                <p className="text-xs text-red-800 font-bold uppercase tracking-widest mt-0.5">Destructive action override</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed mb-6 font-medium">
              Are you sure you want to completely remove <strong className="text-slate-900 font-black">"{periodToDeletePending.period}"</strong> on {periodToDeletePending.day}? 
              This will automatically purge all scheduled subject mappings under this slot for Class {getClassName(selectedTimetableClass)}. This action is immediate and cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setPeriodToDeletePending(null)}
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
              >
                No, Keep Period
              </button>
              <button
                type="button"
                onClick={() => {
                  executeDeletePeriod(periodToDeletePending.period, periodToDeletePending.day);
                }}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-red-250"
              >
                Yes, Remove Slot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== GENERAL DELETION CONFIRMATION MODAL ========== */}
      {deleteConfirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto animate-fade-in animate-duration-200">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-6 border border-slate-150 animate-scale-up">
            <div className="flex items-center gap-3 text-red-600 mb-4 bg-red-50 p-3.5 rounded-xl border border-red-100">
              <AlertCircle size={24} className="shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-red-950">Confirm Deletion</h3>
                <p className="text-xs text-red-800 font-bold uppercase tracking-widest mt-0.5">Destructive action override</p>
              </div>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed mb-6 font-medium">
              {deleteConfirmModal.message}
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal({ isOpen: false, type: '', id: '', message: '' })}
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAction}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-red-250"
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== STUDENT DETAIL MODAL ========== */}
      <AnimatePresence>
        {studentDetailModal.isOpen && studentDetailModal.student && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col"
            >
              <div className="bg-teal-600 p-5 sm:p-6 text-white flex justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {(() => {
                    const st = studentDetailModal.student!;
                    const photo = getStudentPhoto(st);
                    return photo ? (
                      <img src={photo} alt={st.name} className="w-12 h-12 rounded-full object-cover border-2 border-white/40 bg-white/20 shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-white/20 border-2 border-white/40 flex items-center justify-center shrink-0">
                        <User size={22} />
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-black uppercase tracking-tight truncate">Student Detail</h2>
                    <p className="text-xs uppercase font-bold text-teal-100 truncate">
                      {studentDetailModal.student.name} • Roll #{studentDetailModal.student.rollNumber || 'N/A'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setStudentDetailModal({ isOpen: false, student: null })}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors cursor-pointer shrink-0"
                  aria-label="Close student detail"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-4">
                {(() => {
                  const st = studentDetailModal.student!;
                  const classObj = classes.find(c => c.id === st.classId);
                  const fData = feeStudents.find(fs => String(fs.id) === String(st.id));
                  const totalPaid = fData ? (fData.payments || []).reduce((sum, p) => sum + p.amount, 0) : 0;
                  const totalPending = fData ? getTotalPending(fData) + getTotalOtherFunds(fData) : 0;

                  return (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Class & Section</span>
                          <span className="text-sm font-black text-slate-900">{classObj ? `${classObj.className} - ${classObj.section}` : 'N/A'}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Category</span>
                          <span className="text-sm font-black text-slate-900">{st.category || 'Regular'}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Guardian</span>
                          <span className="text-sm font-black text-slate-900">{st.guardianName || 'N/A'}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Parent Phone</span>
                          <span className="text-sm font-black text-slate-900">{st.parentPhone || 'N/A'}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Base Fee</span>
                          <span className="text-sm font-black text-slate-900">PKR {Number(st.baseFee || 0).toLocaleString()}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Enrollment</span>
                          <span className="text-sm font-black text-slate-900">{st.enrollmentMonth || 'N/A'}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Login ID</span>
                          <span className="text-sm font-black text-slate-900">{st.username || 'N/A'}</span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-slate-400 block mb-1">Password</span>
                          <span className="text-sm font-black text-slate-900">{st.password || 'nsb123'}</span>
                        </div>
                      </div>

                      {st.academySubjects && st.academySubjects.length > 0 && (
                        <div className="bg-teal-50/50 border border-teal-100 rounded-2xl p-3">
                          <span className="text-[10px] font-black uppercase text-teal-400 block mb-1.5">Academy Subjects Focus</span>
                          <div className="flex flex-wrap gap-1.5">
                            {st.academySubjects.map((sub, idx) => (
                              <span key={idx} className="bg-white border border-teal-200 text-teal-700 text-xs font-bold px-2 py-0.5 uppercase">{sub}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Fee Account Summary */}
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <span className="text-[10px] font-black uppercase text-slate-400 block mb-3">Fee Account Summary</span>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div>
                            <span className="text-lg font-black text-amber-600 block">{totalPaid.toLocaleString()}</span>
                            <span className="text-[10px] font-black uppercase text-slate-400">Total Paid</span>
                          </div>
                          <div>
                            <span className="text-lg font-black text-rose-600 block">{totalPending.toLocaleString()}</span>
                            <span className="text-[10px] font-black uppercase text-slate-400">Pending Dues</span>
                          </div>
                          <div>
                            <span className="text-lg font-black text-slate-900 block">{fData ? (fData.payments || []).length : 0}</span>
                            <span className="text-[10px] font-black uppercase text-slate-400">Receipts</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  onClick={() => openEditModal('student', studentDetailModal.student!.id)}
                  className="px-4 py-2.5 bg-amber-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-900 transition-all shadow-md flex items-center gap-2 cursor-pointer"
                >
                  <Edit2 size={14} /> Edit Student
                </button>
                <button
                  onClick={() => setStudentDetailModal({ isOpen: false, student: null })}
                  className="px-4 py-2.5 bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-300 transition-all cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {feePaymentModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl relative animate-scale-up">
            <button 
              onClick={() => setFeePaymentModal({ ...feePaymentModal, isOpen: false })} 
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 bg-slate-100 p-2 rounded-full transition-colors"
            >
              <X size={16} />
            </button>
            <div className="p-6 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 bg-teal-100 flex items-center justify-center rounded-2xl mx-auto mb-4 text-teal-600">
                  <CreditCard size={24} />
                </div>
                <h3 className="text-lg font-black text-slate-900 uppercase">Fee Payment</h3>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">{feePaymentModal.month} 2026</p>
                <div className="flex flex-col gap-1 items-center mt-2 border-t border-slate-100 pt-3">
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Previous Remaining: {feePaymentModal.previousArrears}</span>
                   <span className="text-xs font-bold text-teal-600 uppercase tracking-widest">Current Fee: {feePaymentModal.pending}</span>
                </div>
              </div>

              <div className="bg-slate-900 p-4 rounded-xl flex justify-between items-center text-white border border-slate-800 shadow-xl">
                <span className="text-xs font-black uppercase tracking-widest text-slate-300">Total Pending Dues</span>
                <span className="text-xl font-black text-rose-500">{feePaymentModal.pending + feePaymentModal.previousArrears}</span>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Fee Category</label>
                  <select
                    value={feePaymentModal.feeType}
                    onChange={(e) => setFeePaymentModal({ ...feePaymentModal, feeType: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-1 transition-colors outline-none appearance-none cursor-pointer"
                  >
                    <option value="School Fee">School Fee</option>
                    <option value="Tuition Fee">Tuition Fee</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Amount to Pay ()</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400 font-black text-sm"></span>
                    <input 
                      type="number"
                      value={feePaymentModal.amount}
                      onChange={(e) => setFeePaymentModal({ ...feePaymentModal, amount: e.target.value })}
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xl font-black text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-1 transition-colors outline-none"
                    />
                  </div>
                </div>

                <button 
                  onClick={() => {
                    const amt = Number(feePaymentModal.amount);
                    if (amt !== 0) {
                      setFeeStudents(prev => addPayment(prev, feePaymentModal.studentId, feePaymentModal.month, feePaymentModal.year, amt, feePaymentModal.feeType));
                      const studentObj = students.find(s => String(s.id) === String(feePaymentModal.studentId));
                      if (studentObj) handleSendFeeNotification(studentObj, 'payment', amt, `${feePaymentModal.month} ${feePaymentModal.year}`);
                      setFeePaymentModal({ ...feePaymentModal, isOpen: false });
                      toast.success(`Payment transaction of ${amt} recorded for ${feePaymentModal.month}`);
                    } else {
                      toast.error("Enter a valid non-zero amount");
                    }
                  }}
                  className="w-full py-4 bg-teal-600 hover:bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex justify-center items-center gap-2"
                >
                  Confirm Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== FEE RECORD EDIT MODAL ========== */}
      {feeEditModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-[110] overflow-y-auto animate-fade-in animate-duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col p-8 border border-slate-200 animate-scale-up">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Edit {feeEditModal.type === 'payment' ? 'Payment' : 'Other Fund'} Record</h3>
              <button 
                onClick={() => setFeeEditModal({ ...feeEditModal, isOpen: false })}
                className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6">
              {feeEditModal.type === 'other' && (
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Description</label>
                  <input 
                    type="text"
                    value={feeEditModal.desc}
                    onChange={(e) => setFeeEditModal({ ...feeEditModal, desc: e.target.value })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-1 transition-colors outline-none"
                  />
                </div>
              )}

              {feeEditModal.type === 'payment' && (
                <>
                  <div className="bg-teal-50/50 border border-teal-100 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                      <span>Month</span>
                      <span className="text-slate-900 font-black">{feeEditModal.desc || 'N/A'}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                      <span>Paid On</span>
                      <span className="text-slate-900 font-black">
                        {fees.find(f => f.id === feeEditModal.recordId)?.paidDate || feeStudents.flatMap(fs => fs.payments || []).find(p => p.id === feeEditModal.recordId)?.date || 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                      <span>Method</span>
                      <span className="text-slate-900 font-black">{fees.find(f => f.id === feeEditModal.recordId)?.paymentMethod || 'Cash'}</span>
                    </div>
                    {fees.find(f => f.id === feeEditModal.recordId)?.description && (
                      <div className="text-[11px] font-bold text-slate-500 uppercase">
                        <span className="block mb-1">Notes</span>
                        <span className="text-slate-700 normal-case font-medium">{fees.find(f => f.id === feeEditModal.recordId)?.description}</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Fee Category</label>
                    <select
                      value={feeEditModal.feeType}
                      onChange={(e) => setFeeEditModal({ ...feeEditModal, feeType: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500 appearance-none cursor-pointer"
                    >
                      <option value="School Fee">School Fee</option>
                      <option value="Tuition Fee">Tuition Fee</option>
                      {!['School Fee', 'Tuition Fee'].includes(feeEditModal.feeType) && (
                        <option value={feeEditModal.feeType}>{feeEditModal.feeType} (purana record)</option>
                      )}
                    </select>
                  </div>
                </>
              )}
              
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Amount ()</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-slate-400 font-black text-sm"></span>
                  <input 
                    type="number"
                    value={feeEditModal.amount}
                    onChange={(e) => setFeeEditModal({ ...feeEditModal, amount: e.target.value })}
                    className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xl font-black text-slate-900 focus:outline-none focus:border-teal-500 focus:ring-1 transition-colors outline-none"
                  />
                </div>
              </div>

              <div className="pt-4 flex flex-col gap-3">
                <button 
                  onClick={() => {
                    const amt = Number(feeEditModal.amount);
                    if (feeEditModal.type === 'payment') {
                      setFeeStudents(prev => editPayment(prev, feeEditModal.studentId, feeEditModal.recordId, amt, feeEditModal.feeType));
                      setFees(prev => prev.map(item => item.id === feeEditModal.recordId ? { ...item, amount: amt, feeType: feeEditModal.feeType } : item));
                    } else {
                      setFeeStudents(prev => editOtherFund(prev, feeEditModal.studentId, feeEditModal.recordId, feeEditModal.desc, amt));
                    }
                    setFeeEditModal({ ...feeEditModal, isOpen: false });
                    toast.success("Record updated successfully!");
                  }}
                  className="w-full py-4 bg-teal-600 hover:bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex justify-center items-center gap-2"
                >
                  <Save size={16} /> Save Changes
                </button>
                <button 
                  onClick={() => setFeeEditModal({ ...feeEditModal, isOpen: false })}
                  className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex justify-center items-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Absentees WhatsApp Center Modal */}
      <AnimatePresence>
        {absenteesModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col"
            >
              <div className="bg-rose-600 p-5 sm:p-6 text-white flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight flex items-center gap-2.5">
                    <MessageSquare size={22} /> Absentees & WhatsApp Center
                  </h2>
                  <p className="text-xs uppercase font-bold text-rose-100 mt-1">
                    Dispatch absence alerts directly to parents from this ledger
                  </p>
                </div>
                <button
                  onClick={() => setAbsenteesModalOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors cursor-pointer shrink-0"
                  aria-label="Close absentees center"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Filter summary bar */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-black text-slate-600 uppercase tracking-wider">
                  <Filter size={14} className="text-rose-500" />
                  {absenteesModalClassFilter === 'all' ? 'All Classes' : getClassName(absenteesModalClassFilter)} • {attendanceFilterDate}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={13} />
                    <select
                      value={absenteesModalClassFilter}
                      onChange={(e) => setAbsenteesModalClassFilter(e.target.value)}
                      className="pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-xl text-[11px] font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-rose-400 appearance-none cursor-pointer"
                    >
                      <option value="all">All Classes</option>
                      {classes.map(c => (
                        <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={13} />
                  </div>
                  <span className="text-xs font-black text-rose-600 uppercase tracking-wider bg-rose-50 border border-rose-100 px-3 py-1 rounded-full whitespace-nowrap">
                    {attendance.filter(a => {
                      const student = students.find(s => String(s.id) === String(a.studentId));
                      const matchesClass = absenteesModalClassFilter === 'all' || student?.classId === absenteesModalClassFilter;
                      return a.date === attendanceFilterDate && matchesClass && a.status === 'absent';
                    }).length} Absentee(s)
                  </span>
                </div>
              </div>

              <div className="p-4 sm:p-6 flex-1 overflow-y-auto custom-scrollbar space-y-3">
                {(() => {
                  const absents = attendance.filter(a => {
                    const student = students.find(s => String(s.id) === String(a.studentId));
                    const matchesClass = absenteesModalClassFilter === 'all' || student?.classId === absenteesModalClassFilter;
                    return a.date === attendanceFilterDate && matchesClass && a.status === 'absent';
                  });

                  if (absents.length === 0) {
                    return (
                      <div className="py-14 text-center space-y-3">
                        <div className="w-14 h-14 mx-auto rounded-full bg-amber-50 flex items-center justify-center">
                          <CheckCircle2 size={26} className="text-amber-600" />
                        </div>
                        <p className="text-sm font-black text-slate-700 uppercase tracking-wider">No Absentees 🎉</p>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Everyone is present for this selection.</p>
                      </div>
                    );
                  }

                  return absents.map(acc => {
                    const st = studentsMap.get(String(acc.studentId));
                    const stFee = feeStudentsMap.get(String(acc.studentId));
                    const stName = st?.name || stFee?.name || `Student #${String(acc.studentId).slice(-4)}`;
                    const sClass = st?.classId ? getClassName(st.classId) : stFee?.class || 'N/A';
                    const phone = st?.parentPhone || st?.studentPhone || '';
                    const hasPhone = (phone || '').replace(/\D/g, '').length > 0;

                    return (
                      <div key={acc.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3 shadow-sm">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-rose-500 text-white flex items-center justify-center font-black text-sm shrink-0">
                            <User size={14} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">{stName}</h4>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">
                              {sClass} | Roll: {st?.rollNumber || 'N/A'} | {acc.date}
                            </p>
                            <p className={`text-[10px] font-black uppercase tracking-wider ${hasPhone ? 'text-amber-600' : 'text-rose-500'}`}>
                              {hasPhone ? phone : 'No Phone Number'}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => st && handleSendIndividualWhatsApp(st, acc.date)}
                          disabled={!st || !hasPhone}
                          title={hasPhone ? `Send WhatsApp to ${stName}'s parent` : 'No phone number available'}
                          className={`p-2.5 flex items-center justify-center rounded-xl transition-all shadow-md active:scale-95 cursor-pointer shrink-0 ${
                            hasPhone ? 'bg-amber-600 hover:bg-slate-900 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <Send size={16} />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare size={16} className="text-amber-600 shrink-0" />
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Tap Send to open WhatsApp per parent</span>
                </div>
                <button
                  onClick={() => setAbsenteesModalOpen(false)}
                  className="px-6 py-2.5 bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-300 rounded-xl transition-all cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk WA Modal */}
      <AnimatePresence>
        {bulkWAModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="bg-amber-600 p-6 text-white flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                    <MessageSquare size={24} /> Bulk WhatsApp Dispatch
                  </h2>
                  <p className="text-xs uppercase font-bold text-amber-100 mt-1">Total Absents: {bulkWAModal.absents.length} students</p>
                </div>
                <button 
                  onClick={() => setBulkWAModal({ isOpen: false, absents: [] })}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Class Filter Dropdown in Modal */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="flex-1 relative">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <select 
                    value={bulkWAClassFilter}
                    onChange={(e) => setBulkWAClassFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-amber-500 appearance-none"
                  >
                    <option value="all">Filter by Class (All)</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-4">
                {(() => {
                  const filtered = bulkWAModal.absents.filter(st => bulkWAClassFilter === 'all' || st.classId === bulkWAClassFilter);
                  
                  if (filtered.length === 0) {
                    return <p className="text-center py-10 text-slate-400 font-bold uppercase text-xs">No students matching filter</p>;
                  }

                  return filtered.map((st, idx) => {
                    const sClass = classes.find(c => c.id === st.classId);
                    return (
                      <div key={st.id || idx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-4 shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center font-black text-slate-600 text-sm">
                            {idx + 1}
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight ">{st.name}</h4>
                            <p className="text-xs font-bold text-slate-400 uppercase">
                              {sClass ? `${sClass.className} - ${sClass.section}` : 'N/A'} | Roll: {st.rollNumber} | {st.parentPhone || 'No Phone'}
                            </p>
                          </div>
                        </div>
                        <button 
                            onClick={() => handleSendIndividualWhatsApp(st, st.attendanceDate)}
                            title="Send WhatsApp Alert"
                            className="p-2.5 bg-amber-600 hover:bg-slate-900 text-white flex items-center justify-center rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                        >
                          <Send size={16} />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-amber-600" />
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest uppercase">Click Send for each parent</span>
                </div>
                <button 
                  onClick={() => setBulkWAModal({ isOpen: false, absents: [] })}
                  className="px-6 py-2.5 bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-300 rounded-xl transition-all"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Fee Reminder Dispatch Modal */}
      <AnimatePresence>
        {feeReminderModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col"
            >
              <div className="bg-amber-600 p-5 sm:p-6 text-white flex justify-between items-center gap-3 shrink-0">
                <div>
                  <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight flex items-center gap-3">
                    <Bell size={24} /> Fee Reminder Dispatch
                  </h2>
                  <p className="text-xs uppercase font-bold text-amber-100 mt-1">
                    {getFeeReminderRecipients.length} students • Total pending PKR {getFeeReminderRecipients.reduce((s, r) => s + r.totalPending, 0).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => setFeeReminderModal(false)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="px-6 pt-4 pb-2 shrink-0">
                <div className="relative">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <select
                    value={feeReminderClassFilter}
                    onChange={(e) => setFeeReminderClassFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="all">All Classes</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                  Pending months (current month tak) + dues — message Settings ke feeTemplate se banta hai
                </p>
              </div>

              <div className="p-6 pt-2 max-h-[55vh] overflow-y-auto custom-scrollbar space-y-3">
                {(() => {
                  const filtered = getFeeReminderRecipients.filter(r => feeReminderClassFilter === 'all' || r.student.classId === feeReminderClassFilter);
                  if (filtered.length === 0) {
                    return (
                      <div className="py-10 text-center bg-amber-50/50 rounded-2xl border border-dashed border-amber-200">
                        <CheckCircle2 size={28} className="text-amber-500 mx-auto mb-2" />
                        <p className="text-xs font-bold text-amber-600 uppercase tracking-widest">All fees are clear — no reminders needed!</p>
                      </div>
                    );
                  }
                  return filtered.map((r, idx) => {
                    const st = r.student;
                    const sClass = classes.find(c => c.id === st.classId);
                    const sent = feeReminderSentIds.has(String(st.id));
                    const monthsText = r.pendingMonths.map(m => m.month).join(', ');
                    return (
                      <div key={st.id || idx} className={`p-4 rounded-2xl flex items-center justify-between gap-4 shadow-sm border transition-all ${sent ? 'bg-amber-50/60 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 ${sent ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                            {sent ? <CheckCircle2 size={16} /> : idx + 1}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">{st.name}</h4>
                            <p className="text-[11px] font-bold text-slate-400 uppercase truncate">
                              {sClass ? `${sClass.className} - ${sClass.section}` : 'N/A'} | Roll: {st.rollNumber || 'N/A'} | {st.parentPhone || 'No Phone'}
                            </p>
                            <p className="text-[10px] font-bold text-amber-600 uppercase truncate">
                              {monthsText ? `Pending: ${monthsText}` : 'Dues only'}{r.dues > 0 ? ` + Dues PKR ${r.dues.toLocaleString()}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-black text-rose-600">PKR {r.totalPending.toLocaleString()}</span>
                          <button
                            onClick={() => handleSendFeeReminderWhatsApp(st)}
                            title="Send WhatsApp Reminder"
                            className="p-2.5 bg-amber-600 hover:bg-slate-900 text-white flex items-center justify-center rounded-xl transition-all shadow-md active:scale-95 cursor-pointer"
                          >
                            <Send size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-amber-600" />
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                    Sent: {feeReminderSentIds.size} / {getFeeReminderRecipients.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyAllFeeReminders}
                    className="px-4 py-2.5 bg-teal-600 text-white font-black text-xs uppercase tracking-widest hover:bg-teal-700 rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
                  >
                    <MessageSquare size={14} /> Copy All
                  </button>
                  <button
                    onClick={() => setFeeReminderModal(false)}
                    className="px-6 py-2.5 bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-300 rounded-xl transition-all cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Apply Due to Class or Single Student — Fixed Overlay Modal */}
      <AnimatePresence>
        {showBulkDueModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh]"
            >
              <div className="bg-teal-600 p-5 sm:p-6 text-white flex justify-between items-center gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-black uppercase tracking-tight flex items-center gap-2.5">
                    <Users size={20} /> Apply Due
                  </h2>
                  <p className="text-[10px] uppercase font-bold text-teal-100 mt-0.5">Paper Fund / Annual Fee / Exam Fee — single student ya pori class</p>
                </div>
                <button
                  onClick={() => setShowBulkDueModal(false)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Target Toggle: Single Student or Whole Class */}
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setBulkDueTarget('class')}
                    className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer ${bulkDueTarget === 'class' ? 'bg-teal-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    <Users size={14} className="inline mr-1" /> Whole Class
                  </button>
                  <button
                    onClick={() => setBulkDueTarget('student')}
                    className={`flex-1 py-2.5 text-xs font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer ${bulkDueTarget === 'student' ? 'bg-teal-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    <User size={14} className="inline mr-1" /> Single Student
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {bulkDueTarget === 'class' ? (
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Class</label>
                      <select
                        value={bulkDueClassId}
                        onChange={(e) => setBulkDueClassId(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-teal-500 outline-none"
                      >
                        <option value="all">All Classes</option>
                        {classes.map(c => (
                          <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Student</label>
                      <select
                        value={bulkDueStudentId}
                        onChange={(e) => setBulkDueStudentId(e.target.value)}
                        className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-teal-500 outline-none"
                      >
                        <option value="">Select Student</option>
                        {students.map(s => {
                          const sClass = classes.find(c => c.id === s.classId);
                          return (
                            <option key={s.id} value={s.id}>{s.name} ({sClass ? `${sClass.className}-${sClass.section}` : 'N/A'})</option>
                          );
                        })}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Due Name / Fund</label>
                    <select
                      value={bulkDueDesc}
                      onChange={(e) => setBulkDueDesc(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-teal-500 outline-none"
                    >
                      <option value="Paper Fund">Paper Fund</option>
                      <option value="Annual Fee">Annual Fee</option>
                      <option value="Exam Fee">Exam Fee</option>
                      <option value="Admission Fee">Admission Fee</option>
                      <option value="Summer Pack">Summer Pack</option>
                      <option value="Miscellaneous">Miscellaneous</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Amount (PKR)</label>
                    <input
                      type="number"
                      value={bulkDueAmount}
                      onChange={(e) => setBulkDueAmount(e.target.value)}
                      placeholder="e.g. 200"
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-teal-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Month (Due kis mahine ki)</label>
                    <select
                      value={bulkDueMonth}
                      onChange={(e) => setBulkDueMonth(e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-teal-500 outline-none"
                    >
                      {MONTHS.map(m => (
                        <option key={m} value={`${m} ${new Date().getFullYear()}`}>{m} {new Date().getFullYear()}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="bg-teal-50/60 border border-teal-200 rounded-xl p-3">
                  <p className="text-[11px] font-bold text-slate-600">
                    <Users size={12} className="inline mr-1" />
                    Target: <span className="font-black text-teal-700">{bulkDueTarget === 'student'
                      ? (bulkDueStudentId ? (students.find(st => String(st.id) === String(bulkDueStudentId))?.name || '1 student') : 'Select a student')
                      : `${students.filter(st => bulkDueClassId === 'all' || st.classId === bulkDueClassId).length} students`}</span>
                    {' '}— for each, a <span className="text-rose-600 font-black">PENDING due</span> will be created. Those who haven't paid will show in <span className="text-rose-600 font-black">Remaining / Dues</span>.
                  </p>
                  <p className="text-[10px] font-bold text-slate-400 mt-1">Same student + same month + same fund pe dobara apply nahi hoga (duplicate guard).</p>
                </div>
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-200 flex justify-between items-center gap-2">
                <button
                  onClick={() => setShowBulkDueModal(false)}
                  className="px-6 py-2.5 bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-300 rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyDueToClass}
                  className="px-6 py-2.5 bg-teal-600 text-white font-black text-xs uppercase tracking-widest hover:bg-teal-700 rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
                >
                  {bulkDueTarget === 'student' ? <User size={14} /> : <Users size={14} />} {bulkDueTarget === 'student' ? 'Apply to Student' : 'Apply to All'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Bulk Result WhatsApp Modal */}
      <AnimatePresence>
        {resultWAModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="bg-teal-600 p-6 text-white flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                    <Award size={24} /> Bulk Result Dispatch
                  </h2>
                  <p className="text-xs uppercase font-bold text-teal-100 mt-1">
                    {resultWAModal.exam} — {resultWARows.length} students with marks
                  </p>
                </div>
                <button 
                  onClick={() => setResultWAModal({ isOpen: false, exam: '' })}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Class Filter Dropdown in Modal */}
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
                <div className="flex-1 relative">
                  <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <select 
                    value={resultWAClassFilter}
                    onChange={(e) => setResultWAClassFilter(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest outline-none focus:ring-2 focus:ring-teal-400 appearance-none"
                  >
                    <option value="all">Filter by Class (All)</option>
                    {classes.map(c => (
                      <option key={c.id} value={c.id}>{c.className} - {c.section}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => handleBulkSendResultWhatsApp(resultWARows.map(r => r.student), resultWAModal.exam)}
                  disabled={resultWARows.length === 0}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-black uppercase tracking-widest rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Send size={13} /> Send All
                </button>
              </div>

              <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-4">
                {(() => {
                  if (resultWARows.length === 0) {
                    return <p className="text-center py-10 text-slate-400 font-bold uppercase text-xs">No students with marks for this exam</p>;
                  }

                  return resultWARows.map((row, idx) => {
                    const sClass = classes.find(c => c.id === row.student.classId);
                    const msg = buildResultMessage(row.student, resultWAModal.exam);
                    const sending = sendingResultIds.has(String(row.student.id));
                    return (
                      <div key={row.student.id || idx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between gap-4 shadow-sm">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-10 h-10 bg-teal-100 text-teal-700 rounded-full flex items-center justify-center font-black text-sm shrink-0">
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">{row.student.name}</h4>
                            <p className="text-xs font-bold text-slate-400 uppercase truncate">
                              {sClass ? `${sClass.className} - ${sClass.section}` : 'N/A'} | Roll: {row.student.rollNumber} | {row.marks.reduce((s, m) => s + Number(m.marksObtained || 0), 0)}/{row.marks.reduce((s, m) => s + Number(m.maxMarks || 0), 0)} | {(row.student as any).parentPhone || 'No Phone'}
                            </p>
                            <p className="text-[10px] font-bold text-slate-300 mt-1 truncate max-w-xs">{msg.replace(/\n/g, ' · ')}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleSendResultWhatsApp(row.student, resultWAModal.exam)}
                          disabled={sending}
                          title="Send Result Report"
                          className={`p-2.5 flex items-center justify-center rounded-xl transition-all shadow-md active:scale-95 cursor-pointer ${
                            sending ? 'bg-slate-300 text-slate-500' : 'bg-teal-600 hover:bg-teal-700 text-white'
                          }`}
                        >
                          <Send size={16} />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-amber-600" />
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">Click Send for each parent — full report included</span>
                </div>
                <button 
                  onClick={() => setResultWAModal({ isOpen: false, exam: '' })}
                  className="px-6 py-2.5 bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest hover:bg-slate-300 rounded-xl transition-all"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quick Fee Collection Modal */}
      <AnimatePresence>
        {showQuickCollectModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 my-auto max-h-[92vh] flex flex-col"
            >
              <div className="bg-amber-600 p-4 sm:p-6 text-white flex justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  {(() => {
                    const st = students.find(s => String(s.id) === String(quickCollectStudentId));
                    const photo = st ? getStudentPhoto(st) : '';
                    return photo ? (
                      <img
                        src={photo}
                        alt={st?.name || 'Student'}
                        className="w-12 h-12 rounded-xl object-cover border-2 border-white/40 bg-white/20 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-white/20 border-2 border-white/40 flex items-center justify-center shrink-0">
                        <User size={22} />
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-xl font-black uppercase tracking-tight flex items-center gap-2.5">
                      <CreditCard size={22} className="shrink-0" /> ⚡ Dues &amp; Fund Collection + Receipt
                    </h2>
                    {(() => {
                      const st = students.find(s => String(s.id) === String(quickCollectStudentId));
                      if (!st) return null;
                      return (
                        <p className="text-xs sm:text-xs uppercase font-bold text-amber-100 mt-0.5 truncate">
                          {st.name} • Roll #{st.rollNumber || 'N/A'}
                        </p>
                      );
                    })()}
                  </div>
                </div>
                <button
                  onClick={() => { setShowQuickCollectModal(false); setQuickCollectTargetMonth(null); setQuickCollectNotes(''); setQcReceipt(null); }} className="p-1.5 hover:bg-white/20 rounded-full transition-colors cursor-pointer shrink-0"
                >
                  <X size={20} />
                </button>
              </div>

              {qcReceipt ? (
                <div className="p-5 sm:p-6 space-y-4 overflow-y-auto flex-1">
                  <div className="text-center py-1">
                    <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                      <CheckCircle2 size={36} className="text-amber-600" />
                    </div>
                    <h3 className="mt-3 text-lg font-black uppercase tracking-tight text-slate-900">Fee Collected ✓</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Receipt #{qcReceipt.receiptId} • {qcReceipt.date}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
                    <div className="flex justify-between text-xs font-bold text-slate-600"><span className="uppercase tracking-widest text-slate-400">Student</span><span className="font-black text-slate-900">{qcReceipt.studentName}</span></div>
                    <div className="flex justify-between text-xs font-bold text-slate-600"><span className="uppercase tracking-widest text-slate-400">Total Collected</span><span className="font-black text-amber-700">PKR {qcReceipt.total.toLocaleString()}</span></div>
                    {qcReceipt.months && <div className="flex justify-between text-xs font-bold text-slate-600"><span className="uppercase tracking-widest text-slate-400">Months</span><span className="font-black text-slate-900 text-right">{qcReceipt.months}</span></div>}
                    {qcReceipt.collected !== '—' && <div className="flex justify-between text-xs font-bold text-slate-600"><span className="uppercase tracking-widest text-slate-400">Categories</span><span className="font-black text-slate-900 text-right">{qcReceipt.collected}</span></div>}
                    {qcReceipt.charged && <div className="flex justify-between text-xs font-bold text-slate-600"><span className="uppercase tracking-widest text-slate-400">Charged (Dues)</span><span className="font-black text-amber-600 text-right">{qcReceipt.charged}</span></div>}
                    <div className="flex justify-between text-xs font-bold text-slate-600"><span className="uppercase tracking-widest text-slate-400">Method</span><span className="font-black text-slate-900">{qcReceipt.method}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const st = students.find(s => String(s.id) === String(quickCollectStudentId));
                        if (st) handleSendFeeNotification(st, 'payment', qcReceipt.total, qcReceipt.collected);
                      }}
                      className="py-3.5 bg-amber-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-amber-700 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Send size={14} /> WhatsApp Send
                    </button>
                    <button
                      onClick={() => { setQcReceipt(null); setQuickCollectStudentId(''); setQuickCollectAmount(''); setCollectDuesList({}); setQcSearch(''); }}
                      className="py-3.5 bg-teal-600 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-teal-700 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Plus size={14} /> New Student
                    </button>
                  </div>
                  <button
                    onClick={() => { setQcReceipt(null); setShowQuickCollectModal(false); }}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              ) : (
              <>

              <div className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1">
                {/* Select Student — searchable (naam / roll #) */}
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-1">
                    Select Student *
                  </label>
                  {(() => {
                    const st = students.find(s => String(s.id) === String(quickCollectStudentId));
                    if (st) {
                      const fSt = feeStudents.find(fs => String(fs.id) === String(st.id));
                      const dCount = (fSt?.dues || []).filter(d => d.status !== 'waived' && getDueRemaining(d) > 0).length;
                      return (
                        <div className="w-full p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{st.name} <span className="text-[10px] font-bold text-slate-400">· Roll #{st.rollNumber || 'N/A'}</span></p>
                            <p className={`text-[10px] font-black uppercase tracking-wider ${dCount > 0 ? 'text-amber-600' : 'text-amber-600'}`}>{dCount > 0 ? `${dCount} dues pending` : 'No pending dues ✓'}</p>
                          </div>
                          <button
                            onClick={() => { setQuickCollectStudentId(''); setCollectDuesList({}); setQcSearch(''); setQuickCollectFeeType('School NSB Fee'); }}
                            className="px-2.5 py-1.5 bg-white border border-slate-200 text-slate-500 text-[10px] font-black uppercase rounded-lg hover:text-rose-600 hover:border-rose-300 shrink-0 cursor-pointer"
                          >
                            Change
                          </button>
                        </div>
                      );
                    }
                    const q = qcSearch.trim().toLowerCase();
                    const matches = q ? students.filter(s => String(s.name || '').toLowerCase().includes(q) || String(s.rollNumber || '').toLowerCase().includes(q)).slice(0, 8) : [];
                    return (
                      <>
                        <input
                          value={qcSearch}
                          onChange={(e) => setQcSearch(e.target.value)}
                          placeholder="Type name or roll #..."
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-600"
                        />
                        {q !== '' && (
                          <div className="mt-1.5 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-56 overflow-y-auto custom-scrollbar shadow-lg">
                            {matches.length === 0 ? (
                              <p className="p-3 text-xs font-bold text-slate-400 uppercase">No student found</p>
                            ) : matches.map(s => {
                              const fSt = feeStudents.find(fs => String(fs.id) === String(s.id));
                              const dCount = (fSt?.dues || []).filter(d => d.status !== 'waived' && getDueRemaining(d) > 0).length;
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => { setQuickCollectStudentId(s.id); if (s.baseFee) setQuickCollectAmount(String(s.baseFee)); setQuickCollectFeeType('School NSB Fee'); setQcSearch(''); }}
                                  className="w-full px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-amber-50 transition-colors cursor-pointer text-left"
                                >
                                  <span className="text-xs font-black text-slate-800 truncate">{s.name} <span className="text-[10px] font-bold text-slate-400">· Roll #{s.rollNumber || 'N/A'}</span></span>
                                  {dCount > 0 ? (
                                    <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md shrink-0">{dCount} dues</span>
                                  ) : (
                                    <span className="text-[9px] font-black uppercase bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-md shrink-0">Clear ✓</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* PENDING SUMMARY — sirf pending ho to dikhe (warna hidden) */}
                {(() => {
                  const fSt = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
                  if (!fSt) return null;
                  const duesPending = (fSt.dues || []).filter(d => d.status !== 'waived').reduce((s, d) => s + getDueRemaining(d), 0) + getTotalOtherFunds(fSt);
                  const feePending = Math.max(0, getTotalPending(fSt));
                  const grand = duesPending + feePending;
                  if (grand <= 0) return null;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      <div className={`p-3 rounded-xl border text-center ${feePending > 0 ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-100'}`}>
                        <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">School NSB Fee Pending</span>
                        <span className={`block text-sm font-black ${feePending > 0 ? 'text-rose-600' : 'text-amber-600'}`}>{feePending > 0 ? `PKR ${feePending.toLocaleString()}` : 'Clear ✓'}</span>
                      </div>
                      <div className={`p-3 rounded-xl border text-center ${duesPending > 0 ? 'bg-amber-50 border-amber-200' : 'bg-amber-50 border-amber-100'}`}>
                        <span className="block text-[9px] font-black uppercase tracking-widest text-slate-400">Dues / Funds Pending</span>
                        <span className={`block text-sm font-black ${duesPending > 0 ? 'text-amber-600' : 'text-amber-600'}`}>{duesPending > 0 ? `PKR ${duesPending.toLocaleString()}` : 'Clear ✓'}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* ===== PENDING DUES CHECKLIST — Paper Fund, Exam Fee etc. tap karke select & collect ===== */}
                {(() => {
                  const fSt = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
                  const pendingDuesList = (fSt?.dues || []).filter(d => d.status !== 'waived' && getDueRemaining(d) > 0);
                  const selIds = pendingDuesList.filter(d => collectDuesList[d.id]);
                  const selTotal = selIds.reduce((s, d) => s + getDueRemaining(d), 0);
                  const allSelected = pendingDuesList.length > 0 && selIds.length === pendingDuesList.length;
                  if (pendingDuesList.length === 0) return null; // koi pending nahi → poora section hidden
                  return (
                    <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
                          <AlertCircle size={12} /> Pending Dues — Tap to Select
                        </p>
                        {pendingDuesList.length > 0 && (
                          <button
                            onClick={() => {
                              const next: Record<string, boolean> = {};
                              if (!allSelected) pendingDuesList.forEach(d => { next[d.id] = true; });
                              setCollectDuesList(next);
                            }}
                            className="text-[9px] font-black text-amber-700 uppercase tracking-widest hover:underline cursor-pointer"
                          >
                            {allSelected ? 'Clear All' : 'Select All'}
                          </button>
                        )}
                      </div>

                      <>
                          <div className="space-y-1.5">
                            {pendingDuesList.map(d => {
                              const rem = getDueRemaining(d);
                              const pd = getDuePaid(d);
                              const isSel = !!collectDuesList[d.id];
                              return (
                                <button
                                  key={d.id}
                                  onClick={() => setCollectDuesList(prev => ({ ...prev, [d.id]: !prev[d.id] }))}
                                  className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer flex items-center gap-2.5 ${isSel ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-300' : 'bg-white border-slate-200 hover:border-amber-400'}`}
                                >
                                  <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${isSel ? 'bg-amber-600 border-amber-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                                    <CheckCircle2 size={13} />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-black text-slate-900">{d.desc}</span>
                                      <span className="text-[9px] font-bold text-slate-400 uppercase">{d.month} {d.year}</span>
                                    </span>
                                    <span className="block text-[10px] font-bold text-slate-400 mt-0.5">
                                      Total: PKR {Number(d.amount || 0).toLocaleString()}
                                      {pd > 0 && <> • Paid: <span className="text-amber-600 font-black">PKR {pd.toLocaleString()}</span></>}
                                      {' '}• Remaining: <span className="text-rose-600 font-black">PKR {rem.toLocaleString()}</span>
                                    </span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {selIds.length > 0 && (
                            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-600 text-white">
                              <span className="text-[9px] font-black uppercase tracking-widest">{selIds.length} Selected — Collect Total:</span>
                              <span className="text-xs font-black">PKR {selTotal.toLocaleString()}</span>
                            </div>
                          )}
                        </>
                      </div>
                    );
                  })()}

                      {/* Monthly School NSB Fee — REQUIRED (always visible) */}
                      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-teal-50 border border-teal-100">
                        <span className="text-[10px] font-black text-teal-700 uppercase tracking-widest flex items-center gap-1.5">
                          <CreditCard size={12} /> Monthly School NSB Fee — Required
                        </span>
                        <span className="text-[9px] font-black text-teal-400 uppercase tracking-widest">Auto-Spread ON</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {/* Fee Month — current month default, dynamic list (12 past + 6 future) */}
                  <div>
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-1">
                      Fee Month *
                    </label>
                    <select
                      value={quickCollectMonth}
                      onChange={(e) => setQuickCollectMonth(e.target.value)}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-600 uppercase"
                    >
                      {(() => {
                        const now = new Date();
                        const list: string[] = [`${MONTHS[now.getMonth()]} ${now.getFullYear()}`];
                        for (let i = 1; i <= 12; i++) {
                          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                          list.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
                        }
                        for (let i = 1; i <= 6; i++) {
                          const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                          list.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
                        }
                        return list.map(m => <option key={m} value={m}>{m}</option>);
                      })()}
                    </select>
                  </div>

                  {/* Fee Amount */}
                  <div>
                    <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-1">
                      Fee Amount * (Required)
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={quickCollectAmount}
                      onChange={(e) => setQuickCollectAmount(e.target.value)}
                      placeholder="Amount in PKR"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-base font-black text-slate-900 outline-none focus:border-amber-600"
                    />
                    {(() => {
                      const st = students.find(s => String(s.id) === String(quickCollectStudentId));
                      const base = Number(st?.baseFee || 0);
                      if (!(base > 0)) return null;
                      return (
                        <div className="flex gap-1.5 mt-1.5">
                          <button onClick={() => setQuickCollectAmount(String(base))} className="px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-black rounded-lg hover:bg-amber-100 cursor-pointer">PKR {base.toLocaleString()}</button>
                          <button onClick={() => setQuickCollectAmount(String(base * 2))} className="px-2 py-1 bg-slate-50 border border-slate-200 text-slate-600 text-[10px] font-black rounded-lg hover:bg-slate-100 cursor-pointer">PKR {(base * 2).toLocaleString()} (2 Months)</button>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Auto-Spread Preview — tuition amount kitne pending months me batt jayegi */}
                {(() => {
                  const stObj = students.find(s => String(s.id) === String(quickCollectStudentId));
                  const fsObj = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
                  const amt = Number(quickCollectAmount);
                  if (!stObj || !isTuitionFeeType(quickCollectFeeType) || !(amt > 0)) return null;
                  const yr = parseMonthKey(quickCollectMonth, new Date().getFullYear()).year;
                  const allocs = buildTuitionAllocation(fsObj, stObj, amt, yr);
                  const allocated = allocs.reduce((s, a) => s + a.amount, 0);
                  const leftover = amt - allocated;
                  return (
                    <div className="bg-amber-50/70 border border-amber-100 rounded-xl p-3 space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> Auto-Spread ON — one amount, automatically split across pending months
                      </p>
                      {allocs.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {allocs.map(a => (
                            <span key={`${a.month}-${a.year}`} className="px-2 py-0.5 bg-white border border-amber-200 text-amber-700 rounded-lg text-[10px] font-black">
                              {a.month} {a.year} · PKR {a.amount.toLocaleString()}
                            </span>
                          ))}
                          {leftover > 0 && (
                            <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[10px] font-black">
                              Advance/Extra PKR {leftover.toLocaleString()} → {quickCollectMonth}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] font-bold text-slate-600">
                          Koi pending month nahi mila — poora PKR {amt.toLocaleString()} {quickCollectMonth} me record hoga.
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div>
                  {/* Fee Category — fixed School NSB Fee */}
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-1">
                    Fee Category
                  </label>
                  <div className="w-full p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-black text-amber-700 uppercase tracking-wide flex items-center gap-2">
                    <CheckCircle2 size={14} className="shrink-0" /> School NSB Fee
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
                    School NSB Fee — auto-spread: oldest pending months are cleared first
                  </p>
                </div>

                {/* Payment Method — ek tap, dropdown nahi */}
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-1">
                    Payment Method *
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { v: 'Cash', l: '💵 Cash' },
                      { v: 'Online Transfer', l: '🏦 Bank' },
                      { v: 'JazzCash', l: '📱 JazzCash' },
                      { v: 'Cheque', l: '🧾 Cheque' },
                    ].map(m => (
                      <button
                        key={m.v}
                        onClick={() => setQuickCollectPaymentMethod(m.v)}
                        className={`py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide border transition-all cursor-pointer ${quickCollectPaymentMethod === m.v ? 'bg-amber-600 border-amber-600 text-white shadow-md' : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-amber-400'}`}
                      >
                        {m.l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Add More Fee Categories — ab class-level "Apply Dues" button se hota hai */}

                {/* RECEIPT PREVIEW — live summary (save se pehle confirm) */}
                {(() => {
                  const fSt = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
                  const duesSel = Object.entries(collectDuesList).filter(([, v]) => v);
                  const duesTotal = duesSel.reduce((s, [id]) => {
                    const d = fSt?.dues?.find(x => x.id === id);
                    return s + (d ? getDueRemaining(d) : 0);
                  }, 0);
                  const mainAmt = Number(quickCollectAmount) || 0;
                  const total = mainAmt + duesTotal;
                  if (total <= 0) return null;
                  return (
                    <div className="bg-teal-50/70 border border-teal-200 rounded-xl p-3 space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-teal-700 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> Receipt Preview — What Will Be Collected
                      </p>
                      {mainAmt > 0 && (
                        <div className="flex justify-between text-[11px] font-bold text-slate-600">
                          <span>School NSB Fee · {quickCollectMonth}</span><span className="font-black text-slate-900">PKR {mainAmt.toLocaleString()}</span>
                        </div>
                      )}
                      {duesSel.map(([id]) => {
                        const d = fSt?.dues?.find(x => x.id === id);
                        if (!d) return null;
                        return (
                          <div key={id} className="flex justify-between text-[11px] font-bold text-slate-600">
                            <span>{d.desc} · {d.month} {d.year}</span><span className="font-black text-slate-900">PKR {getDueRemaining(d).toLocaleString()}</span>
                          </div>
                        );
                      })}
                      <div className="border-t border-teal-200 pt-1.5 flex justify-between text-xs font-black">
                        <span className="uppercase tracking-widest text-teal-700">Total</span>
                        <span className="text-teal-800">PKR {total.toLocaleString()}</span>
                      </div>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{quickCollectPaymentMethod} • {new Date().toLocaleDateString()}</p>
                    </div>
                  );
                })()}

                {/* Remarks */}
                <div>
                  <label className="text-xs font-black uppercase tracking-widest text-slate-500 block mb-1">
                    Remarks / Receipt Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={quickCollectNotes}
                    onChange={(e) => setQuickCollectNotes(e.target.value)}
                    placeholder="e.g. Paid in full with discount or roll balance"
                    className="w-full p-2.5 sm:p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2.5 shrink-0 sticky bottom-0">
                {(() => {
                  const fSt = feeStudents.find(fs => String(fs.id) === String(quickCollectStudentId));
                  const duesTotal = Object.entries(collectDuesList).filter(([, v]) => v).reduce((s, [id]) => {
                    const d = fSt?.dues?.find(x => x.id === id);
                    return s + (d ? getDueRemaining(d) : 0);
                  }, 0);
                  const grand = (Number(quickCollectAmount) || 0) + duesTotal;
                  return (
                    <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-500">
                      Total: <span className="text-amber-700 text-sm">PKR {grand.toLocaleString()}</span>
                    </span>
                  );
                })()}
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => { setShowQuickCollectModal(false); setQuickCollectTargetMonth(null); setQuickCollectNotes(''); setQcReceipt(null); }} className="px-4 sm:px-5 py-3 bg-slate-200 text-slate-700 font-black text-xs uppercase tracking-widest rounded-xl hover:bg-slate-300 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRecordQuickFee}
                    className="px-5 sm:px-7 py-3.5 bg-amber-600 text-white font-black text-xs sm:text-sm uppercase tracking-widest hover:bg-amber-700 rounded-xl transition-all shadow-lg active:scale-95 flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 size={18} /> Collect & Receipt
                  </button>
                </div>
              </div>
              </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Collect Dues Modal — Paper Fund & Other Dues Collection */}
      <AnimatePresence>
        {collectDuesModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="bg-amber-600 p-5 sm:p-6 text-white flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center">
                    <CheckCircle2 size={22} />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-black uppercase tracking-tight">Collect Due Payment</h2>
                    <p className="text-[10px] uppercase font-bold text-amber-100">
                      {students.find(s => String(s.id) === String(collectDuesModal.studentId))?.name || 'Student'} • {collectDuesModal.desc}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => { setCollectDuesModal({ isOpen: false, studentId: '', dueId: '', desc: '', amount: 0, remaining: 0, month: '', year: 2026 }); setCollectDuesAmount(''); }}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 sm:p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-amber-600 uppercase tracking-widest">Due Total</span>
                    <span className="text-2xl font-black text-amber-700">PKR {collectDuesModal.amount.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-xs font-bold text-amber-500">
                    {collectDuesModal.desc} • {collectDuesModal.month} {collectDuesModal.year}
                  </div>
                  {collectDuesModal.amount - collectDuesModal.remaining > 0 && (
                    <div className="mt-2 text-xs font-black text-amber-600">
                      Already Paid: PKR {(collectDuesModal.amount - collectDuesModal.remaining).toLocaleString()} • Remaining: <span className="text-rose-600">PKR {collectDuesModal.remaining.toLocaleString()}</span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Collecting Amount (PKR) *</label>
                  <input
                    type="number"
                    value={collectDuesAmount}
                    onChange={(e) => setCollectDuesAmount(e.target.value)}
                    placeholder={`Max ${collectDuesModal.remaining.toLocaleString()}`}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => setCollectDuesAmount(String(collectDuesModal.remaining))}
                    className="mt-1 text-[10px] font-black text-amber-600 uppercase tracking-widest hover:underline cursor-pointer"
                  >
                    Collect Full Remaining (PKR {collectDuesModal.remaining.toLocaleString()})
                  </button>
                </div>

                <div>
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Payment Method</label>
                  <select
                    value={collectDuesPaymentMethod}
                    onChange={(e) => setCollectDuesPaymentMethod(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500 appearance-none cursor-pointer"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Online">Online</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Paid Date</label>
                  <input
                    type="date"
                    value={new Date().toISOString().split('T')[0]}
                    onChange={() => {}}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex flex-col gap-3 pt-2">
                  <button
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0];
                      const toCollect = Math.min(Number(collectDuesAmount) || 0, collectDuesModal.remaining);
                      if (!(toCollect > 0)) {
                        toast.error("Enter a valid amount to collect.");
                        return;
                      }
                      // Create fee record for this collection
                      const recId = 'REC_' + Date.now().toString(36).toUpperCase() + '_' + Math.random().toString(36).substr(2, 6).toUpperCase();
                      setFees(p => [...p, {
                        id: recId,
                        studentId: collectDuesModal.studentId,
                        amount: toCollect,
                        dueDate: today,
                        status: 'paid',
                        paidDate: today,
                        month: collectDuesModal.month,
                        paymentMethod: collectDuesPaymentMethod,
                        feeType: collectDuesModal.desc,
                        dueId: collectDuesModal.dueId,
                        description: `Collected: ${collectDuesModal.desc}`,
                      }]);
                      setFeeStudents(prev => collectDue(prev, collectDuesModal.studentId, collectDuesModal.dueId, toCollect, collectDuesPaymentMethod, today));
                      const st = students.find(s => String(s.id) === String(collectDuesModal.studentId));
                      if (st) {
                        handleSendFeeNotification(st, 'payment', toCollect, collectDuesModal.desc);
                      }
                      const fullyPaidNow = (collectDuesModal.remaining - toCollect) <= 0;
                      setCollectDuesModal({ isOpen: false, studentId: '', dueId: '', desc: '', amount: 0, remaining: 0, month: '', year: 2026 });
                      setCollectDuesAmount('');
                      toast.success(`Collected PKR ${toCollect.toLocaleString()} of "${collectDuesModal.desc}" from ${st?.name || 'student'} — ${fullyPaidNow ? 'DUE FULLY PAID ✓' : (collectDuesModal.remaining - toCollect).toLocaleString() + ' pending'}`);
                    }}
                    className="w-full py-4 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex justify-center items-center gap-2"
                  >
                    <CheckCircle2 size={16} /> Collect & Mark Paid
                  </button>
                  <button
                    onClick={() => { setCollectDuesModal({ isOpen: false, studentId: '', dueId: '', desc: '', amount: 0, remaining: 0, month: '', year: 2026 }); setCollectDuesAmount(''); }}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FEE PAYMENT CENTER — complete month-wise fee + dues payment modal */}
      <FeePaymentCenter
        open={showFeePaymentCenter}
        onClose={() => setShowFeePaymentCenter(false)}
        feeStudents={feeStudents}
        students={students}
        initialStudentId={feePaymentCenterStudentId}
        onPayMonth={handleFpcPayMonth}
        onCollectDue={handleFpcCollectDue}
        onPayAutoSpread={handleFpcPayAutoSpread}
      />

      {/* APPLY DUES TO CLASS — poori class / selected students ko due lagao ya collect karo */}
      <AnimatePresence>
        {showClassDuesModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-4 sm:p-5 text-white flex justify-between items-center gap-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0"><Users size={22} /></div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-black uppercase tracking-tight">Apply Dues / Paper Fund</h2>
                    <p className="text-[10px] uppercase font-bold text-amber-100 truncate">Class ya selected students • Charge ya Collect</p>
                  </div>
                </div>
                <button onClick={() => setShowClassDuesModal(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors shrink-0"><X size={20} /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {/* Scope + mode */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Class</label>
                    <select value={classDuesClassId} onChange={(e) => { setClassDuesClassId(e.target.value); setClassDuesSelected({}); }} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-800 cursor-pointer">
                      <option value="all">All Classes ({students.length} students)</option>
                      {classes.map(c => <option key={c.id} value={c.id}>{c.className} - {c.section} ({students.filter(s => s.classId === c.id).length})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Mode</label>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                      <button onClick={() => setClassDuesMode('charge')} className={`py-2 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${classDuesMode === 'charge' ? 'bg-amber-500 text-white shadow' : 'text-slate-500 hover:text-slate-700'}`}>Charge Only</button>
                      <button onClick={() => setClassDuesMode('collect')} className={`py-2 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all cursor-pointer ${classDuesMode === 'collect' ? 'bg-amber-600 text-white shadow' : 'text-slate-500 hover:text-slate-700'}`}>Charge & Collect</button>
                    </div>
                  </div>
                </div>

                {/* Desc + amount + month */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Due Type</label>
                    <select value={classDuesDesc} onChange={(e) => setClassDuesDesc(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-800 cursor-pointer">
                      {['Paper Fund', 'Exam Fee', 'Annual Fee', 'Admission Fee', 'Summer Pack', 'Miscellaneous'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Amount (PKR)</label>
                    <input type="number" min="0" value={classDuesAmount} onChange={(e) => setClassDuesAmount(e.target.value)} placeholder="0" className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black focus:outline-none focus:border-amber-500" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Month</label>
                    <select value={classDuesMonth} onChange={(e) => setClassDuesMonth(e.target.value)} className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-800 cursor-pointer">
                      {MONTHS.map(m => <option key={m} value={m}>{m} {classDuesYear}</option>)}
                    </select>
                  </div>
                </div>

                {/* Student checklist */}
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      Students ({classStudentsForDues.length}) — kisi ek, kuch ya sab ko select karein
                    </span>
                    <div className="flex gap-1.5">
                      <button onClick={() => setClassDuesSelected(Object.fromEntries(classStudentsForDues.map(s => [String(s.id), true])))} className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-amber-100 cursor-pointer">Select All</button>
                      <button onClick={() => setClassDuesSelected({})} className="px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-500 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-100 cursor-pointer">Clear All</button>
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                    {classStudentsForDues.map(s => {
                      const sel = !!classDuesSelected[String(s.id)];
                      const fsObj = feeStudents.find(f => String(f.id) === String(s.id));
                      const pend = fsObj ? (fsObj.dues || []).filter(d => d.status !== 'waived').reduce((sum, d) => sum + getDueRemaining(d), 0) + getTotalPending(fsObj) : 0;
                      return (
                        <button
                          key={String(s.id)}
                          onClick={() => setClassDuesSelected(prev => ({ ...prev, [String(s.id)]: !prev[String(s.id)] }))}
                          className={`w-full text-left px-3 py-2 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer ${sel ? 'bg-amber-50 border-amber-400' : 'bg-white border-slate-200 hover:border-slate-300'}`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${sel ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                              {sel && <CheckCircle2 size={11} className="text-white" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-black text-slate-900 truncate">{s.name}</span>
                              <span className="block text-[9px] font-bold text-slate-400 uppercase">{getClassName(String(s.classId))}</span>
                            </span>
                          </span>
                          <span className={`text-[9px] font-black uppercase tracking-widest shrink-0 ${pend > 0 ? 'text-rose-500' : 'text-amber-500'}`}>
                            {pend > 0 ? `Pending: ${pend.toLocaleString()}` : 'Clear ✓'}
                          </span>
                        </button>
                      );
                    })}
                    {classStudentsForDues.length === 0 && (
                      <p className="text-center text-xs font-bold text-slate-400 py-6">Is class mein koi student nahi.</p>
                    )}
                  </div>
                </div>

                {/* Collect mode extras */}
                {classDuesMode === 'collect' && (
                  <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-100 space-y-2">
                    <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest flex items-center gap-1.5"><Banknote size={12} /> Foran Wasooli (Collect)</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="number" min="0" max={Number(classDuesAmount) || undefined}
                        value={classDuesCollectAmount}
                        onChange={(e) => setClassDuesCollectAmount(e.target.value)}
                        placeholder={`Collect amount (default: full PKR ${Number(classDuesAmount || 0).toLocaleString()})`}
                        className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black focus:outline-none focus:border-amber-500"
                      />
                      <select value={classDuesPaymentMethod} onChange={(e) => setClassDuesPaymentMethod(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 cursor-pointer">
                        {['Cash', 'Bank Transfer', 'JazzCash', 'EasyPaisa', 'Online', 'Cheque'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <p className="text-[9px] font-bold text-slate-500">
                      {Number(classDuesCollectAmount) > 0 && Number(classDuesCollectAmount) < Number(classDuesAmount)
                        ? `✓ Har student se PKR ${Number(classDuesCollectAmount).toLocaleString()} collect hoga — baqi PKR ${(Math.max(0, (Number(classDuesAmount) || 0) - Number(classDuesCollectAmount))).toLocaleString()} Dues mein remaining rahega.`
                        : '✓ Full amount collect hoga. Kam amount likhein to baqi remaining Dues mein reh jayega.'}
                    </p>
                  </div>
                )}
                </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">
                    {Object.values(classDuesSelected).filter(Boolean).length} selected • PKR {Number(classDuesAmount || 0).toLocaleString()} / student
                  </span>
                  <span className="block text-[9px] font-bold text-slate-400">
                    {classDuesMode === 'charge' ? 'Charge Only — Dues mein pending jayega' : 'Charge & Collect — foran wasooli, baqi remaining'}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setShowClassDuesModal(false)} className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-600 text-[10px] font-black uppercase tracking-widest rounded-xl cursor-pointer">Cancel</button>
                  <button onClick={handleSubmitClassDues} className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-[10px] font-black uppercase tracking-widest rounded-xl flex items-center gap-1.5 cursor-pointer">
                    <CheckCircle2 size={14} /> {classDuesMode === 'charge' ? 'Charge Dues' : 'Charge & Collect'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* Fee Record Action Modal (Hold / Long-press) */}
      <AnimatePresence>
        {feeActionModal.isOpen && feeActionModal.fee && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200 max-h-[92vh] flex flex-col"
            >
              <div className="bg-teal-600 p-5 sm:p-6 text-white flex justify-between items-center shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Receipt size={22} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base sm:text-lg font-black uppercase tracking-tight truncate">Fee Record Actions</h2>
                    <p className="text-[10px] uppercase font-bold text-teal-100 truncate">
                      {feeEditForm.studentName} • #{String(feeActionModal.fee.id).slice(-6)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setFeeActionModal({ isOpen: false, fee: null })}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors cursor-pointer shrink-0"
                  aria-label="Close fee actions"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 sm:p-6 flex-1 overflow-y-auto space-y-4">
                {!showFeeEditForm ? (
                  <>
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                        <span>Category</span>
                        <span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded-md border border-teal-100 uppercase font-black">{feeActionModal.fee.feeType || 'School Fee'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                        <span>Amount</span>
                        <span className="text-slate-900 font-black">PKR {Number(feeActionModal.fee.amount).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                        <span>Month</span>
                        <span className="text-slate-900 font-black">{feeActionModal.fee.month || 'N/A'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                        <span>Paid On</span>
                        <span className="text-slate-900 font-black">{feeActionModal.fee.paidDate || 'N/A'}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase">
                        <span>Method</span>
                        <span className="text-slate-900 font-black">{feeActionModal.fee.paymentMethod || 'Cash'}</span>
                      </div>
                      {feeActionModal.fee.description && (
                        <div className="pt-1 text-[11px] font-bold text-slate-500 uppercase">
                          <span className="block mb-1">Notes</span>
                          <span className="text-slate-700 normal-case font-medium">{feeActionModal.fee.description}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => setShowFeeEditForm(true)}
                        className="w-full py-4 bg-teal-600 hover:bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                      >
                        <Edit2 size={16} /> Edit Record
                      </button>
                      <button
                        onClick={() => deleteFeeRecord(feeActionModal.fee!)}
                        className="w-full py-4 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                      >
                        <Trash2 size={16} /> Delete Record
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Fee Category *</label>
                        <select
                          value={feeEditForm.feeType}
                          onChange={(e) => setFeeEditForm({ ...feeEditForm, feeType: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500 appearance-none cursor-pointer"
                        >
                          <option value="School Fee">School Fee</option>
                          <option value="Tuition Fee">Tuition Fee</option>
                          {!['School Fee', 'Tuition Fee'].includes(feeEditForm.feeType) && (
                            <option value={feeEditForm.feeType}>{feeEditForm.feeType} (purana record)</option>
                          )}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Month</label>
                          <input
                            type="text"
                            value={feeEditForm.month}
                            onChange={(e) => setFeeEditForm({ ...feeEditForm, month: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Paid On</label>
                          <input
                            type="date"
                            value={feeEditForm.paidDate}
                            onChange={(e) => setFeeEditForm({ ...feeEditForm, paidDate: e.target.value })}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Amount (PKR) *</label>
                        <input
                          type="number"
                          value={feeEditForm.amount}
                          onChange={(e) => setFeeEditForm({ ...feeEditForm, amount: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xl font-black text-slate-900 focus:outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Payment Method</label>
                        <input
                          type="text"
                          value={feeEditForm.paymentMethod}
                          onChange={(e) => setFeeEditForm({ ...feeEditForm, paymentMethod: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Notes</label>
                        <textarea
                          rows={2}
                          value={feeEditForm.description}
                          onChange={(e) => setFeeEditForm({ ...feeEditForm, description: e.target.value })}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-teal-500 resize-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 pt-1">
                      <button
                        onClick={saveFeeRecordEdit}
                        className="w-full py-4 bg-teal-600 hover:bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-all shadow-md active:scale-95 flex justify-center items-center gap-2 cursor-pointer"
                      >
                        <Save size={16} /> Save Changes
                      </button>
                      <button
                        onClick={() => setShowFeeEditForm(false)}
                        className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-widest rounded-xl transition-all flex justify-center items-center cursor-pointer"
                      >
                        Back
                      </button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

function FeeReceiptCard({ fee, student, onAction, onDelete }: {
  fee: FeeRecord;
  student: Student;
  onAction: () => void;
  onDelete: () => void;
}) {
  const lp = useLongPress(onAction);
  return (
    <div
      {...lp}
      onClick={onAction}
      className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-3 group/receipt hover:border-amber-200 transition-colors select-none cursor-pointer touch-manipulation active:scale-[0.99]"
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="px-2 py-1 bg-white border border-slate-200 text-[10px] font-black text-slate-400 rounded-lg font-mono truncate">#{String(fee.id).slice(-6)}</span>
        <span className="text-xs font-black text-amber-700 whitespace-nowrap">PKR {Number(fee.amount).toLocaleString()}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
          <span>Student</span>
          <span className="text-slate-900 truncate ml-2">{student.name}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
          <span>Category</span>
          <span className="px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded-md border border-teal-100 uppercase">{fee.feeType || 'School Fee'}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
          <span>Paid On</span>
          <span className="text-slate-900">{fee.paidDate || 'N/A'}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
          <span>Method</span>
          <span className="text-slate-900">{fee.paymentMethod || 'Cash'}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60 mt-1" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          className="flex-1 py-1.5 bg-white border border-slate-200 text-amber-600 text-[10px] font-black uppercase tracking-wider rounded-lg flex items-center justify-center gap-1.5 hover:bg-amber-50 transition-colors cursor-pointer"
          title="Edit / Delete (hold or tap)"
        >
          <Edit2 size={12} /> Edit
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="w-8 h-8 bg-white border border-slate-200 text-rose-400 rounded-lg flex items-center justify-center hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
          title="Delete receipt"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

// ================= MONTH-WISE FEE BREAKDOWN =================
// Each month card: Base Fee vs Paid vs Remaining (in RED).
// Dues (unpaid extra charges like Paper Fund) also show in same month card.
// Student only sees months from their enrollment month onward.
// Mixed month formats ('Jun', 'Jun 2026', 'June 2026') handled via robust matching.
function FeeMonthGrid({ feeStudent, student, feeRecords = [], year, selectedMonth, onSelectMonth, onCollect, onDeleteMonth, onYearChange, onPayDues }: {
  feeStudent?: StudentFeeData;
  student: Student;
  feeRecords?: FeeRecord[];
  year: number;
  selectedMonth?: string | null;
  onSelectMonth?: (month: string | null) => void;
  onCollect: (month: string, remaining: number) => void;
  onDeleteMonth: (month: string, year: number) => void;
  onYearChange?: (year: number) => void;
  onPayDues?: () => void;
}) {
  const base = Math.max(0, Number(student.baseFee ?? feeStudent?.monthlyFee ?? 0));
  // Months: current (enrollment) year me enrollment month se start;
  // YEAR CHANGE karo to months dobara JANUARY se start hote hain (full year)
  const enrollAlias = String(student.enrollmentMonth || '').trim().toLowerCase();
  const enrollIdx = Object.prototype.hasOwnProperty.call(MONTH_ALIAS, enrollAlias) ? MONTH_ALIAS[enrollAlias] : -1;
  const nowYear = new Date().getFullYear();
  const startIdx = Number(year) === nowYear && enrollIdx >= 0 ? enrollIdx : 0;
  const displayMonths = MONTHS.slice(startIdx);

  // Pehle har month ki stats compute karo (summary + cards dono isi se bante hain)
  const monthStats = displayMonths.map((m) => {
    const mi = MONTHS.indexOf(m);
    const monthPayments = (feeStudent?.payments || []).filter(p => {
      const key = parseMonthKey(p.month, Number(p.year) || year);
      return key.idx === mi && key.year === Number(year);
    });
    // Dues entries isi month/year ki — "Add Due" ya "Add More Fee Categories" se bane
    const monthDues = (feeStudent?.dues || []).filter(d => {
      const key = parseMonthKey(d.month, d.year || year);
      return key.idx === mi && key.year === Number(year);
    });
    const paymentIds = new Set(monthPayments.filter(p => p.id).map(p => p.id));
    const tuitionPaid = monthPayments
      .filter(p => !p.feeType || TUITION_FEE_TYPES.test(p.feeType))
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // PAYMENTS (non-tuition) — asli fee-type name ke saath
    const extraByType = new Map<string, number>();
    monthPayments
      .filter(p => p.feeType && !TUITION_FEE_TYPES.test(p.feeType))
      .forEach(p => {
        const t = p.feeType!;
        extraByType.set(t, (extraByType.get(t) || 0) + (Number(p.amount) || 0));
      });
    // DUES PAID portion (full ya partial) jo payments mein nahi dikhe (e.g. "Mark as Paid").
    // Payment record use id se double-count guard: agar payment already count ho chuki hai to skip.
    monthDues
      .filter(d => d.status !== 'waived' && d.desc && !paymentIds.has(String(d.id)) && getDuePaid(d) > 0)
      .forEach(d => {
        const t = d.desc!;
        extraByType.set(t, (extraByType.get(t) || 0) + getDuePaid(d));
      });
    const extraPaid = Array.from(extraByType.values()).reduce((s, v) => s + v, 0);
    const totalPaid = tuitionPaid + extraPaid;
    // Fee ledger — unpaid extra charges (DUES) type-name ke saath
    const pendingByType = new Map<string, number>();
    feeRecords.filter(f => {
      if (f.status === 'paid' || !f.feeType || TUITION_FEE_TYPES.test(f.feeType)) return false;
      const key = parseMonthKey(f.month, Number(String(f.dueDate || '').split('-')[0]) || year);
      return key.idx === mi && key.year === Number(year);
    }).forEach(f => {
      const t = f.feeType!;
      pendingByType.set(t, (pendingByType.get(t) || 0) + (Number(f.amount) || 0));
    });
    // PENDING dues (full ya partial remaining) — "Add Due" ya partial-collection baad baqi
    monthDues
      .filter(d => d.status !== 'waived' && d.desc && getDueRemaining(d) > 0)
      .forEach(d => {
        const t = d.desc!;
        pendingByType.set(t, (pendingByType.get(t) || 0) + getDueRemaining(d));
      });
    const extraPending = Array.from(pendingByType.values()).reduce((s, v) => s + v, 0);
    const tuitionRemaining = Math.max(0, base - tuitionPaid);
    const totalRemaining = tuitionRemaining + extraPending;
    const hasData = totalPaid > 0 || extraPending > 0 || base > 0;
    const isClear = hasData && totalRemaining === 0;
    return { m, tuitionPaid, extraByType, extraPaid, totalPaid, pendingByType, extraPending, tuitionRemaining, totalRemaining, hasData, isClear };
  });

  // Summary — all months combined position
  const totals = monthStats.reduce((acc, s) => ({
    paid: acc.paid + s.totalPaid,
    tuitionRemaining: acc.tuitionRemaining + s.tuitionRemaining,
    dues: acc.dues + s.extraPending,
  }), { paid: 0, tuitionRemaining: 0, dues: 0 });
  const totalRemainingAll = totals.tuitionRemaining + totals.dues;
  const totalBaseAll = base * monthStats.length;

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onYearChange?.(Number(year) - 1)}
            title="Previous year"
            className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-md text-xs font-black text-slate-500 hover:border-teal-400 hover:text-teal-500 transition-colors cursor-pointer"
          >‹</button>
          <span className="text-xs font-black text-teal-600 uppercase">{year}</span>
          <button
            onClick={() => onYearChange?.(Number(year) + 1)}
            title="Next year"
            className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-md text-xs font-black text-slate-500 hover:border-teal-400 hover:text-teal-500 transition-colors cursor-pointer"
          >›</button>
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Month-wise Fee Breakdown{Number(year) === nowYear && enrollIdx >= 0 ? ` · From ${MONTHS[enrollIdx]}` : ' · Full Year'}
          </h4>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase">Base Fee: PKR {base.toLocaleString()} / month</span>
      </div>

      {/* SUMMARY — month cards se upar: Base, Paid, Remaining (all months combined), Dues */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
        <div className="p-2.5 rounded-xl bg-teal-50/70 border border-teal-100">
          <span className="block text-[9px] font-black text-teal-400 uppercase tracking-widest">Base Fee ({monthStats.length} months)</span>
          <span className="block text-sm font-black text-teal-700">PKR {totalBaseAll.toLocaleString()}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-100">
          <span className="block text-[9px] font-black text-amber-500 uppercase tracking-widest">Total Paid</span>
          <span className="block text-sm font-black text-amber-700">PKR {totals.paid.toLocaleString()}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-100">
          <span className="block text-[9px] font-black text-rose-400 uppercase tracking-widest">Remaining (All Months)</span>
          <span className="block text-sm font-black text-rose-600">{totalRemainingAll > 0 ? `PKR ${totalRemainingAll.toLocaleString()}` : 'Clear ✓'}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onPayDues?.(); }}
          title={totals.dues > 0 ? 'Click — pay dues / paper fund' : 'No dues pending'}
          className={`p-2.5 rounded-xl bg-amber-50/70 border border-amber-100 text-left ${totals.dues > 0 ? 'hover:border-amber-400 hover:shadow-md cursor-pointer transition-all' : 'cursor-default'}`}
        >
          <span className="block text-[9px] font-black text-amber-500 uppercase tracking-widest">Dues / Paper Fund {totals.dues > 0 ? '• Pay →' : ''}</span>
          <span className="block text-sm font-black text-amber-700">{totals.dues > 0 ? `PKR ${totals.dues.toLocaleString()}` : 'Clear ✓'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {monthStats.map((s) => {
          const { m, totalPaid, extraByType, pendingByType, extraPending, totalRemaining, isClear } = s;
          const isSelected = selectedMonth === m;
          return (
            <HoldActionWrapper
              onDetail={() => onSelectMonth?.(isSelected ? null : m)}
              onEdit={() => onCollect(m, totalRemaining)}
              onDelete={() => onDeleteMonth(m, year)}
              className="rounded-xl"
            >
            <div
              onClick={() => onSelectMonth?.(isSelected ? null : m)}
              title={`Click to ${isSelected ? 'hide' : 'view'} ${m} ${year} history`}
              className={`p-2.5 rounded-xl border space-y-1.5 cursor-pointer transition-all select-none active:scale-[0.98] ${isClear ? 'bg-amber-50/60 border-amber-100' : totalPaid > 0 ? 'bg-amber-50/60 border-amber-100' : 'bg-slate-50 border-slate-100'} ${isSelected ? 'ring-2 ring-teal-400 border-teal-300 shadow-md' : 'hover:border-slate-300'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-700 uppercase">{m}</span>
                <span className="flex items-center gap-1">
                  {isClear && <CheckCircle2 size={11} className="text-amber-600" />}
                  <ChevronDown size={11} className={`text-slate-300 transition-transform ${isSelected ? 'rotate-180 text-teal-400' : ''}`} />
                </span>
              </div>
              <div className="text-[9px] font-bold text-slate-400 uppercase leading-tight">
                <span className="block">Paid: {totalPaid > 0 ? <span className="text-amber-700 font-black">PKR {totalPaid.toLocaleString()}</span> : <span className="text-slate-400">PKR 0</span>}</span>
                {totalRemaining > 0 ? (
                  <span className="block">Remaining: <span className="text-rose-600 font-black">PKR {totalRemaining.toLocaleString()}</span></span>
                ) : (
                  <span className="block font-black text-amber-600">Clear</span>
                )}
                {/* Dues — ASLI fee-type name ke saath (e.g. Paper Fund, Exam Fee) */}
                {Array.from(pendingByType.entries()).map(([t, amt]) => (
                  <span key={`d-${t}`} className="block text-amber-600 font-black">{t} (Pending): PKR {amt.toLocaleString()}</span>
                ))}
                {/* Extra payments — ASLI fee-type name ke saath, generic 'Extra' nahi */}
                {Array.from(extraByType.entries()).map(([t, amt]) => (
                  <span key={`x-${t}`} className="block text-slate-500">{t}: PKR {amt.toLocaleString()}</span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => onCollect(m, totalRemaining)}
                  className="flex-1 py-1 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-[9px] font-black uppercase tracking-wide rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer"
                  title={`Collect fee for ${m} ${year}`}
                >
                  <Plus size={9} /> Collect
                </button>
                {(totalPaid > 0 || extraPending > 0) && (
                  <button
                    onClick={() => onDeleteMonth(m, year)}
                    className="w-6 h-6 bg-white border border-rose-200 text-rose-500 rounded-lg flex items-center justify-center hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                    title={`Delete all ${m} ${year} payments & dues`}
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
            </div>
            </HoldActionWrapper>
          );
        })}
      </div>
    </div>
  );
}
