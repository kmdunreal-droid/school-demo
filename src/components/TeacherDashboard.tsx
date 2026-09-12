import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { 
  Users, Calendar, Award, CheckSquare, LogOut, Save, UserCheck, UserX, User,
  Clock, AlertCircle, Sparkles, BookOpen, Menu, X, ArrowLeft, ClipboardList, Info, CreditCard,
  Bell, CheckCircle2, ListTodo, CalendarDays, ArrowRight, Search, PlusCircle, AlertTriangle, ChevronDown, Sun, Moon, Phone, Trash2, Plus, Send, Download, Fingerprint, School, RefreshCw, Printer,
  Wallet, Banknote, MapPin, Navigation, Receipt, LocateFixed, Coins, CalendarClock, Megaphone
} from 'lucide-react';
import QuizModule from './QuizModule';
import AiPaperGenerator from './AiPaperGenerator';
import AiSettingsSection from './AiSettingsSection';
import { getAttendanceSettings } from '../lib/attendanceSettings';
import NoticeBoard from './NoticeBoard';
import EventsCalendar from './EventsCalendar';
import { getNotifications, addNotification, saveNotifications, PortalNotification } from '../lib/notificationUtils';
import { getPeriodStatus, getStatusColor } from '../lib/periodUtils';
import { Teacher, Student, Class, TimetableEntry, Attendance, Mark, ExamType, UserSession, FeeRecord, DayOfWeek, Assignment, TeacherAttendance, TeacherPayConfig, TeacherPayslip, SchoolLocation, PeriodAttendance, getStudentPhoto } from '../types';
import { subscribeRecords, loadCollectionFromSupabase, sbQueueWrite, sbQueueDelete, flushSupabase } from '../lib/supabaseSync';
import { DEFAULT_SCHOOL_LOCATION, getCurrentPosition, haversineMeters, isWithinSchoolRadius, formatDistance } from '../lib/geoUtils';
import { defaultPayConfig, summarizeTeacherMonth, buildPayslip, monthKeyOf, monthLabel, formatPKR } from '../lib/payEngine';
import { INITIAL_TEACHER_PAY_CONFIGS, INITIAL_SCHOOL_LOCATION } from '../initialData';
import { listChanged } from '../lib/dataUtils';
import { HoldActionWrapper } from './HoldActionWrapper';

interface TeacherDashboardProps {
  userSession: UserSession;
  teachers: Teacher[];
  setTeachers: React.Dispatch<React.SetStateAction<Teacher[]>>;
  students: Student[];
  setStudents: React.Dispatch<React.SetStateAction<Student[]>>;
  classes: Class[];
  setClasses: React.Dispatch<React.SetStateAction<Class[]>>;
  timetable: TimetableEntry[];
  setTimetable: React.Dispatch<React.SetStateAction<TimetableEntry[]>>;
  attendance: Attendance[];
  setAttendance: React.Dispatch<React.SetStateAction<Attendance[]>>;
  periodAttendance: PeriodAttendance[];
  setPeriodAttendance: React.Dispatch<React.SetStateAction<PeriodAttendance[]>>;
  marks: Mark[];
  setMarks: React.Dispatch<React.SetStateAction<Mark[]>>;
  fees: FeeRecord[];
  setFees: React.Dispatch<React.SetStateAction<FeeRecord[]>>;
  assignments: Assignment[];
  setAssignments: React.Dispatch<React.SetStateAction<Assignment[]>>;
  onLogout: () => void;
  installPromptEvent: any;
  onInstallApp: () => void;
}

type TabType = 'dashboard' | 'students' | 'attendance' | 'marks' | 'timetable' | 'fees' | 'settings' | 'diary' | 'my-attendance' | 'my-pay' | 'quiz' | 'ai_paper' | 'notices' | 'calendar';

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

export default function TeacherDashboard({
  userSession,
  teachers,
  setTeachers,
  students,
  setStudents,
  classes,
  setClasses,
  timetable,
  setTimetable,
  attendance,
  setAttendance,
  periodAttendance,
  setPeriodAttendance,
  marks,
  setMarks,
  fees,
  setFees,
  assignments,
  setAssignments,
  onLogout,
  installPromptEvent,
  onInstallApp
}: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // Browser Back Button Support for Tabs
  useEffect(() => {
    // Sync initial state
    window.history.replaceState({ tab: activeTab }, '', '');

    const handlePopState = (event: PopStateEvent) => {
      if (event.state && event.state.tab) {
        setActiveTab(event.state.tab);
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

  // Latest-state refs so realtime callbacks never read stale closures
  const classesRef = useRef(classes);
  const teachersRef = useRef(teachers);
  const studentsRef = useRef(students);
  const timetableRef = useRef(timetable);
  const attendanceRef = useRef(attendance);
  useEffect(() => { classesRef.current = classes; }, [classes]);
  useEffect(() => { teachersRef.current = teachers; }, [teachers]);
  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { timetableRef.current = timetable; }, [timetable]);
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);

  // Real-time Supabase listener — WebSocket push; doosri devices ki changes turant apply
  useEffect(() => {
    const applyReload = async () => {
      try {
        const [classesData, teachersData, studentsData, timetableData, attendanceData] = await Promise.all([
          loadCollectionFromSupabase('classes'),
          loadCollectionFromSupabase('teachers'),
          loadCollectionFromSupabase('students'),
          loadCollectionFromSupabase('timetable'),
          loadCollectionFromSupabase('attendance'),
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
          changed = true;
        }
        if (studentsData && listChanged(studentsRef.current, studentsData)) {
          studentsRef.current = studentsData;
          setStudents(studentsData);
          changed = true;
        }
        if (timetableData && listChanged(timetableRef.current, timetableData)) {
          timetableRef.current = timetableData;
          setTimetable(timetableData);
          toast.info('Timetable updated from Principal portal');
          changed = true;
        }
        if (attendanceData && listChanged(attendanceRef.current, attendanceData)) {
          attendanceRef.current = attendanceData;
          setAttendance(attendanceData);
          changed = true;
        }
        if (changed) console.log('[Sync:RT] TeacherDashboard reloaded from Supabase');
      } catch (e: any) {
        console.warn('[Sync:RT] TeacherDashboard reload failed:', e?.message);
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
  
  const [timetableSubTab, setTimetableSubTab] = useState<'my' | 'class'>('my');
  const [timetableClassId, setTimetableClassId] = useState<string>('');
  const [scheduleDay, setScheduleDay] = useState<string>(() => {
    const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    return ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(dayName) ? dayName : 'Monday';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const [showAddFeeModal, setShowAddFeeModal] = useState(false);
  const [newFeeStudentId, setNewFeeStudentId] = useState('');
  const [newFeeAmount, setNewFeeAmount] = useState('');
  const [newFeeType, setNewFeeType] = useState('School NSB Fee');
  const [newFeeMonth, setNewFeeMonth] = useState('June 2026');
  const [amountCollected, setAmountCollected] = useState('');

  // SATH HI parent notification popup alert states for teacher
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

  // Identify teacher's profile
  const teacherProfile = teachers.find(t => t.id === userSession.id);
  const teacherId = teacherProfile?.id || '';
  const teacherSubject = teacherProfile?.subject || 'All Subjects';

  // Find all classes where this teacher is either the class teacher or teaches a subject
  const myClasses = classes.filter(c => 
    c.classTeacherId === teacherId || 
    timetable.some(tt => tt.teacherId === teacherId && tt.classId === c.id)
  );
  
  const classId = myClasses.find(c => c.classTeacherId === teacherId)?.id || myClasses[0]?.id || '';

  // Fallback class view strictly limited to teacher's classes
  const [activeClassId, setActiveClassId] = useState<string>(classId);
  
  useEffect(() => {
    if (classId && !timetableClassId) {
      setTimetableClassId(classId);
    }
  }, [classId]);
  
  const myClassIds = myClasses.map(c => c.id);
  const filteredClassStudents = students.filter(s => (myClassIds.length > 0 && myClassIds.includes(s.classId)) && (activeClassId === 'all' || !activeClassId || s.id === 'all' || s.classId === activeClassId));
  const viewClassStudents = filteredClassStudents;

  const handleAddCashFee = () => {
    if (!newFeeStudentId || !newFeeAmount) {
      alert('Please select a student and enter amount.');
      return;
    }
    const student = students.find(s => s.id === newFeeStudentId);
    if (!student) return;

    const billTotal = Number(newFeeAmount);
    const collected = Number(amountCollected) || billTotal;

    const updatedFees = fees.filter(f => !(f.studentId === newFeeStudentId && f.status === 'unpaid'));

    if (collected > 0 && collected < billTotal) {
      // Record partial
      const paidRecord: FeeRecord = {
        id: `fee_p_t_${Date.now()}`,
        studentId: newFeeStudentId,
        amount: collected,
        dueDate: new Date().toISOString().split('T')[0],
        status: 'paid',
        paidDate: new Date().toISOString().split('T')[0],
        month: newFeeMonth,
        feeType: newFeeType,
        paymentMethod: 'Cash Partial (Faculty)',
        description: `Partial collection recorded by faculty (${collected} of ${billTotal})`
      };

      const remainingRecord: FeeRecord = {
        id: `fee_a_t_${Date.now()}`,
        studentId: newFeeStudentId,
        amount: billTotal - collected,
        dueDate: new Date().toISOString().split('T')[0],
        status: 'unpaid',
        month: newFeeMonth,
        feeType: 'Remaining Balance',
        description: `Remaining from faculty collection (${newFeeType})`
      };

      setFees([paidRecord, remainingRecord, ...updatedFees]);
    } else {
      const newFee: FeeRecord = {
        id: `fee_t_${Date.now()}`,
        studentId: newFeeStudentId,
        amount: billTotal,
        dueDate: new Date().toISOString().split('T')[0],
        status: 'paid',
        paidDate: new Date().toISOString().split('T')[0],
        month: newFeeMonth,
        feeType: newFeeType,
        paymentMethod: 'Cash (Direct Collection)',
        description: `Direct cash collection by Faculty: ${userSession.name}`
      };
      setFees([newFee, ...updatedFees]);
    }

    toast.success(`Collection of ${collected} for ${student.name} recorded!`);

    // SATH HI: Trigger parents message notification popup preview
    const rawMsg = `Saddar Campus Fee Deposit Receipt:\nAssalam-o-Alaikum! Fee payment of ${collected} has been received for student ${student.name} (${newFeeMonth} - ${newFeeType}). Your account balance has been updated. Thank you.\n- Demo School Digital Registrar Office.`;

    setFeeNotificationPopup({
      studentName: student.name,
      parentPhone: student.parentPhone || '0300-1111222',
      guardianName: student.guardianName || 'Guardian of ' + student.name,
      amount: collected,
      feeType: newFeeType,
      month: newFeeMonth,
      dueDate: new Date().toISOString().split('T')[0],
      messageText: rawMsg
    });

    setShowAddFeeModal(false);
    setNewFeeAmount('');
    setAmountCollected('');
    setNewFeeStudentId('');
  };
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // ATTENDANCE STATES
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().split('T')[0]); // Initialize to current date YYYY-MM-DD
  // Local scratchpad for managing attendance edits before saving
  const [scratchAttendance, setScratchAttendance] = useState<{ [studentId: string]: 'present' | 'absent' | 'late' | 'leave' }>({});
  const [attendanceMode, setAttendanceMode] = useState<'grid' | 'list' | 'swipe'>('grid');
  const [activeSwipeIndex, setActiveSwipeIndex] = useState<number>(0);
  const [feeSearch, setFeeSearch] = useState('');
  const [expandedFeeId, setExpandedFeeId] = useState<string | null>(null);

  const [selectedStudentProfile, setSelectedStudentProfile] = useState<Student | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileMarkSubject, setProfileMarkSubject] = useState(teacherSubject);
  const [profileMarkExam, setProfileMarkExam] = useState('');
  const [profileMarkObtained, setProfileMarkObtained] = useState('');
  const [profileMarkMax, setProfileMarkMax] = useState('100');

  // MARKS STATES
  const [selectedMarkClassId, setSelectedMarkClassId] = useState<string>(activeClassId);
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [manualSubjectInput, setManualSubjectInput] = useState<string>('');
  const [selectedExamType, setSelectedExamType] = useState<ExamType>('Monthly test');
  const [maxMarksInput, setMaxMarksInput] = useState<number>(100);
  const [timetableDayFilter, setTimetableDayFilter] = useState<string>('all');

  // EXAM REPORT BUILDER STATE (bulk marks entry for any exam)
  const [marksSubTab, setMarksSubTab] = useState<'exam' | 'report'>('exam');
  const [examNameDraft, setExamNameDraft] = useState<string>('1st Term');

  const EXAM_NAME_OPTIONS = ['1st Term', '2nd Term', '3rd Term', 'Annual', 'Monthly Test', 'Unit Test', 'Half Yearly', 'Mid Term', 'Final Term', 'Class Test'];
  const SUBJECT_OPTIONS = ['English', 'Mathematics', 'Science', 'Urdu', 'Islamiat', 'Computer', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Pak Studies', 'General Science'];
  
  // NEW REPORT BUILDER STATE
  const [reportStudentId, setReportStudentId] = useState<string>('');
  const [reportSubjectsList, setReportSubjectsList] = useState<{ id: string, subject: string, ref: string, maxMarks: string, obtained: string }[]>([]);
  const [reportSubjectToAdd, setReportSubjectToAdd] = useState<string>('');
  const [reportManualSubject, setReportManualSubject] = useState<string>('');
  const [reportRefToAdd, setReportRefToAdd] = useState<string>('');
  const [reportExamName, setReportExamName] = useState<string>('');
  const [cardStudentId, setCardStudentId] = useState<string>('');
  const [cardExamName, setCardExamName] = useState<string>('');
  const [cardSubjects, setCardSubjects] = useState<{ id: string; subject: string; maxMarks: string }[]>([]);
  const [cardObtained, setCardObtained] = useState<Record<string, string>>({});
  const [cardSubjectToAdd, setCardSubjectToAdd] = useState<string>('');
  const [cardManualSubject, setCardManualSubject] = useState<string>('');
  const [cardMaxToAdd, setCardMaxToAdd] = useState<string>('100');
  
  const [scratchMarks, setScratchMarks] = useState<{ [studentId: string]: string }>({});

  // DIARY / ASSIGNMENTS STATE
  const [diaryClassId, setDiaryClassId] = useState<string>(classId);
  const [diarySubject, setDiarySubject] = useState<string>('');
  const [diaryTitle, setDiaryTitle] = useState<string>('');
  const [diaryDescription, setDiaryDescription] = useState<string>('');
  const [diaryDueDate, setDiaryDueDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // ===== TEACHER SELF-ATTENDANCE (GPS check-in/out) + PAY (demo local store) =====
  const [myTeacherAttendance, setMyTeacherAttendance] = useState<TeacherAttendance[]>(() => loadLocalJSON('acadamis_teacher_attendance', [] as TeacherAttendance[]));
  const [teacherPayConfigs, setTeacherPayConfigs] = useState<TeacherPayConfig[]>(() => loadLocalJSON('acadamis_teacher_pay_configs', INITIAL_TEACHER_PAY_CONFIGS as TeacherPayConfig[]));
  const [teacherPaySlips, setTeacherPaySlips] = useState<Record<string, TeacherPayslip>>(() => loadLocalJSON('acadamis_teacher_pay_slips', {} as Record<string, TeacherPayslip>));
  const [schoolLocation, setSchoolLocation] = useState<SchoolLocation>(() => loadLocalJSON('acadamis_school_location', INITIAL_SCHOOL_LOCATION as SchoolLocation));
  const [useDemoPosition, setUseDemoPosition] = useState<boolean>(() => loadLocalJSON('acadamis_teacher_use_demo_gps', false));
  const [selfAttMonth, setSelfAttMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [payMonthSel, setPayMonthSel] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Persistence (demo = localStorage only; live = sync layer ko bhi queue)
  useEffect(() => {
    safeStorage.setItem('acadamis_teacher_attendance', JSON.stringify(myTeacherAttendance));
    myTeacherAttendance.forEach(a => sbQueueWrite('teacher_attendance', a.id, a));
  }, [myTeacherAttendance]);
  useEffect(() => {
    safeStorage.setItem('acadamis_teacher_pay_slips', JSON.stringify(teacherPaySlips));
    Object.entries(teacherPaySlips).forEach(([k, v]) => sbQueueWrite('teacher_pay', k, v));
  }, [teacherPaySlips]);
  useEffect(() => { safeStorage.setItem('acadamis_teacher_use_demo_gps', JSON.stringify(useDemoPosition)); }, [useDemoPosition]);

  const todayStr = new Date().toISOString().split('T')[0];
  const myTodayAttendance = React.useMemo(
    () => myTeacherAttendance.find(r => r.date === todayStr) || null,
    [myTeacherAttendance, todayStr]
  );

  const handleTeacherCheckIn = async () => {
    if (myTodayAttendance?.checkIn) { toast.info('Aap already check-in kar chuke hain.'); return; }
    let pos: { latitude: number; longitude: number } | null = null;
    let dist = Number.NaN;
    if (useDemoPosition) {
      pos = { latitude: schoolLocation.lat, longitude: schoolLocation.lng };
      dist = 0;
    } else {
      pos = await getCurrentPosition();
      if (!pos) {
        setUseDemoPosition(true);
        toast.error('Device location nahi mili — neeche "Demo GPS (School Location)" tick karke dobara Check-In Try karein.');
        return;
      }
      dist = haversineMeters(schoolLocation.lat, schoolLocation.lng, pos.latitude, pos.longitude);
      if (getAttendanceSettings().gpsRestricted && dist > schoolLocation.radiusMeters) {
        toast.error(`Aap school se ${formatDistance(dist)} door hain (radius ${schoolLocation.radiusMeters} m). Attendance sirf school ke andar se mark hoti hai.`);
        return;
      }
    }
    const now = new Date();
    const isLate = now.getHours() > 8 || (now.getHours() === 8 && now.getMinutes() >= 31); // 8:30 AM cutoff
    const rec: TeacherAttendance = {
      id: `tatt_${teacherId}_${todayStr}`,
      teacherId,
      date: todayStr,
      checkIn: now.toISOString(),
      checkOut: null,
      status: isLate ? 'late' : 'present',
      lat: pos.latitude,
      lng: pos.longitude,
      distanceMeters: Math.round(dist || 0),
      locationVerified: true,
      note: useDemoPosition ? 'Demo GPS (school location)' : 'Live GPS',
    };
    setMyTeacherAttendance([rec, ...myTeacherAttendance.filter(a => a.id !== rec.id)]);
    addNotification({
      type: 'attendance_complete',
      title: `Check-in: ${userSession.name}`,
      message: `${userSession.name} ne ${now.toLocaleTimeString()} par check-in kiya (${isLate ? 'LATE' : 'On Time'}, ${useDemoPosition ? 'Demo GPS' : formatDistance(Math.round(dist || 0))} school se).`,
      teacherId: teacherId,
      classId: '',
      role: 'all'
    });
    toast.success(isLate
      ? `Check-in ho gaya (${now.toLocaleTimeString()}) — LATE ${useDemoPosition ? '' : '· ' + formatDistance(dist || 0)}`
      : `Check-in ho gaya (${now.toLocaleTimeString()}) ✅ ${useDemoPosition ? '' : '· ' + formatDistance(dist || 0)}`);
  };

  const handleTeacherCheckOut = async () => {
    if (!myTodayAttendance?.checkIn) { toast.info('Pehle Check-In karein, phir Check-Out hoga.'); return; }
    if (myTodayAttendance.checkOut) { toast.info('Aap already check-out kar chuke hain.'); return; }
    const now = new Date();
    let dist = myTodayAttendance.distanceMeters;
    let pos: { latitude: number; longitude: number } | null = null;
    if (!useDemoPosition) {
      pos = await getCurrentPosition();
      if (pos) dist = Math.round(haversineMeters(schoolLocation.lat, schoolLocation.lng, pos.latitude, pos.longitude));
    }
    const updated: TeacherAttendance = {
      ...myTodayAttendance,
      checkOut: now.toISOString(),
      lat: pos?.latitude ?? myTodayAttendance.lat,
      lng: pos?.longitude ?? myTodayAttendance.lng,
      distanceMeters: dist,
    };
    setMyTeacherAttendance(myTeacherAttendance.map(a => a.id === updated.id ? updated : a));
    addNotification({
      type: 'attendance_complete',
      title: `Check-out: ${userSession.name}`,
      message: `${userSession.name} ne ${now.toLocaleTimeString()} par check-out kiya. Din mukammal ✔`,
      teacherId: teacherId,
      classId: '',
      role: 'all'
    });
    toast.success(`Check-out ho gaya (${now.toLocaleTimeString()}) — din mukammal ✅`);
  };

  // Monthly self-attendance calendar
  const [selfAttYear, selfAttMonthIdx] = React.useMemo(() => {
    const parts = selfAttMonth.split('-').map(Number) as [number, number];
    return [parts[0], parts[1] - 1] as [number, number];
  }, [selfAttMonth]);

  const selfAttGrid: (number | null)[] = React.useMemo(() => {
    const first = new Date(selfAttYear, selfAttMonthIdx, 1);
    const startDow = (first.getDay() + 6) % 7; // Monday-first
    const dim = new Date(selfAttYear, selfAttMonthIdx + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(d);
    return cells;
  }, [selfAttYear, selfAttMonthIdx]);

  const statusOnDate = React.useCallback((dateStr: string) => {
    const r = myTeacherAttendance.find(x => x.date === dateStr);
    return r ? r.status : null;
  }, [myTeacherAttendance]);

  const selfAttSummary = React.useMemo(
    () => summarizeTeacherMonth(myTeacherAttendance, teacherId, selfAttYear, selfAttMonthIdx),
    [myTeacherAttendance, teacherId, selfAttYear, selfAttMonthIdx]
  );

  // ===== TEACHER PAY =====
  const myPayConfig = React.useMemo(() => {
    const found = teacherPayConfigs.find(c => String(c.teacherId) === String(teacherId));
    return found || defaultPayConfig(teacherId);
  }, [teacherPayConfigs, teacherId]);

  const [payYear, payMonthIdx] = React.useMemo(() => {
    const parts = payMonthSel.split('-').map(Number) as [number, number];
    return [parts[0], parts[1] - 1] as [number, number];
  }, [payMonthSel]);

  const myPayslip = React.useMemo(
    () => buildPayslip(teacherProfile, myPayConfig, myTeacherAttendance, payYear, payMonthIdx, teacherPaySlips),
    [teacherProfile, myPayConfig, myTeacherAttendance, payYear, payMonthIdx, teacherPaySlips]
  );

  // ===== COMPLETE SALARY HISTORY — service tenure + saare months ka hisab =====
  const salaryHistory = React.useMemo(() => {
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth();

    // Sab se pehla record dhundo (attendance + payslips dono se)
    let minY = curY, minM = curM;
    let hasRecord = false;
    for (const r of myTeacherAttendance) {
      if (String(r.teacherId) !== String(teacherId)) continue;
      const k = monthKeyOf(r.date);
      if (!hasRecord || k.year < minY || (k.year === minY && k.month < minM)) {
        minY = k.year; minM = k.month; hasRecord = true;
      }
    }
    for (const key of Object.keys(teacherPaySlips)) {
      const parts = key.split('_');
      if (parts[0] !== String(teacherId)) continue;
      const y = Number(parts[1]), m = Number(parts[2]);
      if (isNaN(y) || isNaN(m)) continue;
      if (!hasRecord || y < minY || (y === minY && m < minM)) {
        minY = y; minM = m; hasRecord = true;
      }
    }

    // Har month ka payslip — join month se current month tak
    const slips: TeacherPayslip[] = [];
    let y = minY, m = minM;
    while (y < curY || (y === curY && m <= curM)) {
      slips.push(buildPayslip(teacherProfile, myPayConfig, myTeacherAttendance, y, m, teacherPaySlips));
      m++;
      if (m > 11) { m = 0; y++; }
    }

    // Tenure — kitne saal/mahine se hain
    let tenureMonths = (curY - minY) * 12 + (curM - minM);
    if (tenureMonths < 0) tenureMonths = 0;
    const tenureYears = Math.floor(tenureMonths / 12);
    const tenureRemMonths = tenureMonths % 12;

    // Totals
    const totalNet = slips.reduce((a, s) => a + s.netPay, 0);
    const totalPaid = slips.filter(s => s.paid).reduce((a, s) => a + s.netPay, 0);
    const totalPending = totalNet - totalPaid;
    const avgMonthly = slips.length > 0 ? Math.round(totalNet / slips.length) : 0;
    const totalPresent = slips.reduce((a, s) => a + s.presentDays + s.lateDays, 0);
    const totalAbsent = slips.reduce((a, s) => a + s.absentDays, 0);

    return {
      slips: slips.slice().reverse(), // latest pehle
      tenureYears,
      tenureRemMonths,
      tenureTotalMonths: tenureMonths,
      startLabel: monthLabel(minY, minM),
      startYear: minY,
      startMonth: minM,
      hasRecord,
      totalNet,
      totalPaid,
      totalPending,
      avgMonthly,
      totalPresent,
      totalAbsent,
      monthsCount: slips.length,
    };
  }, [teacherProfile, myPayConfig, myTeacherAttendance, teacherId, teacherPaySlips]);

  const printPayslip = () => {
    const t = teacherProfile;
    if (!t) return;
    const s = myPayslip;
    const rows =
      `<tr><td class="lbl">Base Salary</td><td class="amt">${formatPKR(s.baseSalary)}</td></tr>
      <tr><td class="lbl">Present Days (${s.presentDays}) × Daily Bonus</td><td class="amt">+ ${formatPKR(s.presentBonus)}</td></tr>
      <tr><td class="lbl">Allowances</td><td class="amt">+ ${formatPKR(s.allowances)}</td></tr>
      <tr><td class="lbl">Late Deduction (${s.lateDays} day)</td><td class="amt">- ${formatPKR(s.lateDeduction)}</td></tr>
      <tr><td class="lbl">Absent Deduction (${s.absentDays} day)</td><td class="amt">- ${formatPKR(s.absentDeduction)}</td></tr>
      ${s.fixedDeductions > 0 ? `<tr><td class="lbl">Fixed Deductions</td><td class="amt">- ${formatPKR(s.fixedDeductions)}</td></tr>` : ''}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payslip - ${t.name}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', Arial, sans-serif; color:#0f172a; margin:0; padding:32px; }
    .slip { max-width:720px; margin:0 auto; border:2px solid #0d9488; border-radius:16px; overflow:hidden; }
    .head { background:linear-gradient(90deg,#0d9488,#14b8a6); color:#fff; padding:22px 26px; display:flex; justify-content:space-between; align-items:center; }
    .head h1 { margin:0; font-size:20px; }
    .head .pct { text-align:right; }
    .head .pct .big { font-size:30px; font-weight:900; }
    .head .pct .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.15em; opacity:.85; }
    .meta { display:flex; gap:20px; padding:16px 26px; border-bottom:1px solid #e2e8f0; font-size:13px; }
    .meta b { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:#64748b; margin-bottom:2px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    .lbl { padding:10px 20px; color:#334155; }
    .amt { padding:10px 20px; text-align:right; font-weight:700; }
    .tot td { padding:13px 20px; font-weight:900; background:#0f766e; color:#fff; }
    .foot { padding:14px 26px; font-size:11px; color:#94a3b8; display:flex; justify-content:space-between; }
  </style></head><body>
  <div class="slip">
    <div class="head">
      <div><h1>${t.name}</h1><div style="font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:.1em;">${t.subject} · Payslip</div></div>
      <div class="pct"><div class="lbl">Net Payable</div><div class="big">${formatPKR(s.netPay)}</div><div style="font-size:11px;opacity:.85;">${monthLabel(s.year, s.month)}</div></div>
    </div>
    <div class="meta">
      <div><b>Period</b>${monthLabel(s.year, s.month)}</div>
      <div><b>Present</b>${s.presentDays}</div>
      <div><b>Late</b>${s.lateDays}</div>
      <div><b>Absent</b>${s.absentDays}</div>
      <div><b>Leave</b>${s.leaveDays}</div>
      <div><b>Status</b>${s.paid ? 'PAID' : 'PENDING'}</div>
    </div>
    <table>${rows}</table>
    <table><tr class="tot"><td>Net Payable</td><td style="text-align:right">${formatPKR(s.netPay)}</td></tr></table>
    <div class="foot"><span>Demo School — Digital Registrar</span><span>Generated: ${new Date().toLocaleString()}</span></div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script>
  </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Pop-up blocked. Allow pop-ups to print payslip.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  // Memoized Data & Optimized Lookups for performance
  const studentsMap = React.useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach(s => map.set(String(s.id), s));
    return map;
  }, [students]);

  const classesMap = React.useMemo(() => {
    const map = new Map<string, Class>();
    classes.forEach(c => map.set(String(c.id), c));
    return map;
  }, [classes]);

  const teachersMap = React.useMemo(() => {
    const map = new Map<string, Teacher>();
    teachers.forEach(t => map.set(String(t.id), t));
    return map;
  }, [teachers]);

  // Index fees by studentId for faster lookup
  const studentFeesSummaryMap = React.useMemo(() => {
    const map = new Map<string, { totalPaid: number, count: number }>();
    fees.forEach(f => {
      const sId = String(f.studentId);
      const current = map.get(sId) || { totalPaid: 0, count: 0 };
      map.set(sId, { 
        totalPaid: current.totalPaid + Number(f.amount || 0), 
        count: current.count + 1 
      });
    });
    return map;
  }, [fees]);

  // Helper to resolve weekday from date string (format YYYY-MM-DD)
  const getWeekdayFromDateStr = (dateStr: string): DayOfWeek => {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      const dayIndex = d.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat
      const mapping: Record<number, DayOfWeek> = {
        0: 'Sunday',
        1: 'Monday',
        2: 'Tuesday',
        3: 'Wednesday',
        4: 'Thursday',
        5: 'Friday',
        6: 'Saturday'
      };
      return mapping[dayIndex] || 'Monday'; // Fallback
    }
    return 'Tuesday';
  };

  const currentDayName = getWeekdayFromDateStr(attendanceDate);

  // My full-week lectures for the dropdown day view
  const myWeekLectures = React.useMemo(
    () => timetable
      .filter(tt => tt.teacherId === teacherId)
      .sort((a, b) => {
        const pa = parseInt((a.period || '').replace(/[^0-9]/g, ''), 10);
        const pb = parseInt((b.period || '').replace(/[^0-9]/g, ''), 10);
        return (isNaN(pa) ? 99 : pa) - (isNaN(pb) ? 99 : pb);
      }),
    [timetable, teacherId]
  );

  // Filter today's classes for this teacher
  const todayClasses = timetable
    .filter(tt => tt.teacherId === teacherId && tt.day === currentDayName)
    // Sort chronologically by Period
    .sort((a, b) => {
      const parsePeriod = (p: string) => {
        const num = parseInt(p.replace(/[^0-9]/g, ''), 15);
        return isNaN(num) ? 99 : num;
      };
      return parsePeriod(a.period) - parsePeriod(b.period);
    });

  // Unique list of class IDs taught today
  const classesTaughtToday = Array.from(new Set(todayClasses.map(tt => tt.classId)));

  // Notifications local states
  const [notifications, setNotifications] = useState<PortalNotification[]>(() => getNotifications());
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const notifiedPeriodsRef = useRef<string[]>([]);

  // Theme support
  const [darkTheme, setDarkTheme] = useState<boolean>(() => {
    return safeStorage.getItem('acadamis_dark_theme') === 'true';
  });

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

  // Update notifications from global state on external events
  useEffect(() => {
    const updateNotifs = () => {
      setNotifications(getNotifications());
    };
    window.addEventListener('acadamis_new_notification', updateNotifs);
    return () => window.removeEventListener('acadamis_new_notification', updateNotifs);
  }, []);

  // Real-time period detection interval (runs every 10 seconds)
  useEffect(() => {
    const checkActivePeriods = () => {
      // Find today's lectures for this teacher
      const myTodayLectures = timetable.filter(tt => tt.teacherId === teacherId && tt.day === currentDayName);
      if (myTodayLectures.length === 0) return;

      myTodayLectures.forEach(lecture => {
        const status = getPeriodStatus(lecture.time);
        if (status === 'current') {
          // Check if we already notified during this session
          if (!notifiedPeriodsRef.current.includes(lecture.id)) {
            notifiedPeriodsRef.current.push(lecture.id);
            
            const classObj = classes.find(c => c.id === lecture.classId);
            const classStr = classObj ? `${classObj.className}-${classObj.section}` : '';
            
            // Trigger Toast Notification
            toast.success(`🔔 Class Bell: ${lecture.period} has started!`, {
              description: `Subject "${lecture.subject}" is active for Class ${classStr}.`,
              duration: 8000
            });

            // Add notification
            addNotification({
              type: 'period_bell',
              title: `${lecture.period} Started ⏰`,
              message: `Class bell is ringing! Your scheduled lecture for "${lecture.subject}" is now active for Class ${classStr}. Kindly proceed to your classroom.`,
              teacherId: teacherId,
              classId: lecture.classId,
              role: 'teacher'
            });
          }
        }
      });
    };

    const interval = /^[0-9]/.test(attendanceDate) ? setInterval(checkActivePeriods, 10050) : null;
    checkActivePeriods();

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timetable, teacherId, currentDayName, classes, attendanceDate]);

  // Manually Simulate Next Period
  const handleSimulateNextPeriod = () => {
    // Collect all lectures for this teacher regardless of day, sorted chronologically
    const allTeacherLectures = timetable.filter(tt => tt.teacherId === teacherId);
    if (allTeacherLectures.length === 0) {
      toast.error("No lectures scheduled for you in the timetable yet. Ask the Principal to add one!");
      return;
    }

    // Pick one at random to simulate
    const randIndex = Math.floor(Math.random() * allTeacherLectures.length);
    const lecture = allTeacherLectures[randIndex];
    const classObj = classes.find(c => c.id === lecture.classId);
    const classStr = classObj ? `${classObj.className}-${classObj.section}` : 'General';

    // Show simulation toast
    toast.info(`🔔 Simulated Bell: ${lecture.period} started!`, {
      description: `Class: ${classStr} | Subject: ${lecture.subject}. Notification has been dispatched to both your portal and your students!`,
      duration: 6000
    });

    // Add persistent notification so both teacher and student get it
    addNotification({
      type: 'period_bell',
      title: `${lecture.period} Started (${lecture.subject}) ⏰`,
      message: `🔔 Simulated School Bell is ringing! Today's lecture "${lecture.subject}" for Class ${classStr} with instructor ${userSession.name} has begun.`,
      teacherId: teacherId,
      classId: lecture.classId,
      role: 'all'
    });
  };

  const handleMarkAllRead = () => {
    const updated = notifications.map(n => ({ ...n, isUnread: false }));
    saveNotifications(updated);
    setNotifications(updated);
    toast.success("All notifications marked as read.");
  };

  const handleClearNotifications = () => {
    saveNotifications([]);
    setNotifications([]);
    toast.success("Notification history cleared.");
  };

  // All relevant classes to track for attendance today (Assigned Class + classes taught today)
  const classesToCheckForReminders = React.useMemo(() => Array.from(new Set([
    ...(myClasses.find(c => c.classTeacherId === teacherId)?.id ? [myClasses.find(c => c.classTeacherId === teacherId)!.id] : []),
    ...classesTaughtToday
  ])), [myClasses, teacherId, classesTaughtToday]);

  // Count pending and completed for attendance checklist
  const attendanceStatusList = React.useMemo(() => {
    // Optimization: filter attendance for current date once
    const todayAttendance = attendance.filter(a => a.date === attendanceDate);
    // Optimization: Create a Set of student IDs marked today for O(1) lookups
    const markedStudentIds = new Set(todayAttendance.map(a => String(a.studentId)));

    return classesToCheckForReminders.map(cId => {
      const cls = classesMap.get(cId);
      const classStudents = students.filter(s => s.classId === cId);
      // Check if any student in this class is marked
      const marked = classStudents.length > 0 && classStudents.some(s => markedStudentIds.has(String(s.id)));
      
      // Calculate counts - reuse todayAttendance
      const classAttendance = todayAttendance.filter(a => classStudents.some(s => s.id === a.studentId));
      const presentCount = classAttendance.filter(a => a.status === 'present').length;
      const absentCount = classAttendance.filter(a => a.status === 'absent').length;

      return {
        classId: cId,
        className: cls ? `${cls.className}-${cls.section}` : 'N/A',
        isMentorClass: cId === classId,
        marked,
        studentCount: classStudents.length,
        presentCount,
        absentCount
      };
    });
  }, [classesToCheckForReminders, classesMap, students, attendance, attendanceDate, classId]);

  const pendingCount = attendanceStatusList.filter(item => !item.marked).length;

  // GET RELEVANT DATA FOR ACTIVE VIEW
  const viewClass = classes.find(c => c.id === activeClassId);

  // Initialize attendance scratchpad for selected class & date
  const loadAttendanceForDate = (date: string, cId: string) => {
    const classStudents = students.filter(s => s.classId === cId);
    
    // Optimization: Index attendance for the specific date by studentId for O(1) lookup
    const dateAttendanceMap = new Map();
    attendance.forEach(a => {
      if (a.date === date) {
        dateAttendanceMap.set(String(a.studentId), a);
      }
    });
    
    const initialToggles: { [studentId: string]: 'present' | 'absent' | 'late' | 'leave' } = {};
    classStudents.forEach(student => {
      const match = dateAttendanceMap.get(String(student.id));
      // Default to 'present' if not marked, or set stored value
      initialToggles[student.id] = match ? match.status : 'present';
    });
    setScratchAttendance(initialToggles);
    setActiveSwipeIndex(0);
  };

  // Trigger loading when entering attendance tab or changing date/class
  const handleEnterAttendanceTab = (clsId: string, dateStr: string) => {
    setActiveClassId(clsId);
    setAttendanceDate(dateStr);
    loadAttendanceForDate(dateStr, clsId);
  };

  const handleSetStatus = (studentId: string, status: 'present' | 'absent' | 'late' | 'leave') => {
    setScratchAttendance(prev => ({
      ...prev,
      [studentId]: status
    }));
  };

  const handleSaveAttendance = () => {
    const studentsToSave = students.filter(s => s.classId === activeClassId);
    
    // Filter out existing entries for this date & students in this class
    const cleanLogs = attendance.filter(a => 
      !(a.date === attendanceDate && studentsToSave.some(s => s.id === a.studentId))
    );

    // Build new logs
    const newLogs: Attendance[] = studentsToSave.map((s, index) => ({
      id: `at_gen_${Date.now()}_${index}`,
      studentId: s.id,
      date: attendanceDate,
      status: scratchAttendance[s.id] || 'present',
      markedBy: userSession.name
    }));

    setAttendance([...cleanLogs, ...newLogs]);

    const classNameStr = viewClass ? `${viewClass.className}-${viewClass.section}` : activeClassId;
    const presentCount = newLogs.filter(l => l.status === 'present').length;
    const absentCount = newLogs.filter(l => l.status === 'absent').length;

    addNotification({
      type: 'attendance_complete',
      title: `Attendance Completed: ${classNameStr}`,
      message: `${userSession.name} has completed attendance for Class ${classNameStr} on ${attendanceDate}. Present: ${presentCount} | Absent: ${absentCount} | Total: ${newLogs.length}.`,
      teacherId: teacherId,
      classId: activeClassId,
      role: 'all'
    });

    toast.success('Attendance logs successfully updated and cached!');
    toast.info(`Principal & Coordinator notified for ${classNameStr}.`);
  };

  // DIARY / ASSIGNMENT ENGINE
  const handleCreateAssignment = () => {
    if (!diaryClassId) {
      toast.error("Please select a class first.");
      return;
    }
    if (!diaryTitle.trim()) {
      toast.error("Please enter an assignment title.");
      return;
    }
    const cls = classesMap.get(diaryClassId);
    const classNameStr = cls ? `${cls.className}-${cls.section}` : diaryClassId;

    const newAssignment: Assignment = {
      id: 'asgn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      classId: diaryClassId,
      subject: diarySubject.trim() || teacherSubject || 'General',
      title: diaryTitle.trim(),
      description: diaryDescription.trim(),
      dueDate: diaryDueDate,
      assignedById: teacherId,
      assignedByName: userSession.name,
      createdAt: new Date().toISOString(),
    };

    setAssignments(prev => [newAssignment, ...prev]);

    addNotification({
      type: 'attendance_complete',
      title: `New Assignment: ${newAssignment.title}`,
      message: `${userSession.name} posted a new ${newAssignment.subject} assignment for Class ${classNameStr}. Due: ${newAssignment.dueDate}. Check the Student Diary!`,
      teacherId: teacherId,
      classId: diaryClassId,
      role: 'student'
    });

    setDiaryTitle('');
    setDiaryDescription('');
    setDiarySubject('');
    toast.success(`Assignment posted to ${classNameStr} students!`);
  };

  const handleDeleteAssignment = (id: string) => {
    setAssignments(prev => prev.filter(a => a.id !== id));
    toast.success("Assignment removed from Diary.");
  };

  const myAssignments = React.useMemo(
    () => assignments
      .filter(a => a.assignedById === teacherId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [assignments, teacherId]
  );

  // MARKS ENGINE
  const handleEnterMarksTab = (clsId: string, subject: string, exam: ExamType) => {
    setSelectedMarkClassId(clsId);
    setSelectedSubject(subject);
    setSelectedExamType(exam);

    // Load initial marks values
    const classStudents = students.filter(s => s.classId === clsId);
    const scratch: { [studentId: string]: string } = {};
    
    let resolvedMaxMarks = exam === 'Unit Test' ? 25 : 100;
    
    classStudents.forEach(student => {
      const match = marks.find(
        m => m.studentId === student.id && 
             (m.subject?.toLowerCase() || '') === (subject?.toLowerCase()?.trim() || '') && 
             m.examType === exam
      );
      scratch[student.id] = match ? String(match.marksObtained) : '';
      if (match) {
        resolvedMaxMarks = match.maxMarks;
      }
    });
    
    setMaxMarksInput(resolvedMaxMarks);
    setScratchMarks(scratch);
  };

  const getStudentAttendanceStatus = (studentId: string, date: string): string | null => {
    const rec = attendance.find(a => String(a.studentId) === String(studentId) && a.date === date);
    return rec ? rec.status : null;
  };

  const handleSaveMarks = () => {
    const classStudents = students.filter(s => s.classId === selectedMarkClassId);
    if (!selectedSubject.trim()) {
      alert('Subject name is required to log scores.');
      return;
    }

    // Filter out existing marked records for this specific class scope, subject & exam type
    // (but keep records for absent/leave students since they aren't being edited here)
    const cleanMarks = marks.filter(m => {
      const sameScope = (m.subject?.toLowerCase() || '') === (selectedSubject?.toLowerCase()?.trim() || '') &&
        m.examType === selectedExamType &&
        classStudents.some(s => s.id === m.studentId);
      if (!sameScope) return true;
      const st = classStudents.find(s => s.id === m.studentId);
      if (st && ['absent', 'leave'].includes(getStudentAttendanceStatus(st.id, attendanceDate) || '')) return true;
      return false;
    });

    // Build new records
    const newRecords: Mark[] = [];
    classStudents.forEach((student, index) => {
      const scoreStr = scratchMarks[student.id];
      if (scoreStr !== undefined && scoreStr.trim() !== '') {
        const score = parseFloat(scoreStr);
        if (!isNaN(score)) {
          newRecords.push({
            id: `m_gen_${Date.now()}_${index}`,
            studentId: student.id,
            subject: selectedSubject.trim(),
            examType: selectedExamType,
            marksObtained: Math.min(score, maxMarksInput), // clamp to maximum marks
            maxMarks: maxMarksInput
          });
        }
      }
    });

    const removed = marks.filter(m => {
      const sameScope = (m.subject?.toLowerCase() || '') === (selectedSubject?.toLowerCase()?.trim() || '') &&
        m.examType === selectedExamType &&
        classStudents.some(s => s.id === m.studentId);
      return sameScope;
    });
    setMarks([...cleanMarks, ...newRecords]);
    syncMarksToFirestore(removed, newRecords);
    toast.success('Exam marks mapped and committed to storage.');
  };

  const handleAddMarkFromProfile = () => {
    if (!selectedStudentProfile) return;
    if (!profileMarkSubject.trim() || !profileMarkExam.trim() || !profileMarkObtained.trim()) {
      toast.error("Please fill all marks fields correctly");
      return;
    }

    const marksObtainedNum = parseFloat(profileMarkObtained);
    const maxMarksNum = parseFloat(profileMarkMax) || 100;

    if (isNaN(marksObtainedNum)) {
      toast.error("Marks obtained must be a number");
      return;
    }

    const newMark: Mark = {
      id: `m_prof_${Date.now()}`,
      studentId: selectedStudentProfile.id,
      subject: profileMarkSubject.trim(),
      examType: profileMarkExam.trim(),
      marksObtained: marksObtainedNum,
      maxMarks: maxMarksNum,
    };

    const removed = marks.filter(m =>
      String(m.studentId) === String(selectedStudentProfile.id) &&
      m.examType === profileMarkExam.trim() &&
      (m.subject?.toLowerCase() || '') === (profileMarkSubject.trim().toLowerCase())
    );
    setMarks(prev => [...prev, newMark]);
    syncMarksToFirestore(removed, [newMark]);
    setProfileMarkExam('');
    setProfileMarkObtained('');
    toast.success(`Mark added for ${selectedStudentProfile.name}`);
  };

  const handleSaveReport = () => {
    const student = students.find(s => s.id === reportStudentId);
    if (!student) {
      toast.error("Please select a student first.");
      return;
    }
    if (reportSubjectsList.length === 0) {
      toast.error("No subjects added to this report. Add at least one subject above.");
      return;
    }
    const examName = reportExamName.trim() || 'General';
    const cleanMarks = marks.filter(m => !(String(m.studentId) === String(student.id) && m.examType === examName));
    const removedForReport = marks.filter(m => String(m.studentId) === String(student.id) && m.examType === examName);
    const newRecords: Mark[] = reportSubjectsList.map((sj, idx) => {
      const max = parseFloat(sj.maxMarks) || 100;
      const obtained = parseFloat(sj.obtained) || 0;
      return {
        id: `m_rpt_${Date.now()}_${idx}`,
        studentId: student.id,
        subject: sj.subject.trim(),
        examType: examName,
        marksObtained: Math.min(obtained, max),
        maxMarks: max,
      };
    });
    setMarks([...cleanMarks, ...newRecords]);
    syncMarksToFirestore(removedForReport, newRecords);
    toast.success(`Report saved for ${student.name} — visible in Principal Report.`);
  };

  // Auto-sync marks to Supabase (cloud) so data survives refresh / other devices
  const syncMarksToFirestore = async (removed: Mark[], recs: Mark[]) => {
    try {
      removed.forEach(m => { if (m && m.id) sbQueueDelete('marks', String(m.id)); });
      recs.forEach(m => { if (m && m.id) sbQueueWrite('marks', String(m.id), m); });
      await flushSupabase();
    } catch (err) {
      console.error('Marks cloud sync failed', err);
      toast.error('Saved on this device; cloud sync failed');
    }
  };

  // Group Timetable elements neatly
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  const getPeriodsList = () => {
    const defaultPeriods = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
    try {
      const saved = safeStorage.getItem('acadamis_extra_periods');
      const deletedSaved = safeStorage.getItem('acadamis_deleted_periods');
      
      const extra = saved ? JSON.parse(saved) : {};
      const deleted = deletedSaved ? JSON.parse(deletedSaved) : {};
      
      const classIds = myClasses.map(c => c.id);
      if (classIds.length === 0) {
        const allExtras = Object.values(extra).flat() as string[];
        const baseList = [...defaultPeriods, ...allExtras];
        const allDeletes = Object.values(deleted).flat() as string[];
        const unique = Array.from(new Set(baseList)).filter(p => !allDeletes.includes(p));
        return unique.sort((a, b) => {
          const aNum = parseInt(a.replace(/\D/g, '')) || 0;
          const bNum = parseInt(b.replace(/\D/g, '')) || 0;
          return aNum - bNum;
        });
      }
      
      const activePeriodsSet = new Set<string>();
      classIds.forEach(cId => {
        const classExtras = extra[cId] || [];
        const classDeleted = deleted[cId] || [];
        const classActive = [...defaultPeriods, ...classExtras].filter(p => !classDeleted.includes(p));
        classActive.forEach(p => activePeriodsSet.add(p));
      });
      
      const unique = Array.from(activePeriodsSet);
      return unique.sort((a, b) => {
        const aNum = parseInt(a.replace(/\D/g, '')) || 0;
        const bNum = parseInt(b.replace(/\D/g, '')) || 0;
        return aNum - bNum;
      });
    } catch (e) {
      console.error(e);
    }
    return defaultPeriods;
  };
  const PERIODS = getPeriodsList();

  // Resolve class details for timetable
  const getClassLabel = (cId: string) => {
    const c = classesMap.get(String(cId));
    return c ? `${c.className}-${c.section}` : 'N/A';
  };

  const getTeacherName = (tId: string) => {
    const t = teachersMap.get(String(tId));
    return t ? t.name : 'Unknown';
  };

  return (
    <div id="teacher-dashboard-root" className="min-h-screen bg-gray-50 flex flex-col md:flex-row pb-16 md:pb-0 relative">
      
      {/* Mobile Top Bar */}
      <div id="mobile-teacher-top-bar" className="md:hidden sticky top-0 flex items-center justify-between px-4 py-3 bg-white/90 backdrop-blur-lg border-b border-slate-200 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="Demo School Logo" className="h-10 w-auto object-contain" referrerPolicy="no-referrer" />
          <div>
            <h1 className="font-black text-gray-900 tracking-tight uppercase text-lg leading-none">Demo School</h1>
            <p className="text-[10px] font-bold text-teal-600 uppercase tracking-[0.2em] mt-0.5">Faculty Hub</p>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          {/* Mobile Bell Button */}
          <button 
            type="button"
            onClick={() => setShowNotifDropdown(!showNotifDropdown)}
            className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            title="Notifications"
          >
            <Bell size={18} />
            {notifications.filter(n => n.isUnread).length > 0 && (
              <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-black text-[10px] w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
                {notifications.filter(n => n.isUnread).length}
              </span>
            )}
          </button>

          <button 
            id="teacher-sidebar-toggle" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-95 transition-all"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Sidebar background overlay */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)} 
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
        />
      )}

      {/* Teacher Sidebar Drawer */}
      <div 
        id="sidebar-teacher" 
        className={`fixed md:sticky top-0 left-0 h-screen w-64 bg-white border-r border-slate-100 flex flex-col z-40 transition-transform duration-300 transform md:transform-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        } font-sans`}
        onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          if (touchStartX.current !== null) {
            const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
            if (dx < -50) setSidebarOpen(false);
            touchStartX.current = null;
          }
        }}
      >
        {/* Minimalist Brand header */}
        <div className="p-4 border-b border-slate-100 flex flex-col items-center gap-2">
          <div className="flex items-center justify-between w-full">
            <div className="mb-1">
              <img src="/logo.png" alt="Demo School Logo" className="h-14 w-auto object-contain" referrerPolicy="no-referrer" />
            </div>
            <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="md:hidden flex items-center justify-center px-2 h-9 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="text-center w-full">
            <h1 className="text-slate-900 font-black text-sm tracking-widest uppercase leading-none">Demo School</h1>
            <p className="text-teal-600 font-black text-[10px] tracking-[0.3em] uppercase mt-1">Faculty Hub</p>
          </div>
        </div>

        {/* Nav groups - Minimalist List */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1 mt-2">
            {[
              { id: 'dashboard', label: 'Overview', icon: Sparkles },
              { id: 'students', label: 'Roster', icon: Users },
              { id: 'attendance', label: 'Attendance', icon: CheckSquare, action: () => handleEnterAttendanceTab(activeClassId || myClasses[0]?.id || '', attendanceDate) },
              { id: 'marks', label: 'Marks', icon: Award, action: () => handleEnterMarksTab(selectedMarkClassId || classes[0]?.id || '', selectedSubject, selectedExamType) },
              { id: 'diary', label: 'Diary', icon: ClipboardList },
              { id: 'timetable', label: 'Time Table', icon: Calendar },
              { id: 'my-attendance', label: 'My Attendance', icon: MapPin },
              { id: 'my-pay', label: 'My Pay', icon: Wallet },
              { id: 'quiz', label: 'Quizzes', icon: ClipboardList, color: 'text-amber-600' },
              { id: 'ai_paper', label: 'AI Paper', icon: Sparkles, color: 'text-indigo-600' },
              { id: 'notices', label: 'Notice Board', icon: Megaphone },
              { id: 'calendar', label: 'Calendar', icon: CalendarDays },
              { id: 'settings', label: 'Settings', icon: Sparkles }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => { 
                  if (item.action) item.action();
                  handleTabChange(item.id as TabType); 
                  setSidebarOpen(false); 
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-black uppercase tracking-widest text-left transition-all rounded-xl ${
                  activeTab === item.id 
                    ? 'bg-gradient-to-r from-teal-600 to-teal-600 shadow-lg shadow-teal-100 text-white' 
                    : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <item.icon size={14} className={activeTab === item.id ? 'text-white' : 'text-slate-300'} />
                {item.label}
              </button>
            ))}

            {/* Install Button in Teacher Sidebar */}
            <button
              onClick={onInstallApp}
              className="w-full flex items-center gap-3 px-4 py-3 text-xs font-black uppercase tracking-widest text-left transition-all bg-teal-50 text-teal-700 hover:bg-teal-100 mt-2 border border-teal-100 rounded-xl"
            >
              <Download size={14} className="text-teal-600" />
              Install App
            </button>
          </nav>

        {/* Minimalist Profile section */}
        <div className="p-6 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-600 to-teal-600 flex items-center justify-center text-white font-black text-xs shadow-md shadow-teal-100">
              <User size={14} />
            </div>
            <div className="truncate">
              <p className="text-slate-900 text-xs font-black uppercase tracking-tight truncate">{userSession.name}</p>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest truncate">{teacherSubject}</p>
            </div>
          </div>
          
          <button
            onClick={onLogout}
            className="w-full py-3.5 bg-rose-600 text-white hover:bg-rose-700 transition-all text-xs font-black uppercase tracking-widest text-center cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-rose-100 rounded-xl"
          >
            <LogOut size={16} />
            EXIT FACULTY PORTAL
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <main className="flex-1 min-h-screen flex flex-col p-4 md:p-8 lg:p-10 max-w-7xl mx-auto w-full text-slate-800 font-sans">
        
        {/* Global Desktop Top Bar with Real-time Period Alert & Notification Bell */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-6 z-30 relative font-sans">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="Demo School Logo" className="h-14 w-auto object-contain sm:block hidden" referrerPolicy="no-referrer" />
              <h2 className="text-3xl font-black text-slate-900 tracking-tight sm:block hidden select-none">Demo School</h2>
            </div>
            
            {/* Real-time active period locator */}
            {(() => {
              // Find today's current lecture based on clock time & selected day
              const currentPeriodObj = timetable.find(tt => {
                if (tt.teacherId !== teacherId) return false;
                const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const systName = systemDays[new Date().getDay()];
                // Match today or our date selector's weekday
                if (tt.day !== systName && tt.day !== currentDayName) return false;
                
                try {
                  const status = getPeriodStatus(tt.time);
                  return status === 'current';
                } catch (e) {
                  return false;
                }
              });

              if (!currentPeriodObj) return (
                <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  No Active Lecture Right Now
                </div>
              );

              const matchingClass = classes.find(c => c.id === currentPeriodObj.classId);
              const classLabel = matchingClass ? `${matchingClass.className}-${matchingClass.section}` : '';

              return (
                <div className="flex items-center gap-2 px-3 py-1 bg-red-50 border border-red-100 text-red-700 rounded-full text-xs font-extrabold uppercase tracking-widest animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-650 animate-ping"></span>
                  LIVE: {currentPeriodObj.period} ({currentPeriodObj.subject} — Class {classLabel})
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Period Simulator */}
            <button
              onClick={handleSimulateNextPeriod}
              className="px-3.5 py-2 bg-gradient-to-r from-teal-600 to-teal-600 text-white text-xs font-black uppercase tracking-widest rounded-full shadow-md shadow-teal-200 hover:from-teal-700 hover:to-teal-700 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
              title="Test class bells and push notifications"
            >
              <Bell size={13} />
              Bell
            </button>

            {/* Quick Dark Mode Toggler */}
            <button
              type="button"
              onClick={handleToggleTheme}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-full transition-all flex items-center justify-center text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              title="Toggle Dark/Light Mode"
            >
              <span key={String(darkTheme)} className="animate-theme-pop inline-flex">
                {darkTheme ? <Sun size={15} className="text-amber-500" /> : <Moon size={15} />}
              </span>
            </button>

            {/* Notification Bell Dropdown */}
            {/* Visible on both mobile and desktop via single dropdown trigger */}
            <div className="relative">
              <button 
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className={`p-2 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all flex items-center justify-center relative uppercase font-black text-xs ${showNotifDropdown ? 'bg-slate-100' : 'bg-white'}`}
                title="Notifications"
              >
                <Bell size={16} className="text-slate-600" />
                {notifications.filter(n => n.isUnread).length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-teal-600 text-white font-extrabold text-xs w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
                    {notifications.filter(n => n.isUnread).length}
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
                      className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 py-3 flex flex-col font-sans"
                    >
                      <div className="px-4 pb-2 border-b border-slate-150 flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest">School Bells / Alerts</span>
                        <div className="flex items-center gap-2">
                          {notifications.length > 0 && (
                            <button onClick={handleMarkAllRead} className="text-xs hover:underline text-teal-600 font-bold uppercase">Mark Read</button>
                          )}
                          {notifications.length > 0 && (
                            <span className="text-slate-200">|</span>
                          )}
                          <button onClick={handleClearNotifications} className="text-xs hover:underline text-rose-600 font-bold uppercase">Clear</button>
                        </div>
                      </div>

                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                        {notifications.length === 0 ? (
                          <div className="py-8 text-center text-slate-400 text-xs ">
                            No notifications received yet
                          </div>
                        ) : (
                          notifications.map(notif => (
                            <div 
                              key={notif.id} 
                              className={`p-3 text-left transition-colors hover:bg-slate-50/50 ${notif.isUnread ? 'bg-teal-50/10' : ''}`}
                            >
                              <div className="flex items-start gap-2.5">
                                <span className="text-xs">
                                  {notif.type === 'period_bell' ? '🔔' : notif.type === 'fee_due' ? '💰' : '📅'}
                                </span>
                                <div className="space-y-0.5 max-w-[210px] overflow-hidden">
                                  <h4 className="font-extrabold text-xs text-slate-900 leading-tight flex items-center gap-1.5">
                                    <span className="truncate">{notif.title}</span>
                                    {notif.isUnread && <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0"></span>}
                                  </h4>
                                  <p className="text-xs text-slate-600 leading-relaxed word-break whitespace-normal break-words">{notif.message}</p>
                                  <span className="text-xs text-slate-450 block font-mono mt-1">{notif.timestamp}</span>
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
          </div>
        </div>
        
        {/* ========== TEACHER DASHBOARD HOME ========== */}
        {activeTab === 'dashboard' && (
          <div id="panel-teacher-home" className="space-y-8 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            {/* Header Block */}
            <div className="bg-gradient-to-br from-slate-900 via-teal-900 to-slate-900 rounded-3xl shadow-xl shadow-teal-100 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 overflow-hidden relative">
              <div className="absolute -top-16 -right-16 w-64 h-64 bg-teal-500/20 rounded-full blur-3xl pointer-events-none"></div>
              <div className="absolute -bottom-20 -left-10 w-64 h-64 bg-teal-400/20 rounded-full blur-3xl pointer-events-none"></div>
              <div className="relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-teal-300 mb-1">Welcome back, Faculty</p>
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight font-display uppercase">{userSession.name}</h1>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <div className="px-2.5 py-1 bg-white/10 text-amber-300 text-xs font-bold uppercase tracking-wider border border-white/10 rounded-full backdrop-blur-sm">
                    Faculty Member
                  </div>
                  <div className="w-1 h-1 rounded-full bg-white/30"></div>
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-tight">
                    {teacherSubject}
                  </span>
                  {myClasses.some(c => c.classTeacherId === teacherId) && (
                    <>
                      <div className="w-1 h-1 rounded-full bg-white/30"></div>
                      <span className="text-xs font-bold text-amber-300 uppercase tracking-tight">
                        Class Incharge: {myClasses.find(c => c.classTeacherId === teacherId)?.className}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {myClasses.some(c => c.classTeacherId === teacherId) && (
                (() => {
                  const mc = myClasses.find(c => c.classTeacherId === teacherId);
                  return (
                    <div className="relative z-10 p-4 bg-white/10 rounded-2xl border border-white/10 backdrop-blur-sm flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                        <UserCheck className="text-amber-300 shrink-0" size={20} />
                      </div>
                      <div>
                        <h4 className="text-[10px] font-extrabold text-slate-300 uppercase tracking-wider">My Designated Class</h4>
                        <p className="text-sm text-white font-bold mt-0.5">{mc?.className} - {mc?.section}</p>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>

            {/* ========== DAILY REMINDER & AGENDA PORTAL ========== */}
            <div id="daily-reminder-board" className="bg-white border border-slate-200 shadow-sm rounded-3xl p-6 space-y-5 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50/40 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none"></div>
              
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-100 pb-4 relative z-10">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-teal-50 text-teal-600 rounded-xl border border-teal-100">
                    <Bell size={20} className="animate-pulse" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider font-display flex items-center gap-2">
                      Daily Reminder & Agenda (Daily Tasks)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Operational checklist for <strong className="text-slate-700">{currentDayName}</strong> based on active date: <span className="font-mono text-teal-600 font-bold">{attendanceDate}</span>
                    </p>
                  </div>
                </div>

                {/* Overall status pills */}
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                  <span className="bg-slate-100 text-slate-705 px-2.5 py-1 font-bold">
                    📅 {currentDayName} Schedule
                  </span>
                  {pendingCount > 0 ? (
                    <span className="bg-amber-500 text-slate-950 font-extrabold px-2.5 py-1 uppercase tracking-wider flex items-center gap-1">
                      ⚠️ {pendingCount} Pending Roll Call{pendingCount > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="bg-amber-600 text-white font-extrabold px-2.5 py-1 uppercase tracking-wider flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> Ready & Cleared
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
                {/* Left Side: Today's Lectures (7 cols) */}
                <div className="lg:col-span-7 space-y-3.5 border-r border-slate-100 pr-0 lg:pr-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider flex items-center gap-1.5">
                      <CalendarDays size={14} className="text-teal-600" />
                      Class Lectures scheduled today ({todayClasses.length})
                    </h3>
                    <span className="text-xs text-teal-500 font-bold uppercase tracking-wider">Timetabled Lectures</span>
                  </div>

                  {todayClasses.length === 0 ? (
                    <div className="bg-slate-50 border border-slate-100 p-6 text-center text-slate-500 rounded-xl text-xs">
                      ☕ No formal lectures assigned to your ID under <strong>{currentDayName}</strong>. 
                      <p className="mt-1.5 text-xs text-slate-400">Great opportunity to review grading portfolios or coordinate with fellow faculty members!</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                      {todayClasses.map((lecture) => {
                        const clsObj = classes.find(c => c.id === lecture.classId);
                        const isMentor = clsObj?.classTeacherId === teacherId;

                        return (
                          <div key={lecture.id} className="bg-slate-50 hover:bg-slate-100/80 border border-slate-150 p-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 transition-colors rounded-xl">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="bg-teal-100 text-teal-800 text-xs font-black uppercase tracking-wider px-2 py-0.5 font-mono">
                                  {lecture.period}
                                </span>
                                <h4 className="text-xs font-black uppercase text-slate-800 flex items-center gap-1">
                                  🏫 {getClassLabel(lecture.classId)}
                                </h4>
                                {isMentor && (
                                  <span className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 font-bold">
                                    Primary Mentor
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 font-bold">
                                Subject: <span className="text-teal-900">{lecture.subject}</span>
                              </p>
                            </div>

                            <div className="text-right self-end md:self-auto">
                              <span className="text-xs font-mono font-bold bg-white text-slate-700 border border-slate-200 px-2.5 py-1">
                                🕒 {lecture.time}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Right Side: Attendance Checklist Tasks (5 cols) */}
                <div className="lg:col-span-5 space-y-3.5 flex flex-col justify-between">
                  <div className="space-y-3.5">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs font-black uppercase text-slate-900 tracking-wider flex items-center gap-1.5">
                        <ListTodo size={14} className="text-amber-600" />
                        Today's Attendance Checklist ({attendanceStatusList.length})
                      </h3>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          <span className="text-xs font-black uppercase text-slate-500">Total P: {attendanceStatusList.reduce((acc, curr) => acc + curr.presentCount, 0)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                          <span className="text-xs font-black uppercase text-slate-500">Total A: {attendanceStatusList.reduce((acc, curr) => acc + curr.absentCount, 0)}</span>
                        </div>
                        <span className="text-xs text-amber-600 font-bold uppercase tracking-wider">Verification Task</span>
                      </div>
                    </div>

                    {attendanceStatusList.length === 0 ? (
                      <div className="bg-slate-50 border border-slate-100 p-6 text-center text-slate-500 rounded-xl text-xs">
                        No assigned classroom cohorts requiring registers today.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {attendanceStatusList.map((item) => (
                          <div 
                            key={item.classId} 
                            className={`p-3.5 border transition-all flex justify-between items-center rounded-xl ${
                              item.marked 
                                ? 'bg-amber-50/40 border-amber-100/70 text-slate-700' 
                                : 'bg-rose-50/50 border-rose-100/70 text-slate-900'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-black uppercase text-slate-800">
                                  Class {item.className}
                                </h4>
                                {item.isMentorClass && (
                                  <span className="text-xs uppercase tracking-wider font-extrabold bg-teal-50 text-teal-600 px-1.5 border border-teal-100">
                                    My Cohort
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">
                                Total Pupils: <span className="font-bold text-slate-700">{item.studentCount}</span>
                                {item.marked && (
                                  <>
                                    <span className="mx-1">|</span>
                                    <span className="text-amber-600 font-bold">P: {item.presentCount}</span>
                                    <span className="mx-1">|</span>
                                    <span className="text-rose-600 font-bold">A: {item.absentCount}</span>
                                  </>
                                )}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              {item.marked ? (
                                <span className="text-xs font-mono font-extrabold text-amber-700 bg-amber-100/80 px-2 py-1 uppercase rounded-xl flex items-center gap-1">
                                  ✓ Logged
                                </span>
                              ) : (
                                <span className="text-xs font-mono font-extrabold text-rose-600 bg-rose-100/80 px-2 py-1 uppercase rounded-xl">
                                  ⚠️ Pending
                                </span>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  handleEnterAttendanceTab(item.classId, attendanceDate);
                                  handleTabChange('attendance');
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                className={`text-xs font-extrabold uppercase py-1.5 px-3 transition-all cursor-pointer ${
                                  item.marked
                                    ? 'bg-slate-150 hover:bg-slate-200 text-slate-800'
                                    : 'bg-amber-600 hover:bg-amber-500 text-white font-extrabold shadow-sm'
                                }`}
                              >
                                {item.marked ? 'Re-edit' : 'Take Attendance'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {pendingCount > 0 && (
                    <div className="bg-amber-50 border border-amber-100 p-3 text-xs text-amber-950 font-mono font-medium leading-relaxed">
                      ⚠️ Remainder: Principal office sync expects all student attendance records to be updated and signed by 2:00 PM today.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ========== WEEKLY PERIOD SCHEDULE (HOME TAB) ========== */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-3xl p-6">
              <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-50 text-amber-600 border border-amber-100">
                    <Calendar size={20} />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider font-display">My Timetable</h2>
                    <p className="text-xs text-slate-500 mt-0.5 uppercase font-bold tracking-widest">Select a day to view its schedule</p>
                  </div>
                </div>
              </div>

              {/* Day Selector Chips */}
              <div className="flex flex-wrap items-center gap-2 mb-6">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest mr-1">Day:</span>
                {['all', ...DAYS].map(day => (
                  <button
                    key={day}
                    onClick={() => setTimetableDayFilter(day)}
                    className={`px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded-full border transition-all cursor-pointer ${
                      timetableDayFilter === day
                        ? day === 'all'
                          ? 'bg-teal-600 text-white border-teal-600 shadow-md'
                          : 'bg-amber-500 text-white border-amber-500 shadow-md'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {day === 'all' ? 'All Days' : day}
                  </button>
                ))}
              </div>

              <div className="space-y-8">
                {(timetableDayFilter === 'all' ? DAYS : [timetableDayFilter]).map(day => {
                  const dayPeriodsInRange = timetable
                    .filter(tt => tt.teacherId === teacherId && tt.day === day)
                    .sort((a, b) => PERIODS.indexOf(a.period) - PERIODS.indexOf(b.period));
                  
                  if (dayPeriodsInRange.length === 0) return null;

                  return (
                    <div key={day} className="animate-fade-in">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-xs font-black text-slate-900 uppercase tracking-[0.2em] bg-teal-600 text-white px-2 py-0.5">{day}</span>
                        <div className="h-px flex-1 bg-slate-100"></div>
                      </div>
                      <div className="grid grid-cols-2 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
                        {dayPeriodsInRange.map((entry) => {
                          const clsLabel = getClassLabel(entry.classId);
                          return (
                            <div key={entry.id} className="bg-white border border-slate-200 p-3 shadow-xs hover:border-amber-300 hover:shadow-md transition-all flex flex-col justify-between group rounded-xl">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-black text-amber-600 uppercase tracking-tighter bg-amber-50 px-1 border border-amber-100">
                                  {entry.period}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs font-black text-slate-900 leading-tight group-hover:text-amber-700 transition-colors uppercase ">{entry.subject}</p>
                                <p className="text-xs text-slate-500 font-bold uppercase tracking-tight mt-0.5">{clsLabel}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {(timetableDayFilter === 'all' ? timetable : timetable.filter(tt => tt.day === timetableDayFilter)).filter(tt => tt.teacherId === teacherId).length === 0 && (
                  <div className="py-12 text-center">
                    <p className="text-xs font-bold text-slate-400 uppercase ">No sessions assigned in global timetable yet.</p>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-2 gap-3 sm:gap-6">
              
              <div 
                onClick={() => {
                  handleEnterAttendanceTab(classId || myClasses[0]?.id || '', attendanceDate);
                  handleTabChange('attendance');
                }}
                className="bg-white p-6 rounded-2xl border border-amber-100 shadow-sm hover:shadow-md hover:border-amber-300 hover:-translate-y-0.5 transition-all cursor-pointer group"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white flex items-center justify-center mb-4 shadow-lg shadow-amber-100 group-hover:scale-110 transition-transform">
                  <CheckSquare size={20} />
                </div>
                <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide font-display">Mark Attendance</h3>
                <p className="text-xs text-slate-500 mt-1">Log present or absent indices for pupils on a selected calendar day.</p>
              </div>

              <div 
                onClick={() => {
                  handleEnterMarksTab(classId || myClasses[0]?.id || '', selectedSubject, selectedExamType);
                  handleTabChange('marks');
                }}
                className="bg-white p-6 rounded-2xl border border-teal-100 shadow-sm hover:shadow-md hover:border-teal-300 hover:-translate-y-0.5 transition-all cursor-pointer group"
              >
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 text-white flex items-center justify-center mb-4 shadow-lg shadow-teal-100 group-hover:scale-110 transition-transform">
                  <Award size={20} />
                </div>
                <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide font-display">Configure Scores</h3>
                <p className="text-xs text-slate-500 mt-1">Commend academic marks for Unit Tests, Mid-Year cycle, and Final exams.</p>
              </div>

            </div>

            {/* Password Modal */}
            <AnimatePresence>
              {showPasswordModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="bg-white w-full max-w-md border border-slate-200 p-8 shadow-2xl relative"
                  >
                    <button 
                      onClick={() => setShowPasswordModal(false)}
                      className="absolute top-4 right-4 text-slate-400 hover:text-slate-900"
                    >
                      <X size={20} />
                    </button>

                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 bg-slate-100 rounded-xl border border-slate-200">
                        <Menu size={20} className="text-slate-900" />
                      </div>
                      <div>
                        <h2 className="text-lg font-black uppercase tracking-tight text-slate-900">Update Credentials</h2>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Portal Access Security</p>
                      </div>
                    </div>


                    <div className="space-y-6">
                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-widest text-slate-400 block">Current ID</label>
                        <input 
                          type="text" 
                          disabled 
                          value={userSession.username || 'user_id'} 
                          className="w-full bg-slate-50 border border-slate-100 px-3 py-2 text-xs font-bold text-slate-400 cursor-not-allowed" 
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-black uppercase tracking-widest text-slate-400 block">New Password</label>
                        <input 
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-white border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-900" 
                        />
                        <p className="text-xs text-slate-400 ">Minimum 8 characters recommended for robust security.</p>
                      </div>

                      <button
                        onClick={() => {
                          if (newPassword.length < 4) {
                            toast.error('Password must be at least 4 characters long.');
                            return;
                          }
                          
                          // Update password logic
                          setTeachers(prev => prev.map(t => 
                            t.id === userSession.id ? { ...t, password: newPassword } : t
                          ));
                          
                          toast.success('Password updated successfully! Next login requires new credentials.');
                          setShowPasswordModal(false);
                        }}
                        className="w-full bg-teal-600 text-white font-black uppercase tracking-widest py-3 rounded-xl hover:bg-teal-700 transition-all text-xs"
                      >
                        Commit Changes
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Quick Summary overview info */}
            <div className="bg-white text-slate-600 rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
              <div className="flex items-center gap-3">
                <Info size={18} className="text-amber-600 shrink-0" />
                <p className="text-xs text-slate-500 font-sans">
                  You are editing simulated data. This app uses <strong>Indexed Storage (localStorage)</strong>. You can safely simulate different dates, record marks, and re-login as a student to see the changes update in real time.
                </p>
              </div>
            </div>

          {/* Quick Diary Card on Home */}
            <div className="bg-white border border-teal-100 shadow-sm rounded-2xl overflow-hidden">
              <div className="bg-gradient-to-r from-amber-600 to-teal-700 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-white">
                  <ClipboardList size={18} />
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-widest leading-none">Quick Diary</h3>
                    <p className="text-[10px] font-bold text-amber-100 mt-1 uppercase tracking-wider">Post an assignment to your class students</p>
                  </div>
                </div>
                <button
                  onClick={() => { handleTabChange('diary'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="text-[10px] font-black uppercase tracking-widest bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                >
                  Full Diary
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Class</label>
                    <select
                      value={diaryClassId}
                      onChange={(e) => setDiaryClassId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-2.5 text-xs font-bold outline-none transition-all rounded-lg cursor-pointer"
                    >
                      {myClasses.length === 0 && <option value="">No assigned classes</option>}
                      {myClasses.map(c => (
                        <option key={c.id} value={c.id}>{c.className}-{c.section}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Subject</label>
                    <input
                      type="text"
                      placeholder={teacherSubject || 'e.g. Mathematics'}
                      value={diarySubject}
                      onChange={(e) => setDiarySubject(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-2.5 text-xs font-bold outline-none transition-all rounded-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Due Date</label>
                    <input
                      type="date"
                      value={diaryDueDate}
                      onChange={(e) => setDiaryDueDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-2.5 text-xs font-bold outline-none transition-all rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Assignment Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Chapter 5 Exercise Questions"
                    value={diaryTitle}
                    onChange={(e) => setDiaryTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-2.5 text-xs font-bold outline-none transition-all rounded-lg"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Instructions / Details</label>
                  <textarea
                    rows={2}
                    placeholder="Write the assignment details, page numbers, or submission instructions..."
                    value={diaryDescription}
                    onChange={(e) => setDiaryDescription(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-2.5 text-xs font-bold outline-none transition-all rounded-lg resize-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1.5">
                    <ClipboardList size={12} /> {myAssignments.length} Posted
                  </span>
                  <button
                    onClick={handleCreateAssignment}
                    className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg shadow-amber-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send size={13} /> Publish Assignment
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ========== STUDENTS ROSTER VIEW ========== */}
        {activeTab === 'students' && (
          <div id="panel-teacher-students" className="space-y-6 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">My Students Roster</h1>
              </div>
              
              {/* Select Classroom */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500">Classroom:</span>
                <select
                  id="teacher-students-class-select"
                  value={activeClassId}
                  onChange={(e) => setActiveClassId(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none"
                >
                  {myClasses.map(cl => (
                    <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Students roster table */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="p-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Students in {viewClass ? `${viewClass.className} - ${viewClass.section}` : 'N/A'}
                </h3>
                <span className="text-xs bg-slate-200 text-slate-800 font-bold px-2 py-0.5 rounded">
                  {viewClassStudents.length} Assigned Pupils
                </span>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-50/20">
                      <th className="px-6 py-3 w-20">Roll #</th>
                      <th className="px-6 py-3">Student Name</th>
                      <th className="px-6 py-3">Contact parent Phone</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {viewClassStudents.length > 0 ? (
                      viewClassStudents.map(s => (
                        <tr key={s.id} className="hover:bg-gray-50/40 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-gray-700">#{s.rollNumber}</td>
                          <td className="px-6 py-4 flex items-center gap-3">
                            {s.photo ? (
                              <img src={s.photo} alt={s.name} className="w-8 h-8 rounded-full object-cover border border-slate-200" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200">
                                <Users size={12} />
                              </div>
                            )}
                            <span className="font-semibold text-slate-900">{s.name.split(' ').slice(0, 1).join(' ') || s.name}</span>
                          </td>
                          <td className="px-6 py-4 text-xs font-mono text-gray-500">{s.parentPhone}</td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => {
                                setSelectedStudentProfile(s);
                                setShowProfileModal(true);
                                setProfileMarkSubject(teacherSubject);
                              }}
                              className="px-4 py-1.5 bg-teal-50 text-teal-600 hover:bg-teal-600 hover:text-white border border-teal-100 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-sm"
                            >
                              Profile
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-12 text-center text-gray-400 text-sm ">
                          No student profiles enrolled inside this class register.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========== MARK DAILY ATTENDANCE ========== */}
        {activeTab === 'attendance' && (
          <div id="panel-teacher-attendance" className="space-y-6 animate-fade-in bg-rose-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-rose-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Mark Daily Attendance</h1>
              </div>

              {/* Class & Date Controls */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">Class:</span>
                  <select
                    id="attendance-class-select"
                    value={activeClassId}
                    onChange={(e) => handleEnterAttendanceTab(e.target.value, attendanceDate)}
                    className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-slate-800"
                  >
                    {myClasses.map(cl => (
                      <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500">Log Date:</span>
                  <input
                    id="attendance-date-input"
                    type="date"
                    value={attendanceDate}
                    onChange={(e) => handleEnterAttendanceTab(activeClassId, e.target.value)}
                    className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-bold text-slate-800"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-200 pb-2 font-sans">
              <div className="relative">
                <select
                  value={attendanceMode}
                  onChange={(e) => {
                    const mode = e.target.value as 'grid' | 'list' | 'swipe';
                    setAttendanceMode(mode);
                    if (mode === 'swipe') setActiveSwipeIndex(0);
                  }}
                  className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 cursor-pointer shadow-sm"
                >
                  <option value="grid">🎴 Student Cards Grid</option>
                  <option value="list">📋 Spreadsheet List</option>
                  <option value="swipe">✨ Swipe Card Mode</option>
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Notification */}

            {/* Conditional Views: Grid Cards vs List vs Swipe */}
            {attendanceMode === 'grid' ? (
              /* CARD GRID ATTENDANCE VIEW */
              <div className="space-y-4">
                {/* Batch Actions Bar */}
                {viewClassStudents.length > 0 && (
                  <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Batch Mark:</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated: { [id: string]: 'present' | 'absent' | 'late' | 'leave' } = { ...scratchAttendance };
                          viewClassStudents.forEach(s => { updated[s.id] = 'present'; });
                          setScratchAttendance(updated);
                          toast.success("Marked all students as Present");
                        }}
                        className="px-2.5 py-1 bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all border border-amber-200"
                      >
                        ✅ All Present
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const updated: { [id: string]: 'present' | 'absent' | 'late' | 'leave' } = { ...scratchAttendance };
                          viewClassStudents.forEach(s => { updated[s.id] = 'absent'; });
                          setScratchAttendance(updated);
                          toast.success("Marked all students as Absent");
                        }}
                        className="px-2.5 py-1 bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white rounded-lg text-xs font-black uppercase tracking-wider transition-all border border-rose-200"
                      >
                        ❌ All Absent
                      </button>
                    </div>

                    <button
                      id="save-attendance-btn-grid"
                      onClick={handleSaveAttendance}
                      className="flex items-center gap-2 py-2 px-5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold tracking-wide shadow-md transition-all cursor-pointer ml-auto"
                    >
                      <Save size={14} />
                      Save & Commit Attendance
                    </button>
                  </div>
                )}

                {/* Grid of Student Cards */}
                {viewClassStudents.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {viewClassStudents.map(student => {
                      const status = scratchAttendance[student.id] || 'present';
                      const photoUrl = getStudentPhoto(student);
                      const feeSummary = studentFeesSummaryMap.get(String(student.id));
                      const totalPaid = feeSummary?.totalPaid || 0;
                      const isPaid = totalPaid >= (student.baseFee || 5000);

                      return (
                        <div 
                          key={student.id} 
                          className={`bg-white border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden ${
                            status === 'present' ? 'border-amber-200 bg-amber-50/10' :
                            status === 'absent' ? 'border-rose-200 bg-rose-50/10' :
                            status === 'late' ? 'border-amber-200 bg-amber-50/10' :
                            'border-teal-200 bg-teal-50/10'
                          }`}
                        >
                          {/* Card Header: Roll & Status Badge */}
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                              Roll #{student.rollNumber}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-xs font-black uppercase tracking-wider border ${
                              status === "present" ? "bg-amber-600 text-white font-black shadow-xs" : status === "absent" ? "bg-rose-600 text-white font-black shadow-xs animate-pulse" : status === "late" ? "bg-amber-500 text-white font-black shadow-xs" : "bg-teal-600 text-white font-black shadow-xs"
                            }`}>
                              {status.toUpperCase()}
                            </span>
                          </div>

                          {/* Student Photo & Details */}
                          <div className="text-center my-2">
                            <div className="relative w-20 h-20 mx-auto mb-3">
                              {photoUrl ? (
                                <img 
                                  src={photoUrl} 
                                  alt={student.name} 
                                  className="w-20 h-20 rounded-2xl object-cover border-2 border-teal-200 shadow-md bg-slate-100" 
                                />
                              ) : (
                                <div className="w-20 h-20 rounded-2xl border-2 border-teal-200 bg-slate-50 shadow-inner mx-auto" />
                              )}
                              <span className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold border-2 border-white shadow-xs ${
                                status === 'present' ? 'bg-amber-500' :
                                status === 'absent' ? 'bg-rose-500' :
                                status === 'late' ? 'bg-amber-500' :
                                'bg-teal-500'
                              }`}>
                                {status === 'present' ? 'P' : status === 'absent' ? 'A' : status === 'late' ? 'L' : 'LV'}
                              </span>
                            </div>

                            <h4 className="font-black text-slate-900 text-base tracking-tight truncate">{student.name}</h4>
                            <p className="text-xs text-slate-400 font-mono truncate">{student.email}</p>

                            <div className="mt-2 flex justify-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-black uppercase tracking-widest border ${
                                isPaid 
                                  ? 'bg-amber-50 text-amber-600 border-amber-200' 
                                  : 'bg-amber-50 text-amber-600 border-amber-200'
                              }`}>
                                {isPaid ? 'Fee Paid' : 'Fee Pending'}
                              </span>
                            </div>
                          </div>

                          {/* Attendance Status Toggle Buttons */}
                          <div className="grid grid-cols-4 gap-1 mt-4 pt-3 border-t border-slate-100">
                            {(['present', 'absent', 'late', 'leave'] as const).map((st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => handleSetStatus(student.id, st)}
                                className={`py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                                  status === st
                                    ? st === 'present' ? 'bg-amber-600 text-white shadow-sm' :
                                      st === 'absent' ? 'bg-rose-600 text-white shadow-sm' :
                                      st === 'late' ? 'bg-amber-500 text-white shadow-sm' :
                                      'bg-teal-600 text-white shadow-sm'
                                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
                                }`}
                              >
                                {st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'late' ? 'L' : 'LV'}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-12 text-center bg-white border border-slate-200 rounded-2xl text-slate-400  font-medium">
                    No students enrolled in this class group.
                  </div>
                )}

                {/* Bottom Save Action */}
                {viewClassStudents.length > 0 && (
                  <div className="p-4 bg-white border border-slate-200 rounded-2xl flex justify-end shadow-xs">
                    <button
                      onClick={handleSaveAttendance}
                      className="flex items-center gap-2 py-2.5 px-6 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold tracking-wide shadow-md transition-all cursor-pointer"
                    >
                      <Save size={14} />
                      Commit and Save Attendance Logs
                    </button>
                  </div>
                )}
              </div>
            ) : attendanceMode === 'list' ? (
              /* Attendance Roster list panel */
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50">
                        <th className="px-6 py-4 w-28">Roll #</th>
                        <th className="px-6 py-4">Student Profile</th>
                        <th className="px-6 py-4 text-center">Status Toggle</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-150 text-sm">
                      {viewClassStudents.length > 0 ? (
                        viewClassStudents.map(student => {
                          const status = scratchAttendance[student.id] || 'present';
                          const photoUrl = getStudentPhoto(student);
                          return (
                            <tr key={student.id} className="hover:bg-gray-50/20">
                              <td className="px-6 py-4 font-mono text-gray-700 font-bold">#{student.rollNumber}</td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  {photoUrl ? (
                                    <img src={photoUrl} alt={student.name} className="w-8 h-8 rounded-full object-cover border border-slate-200 bg-slate-100" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full border border-slate-200 bg-slate-50" />
                                  )}
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold text-slate-900 block text-sm">{student.name}</span>
                                      {(() => {
                                        const studentFees = fees.filter(f => f.studentId === student.id);
                                        const totalPaid = studentFees.reduce((acc, curr) => acc + curr.amount, 0);
                                        const isPaid = totalPaid >= 5000; // Assuming 5000 is the target for this month
                                        return (
                                          <button 
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleTabChange('fees');
                                            }}
                                            className={`px-1.5 py-0.5 rounded-xl text-[10px] font-black uppercase tracking-tighter border transition-all ${
                                              isPaid 
                                                ? 'bg-amber-50 text-amber-600 border-amber-100' 
                                                : 'bg-amber-50 text-amber-600 border-amber-100 animate-pulse'
                                            }`}
                                          >
                                            {isPaid ? 'Fee Paid' : 'Fee Pending'}
                                          </button>
                                        );
                                      })()}
                                    </div>
                                    <span className="text-xs text-gray-400 font-mono">{student.email}</span>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center justify-center gap-1.5 p-1 bg-gray-100/50 rounded-xl">
                                  {(['present', 'absent', 'late', 'leave'] as const).map((st) => (
                                    <button
                                      key={st}
                                      type="button"
                                      onClick={() => handleSetStatus(student.id, st)}
                                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                                        status === st
                                          ? st === "present" ? "bg-amber-600 text-white font-bold shadow-md" : st === "absent" ? "bg-rose-600 text-white font-bold shadow-md animate-pulse" : st === "late" ? "bg-amber-500 text-white font-bold shadow-md" : "bg-teal-600 text-white font-bold shadow-md"
                                          : 'text-gray-400 hover:text-gray-900 hover:bg-white'
                                      }`}
                                    >
                                      {st === 'present' ? 'P' : st === 'absent' ? 'A' : st === 'late' ? 'L' : 'LV'}
                                    </button>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-gray-400 text-sm  font-medium">
                            No student profiles enrolled inside the class scope.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {viewClassStudents.length > 0 && (
                  <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                    <button
                      id="save-attendance-btn"
                      onClick={handleSaveAttendance}
                      className="flex items-center gap-2 py-2 px-5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold tracking-wide shadow-sm transition-all cursor-pointer"
                    >
                      <Save size={14} />
                      Commit and Save Attendance Logs
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 font-sans">
                {viewClassStudents.length > 0 ? (
                  activeSwipeIndex < viewClassStudents.length ? (
                    (() => {
                      const currentStudent = viewClassStudents[activeSwipeIndex];
                      const currentStatus = scratchAttendance[currentStudent.id] || 'present';
                      const photoUrl = getStudentPhoto(currentStudent);

                      return (
                        <div className="w-full max-w-sm space-y-5">
                          {/* Progress indicators */}
                          <div className="flex justify-between items-center text-xs text-slate-600 font-bold px-1">
                            <span>Student {activeSwipeIndex + 1} of {viewClassStudents.length}</span>
                            <span className="font-mono bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-full text-xs font-bold border border-teal-100">
                              {Math.round((activeSwipeIndex / viewClassStudents.length) * 100)}% Complete
                            </span>
                          </div>
                          
                          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-teal-600 h-full transition-all duration-300 rounded-full" 
                              style={{ width: `${((activeSwipeIndex + 1) / viewClassStudents.length) * 100}%` }}
                            ></div>
                          </div>

                          {/* Tinder-style Card Stage */}
                          <div className="relative h-[22rem] w-full flex items-center justify-center bg-slate-100/70 border-2 border-dashed border-slate-200 p-3 rounded-3xl overflow-hidden">
                            <AnimatePresence mode="popLayout">
                              <motion.div
                                key={currentStudent.id}
                                drag="x"
                                dragConstraints={{ left: -160, right: 160 }}
                                onDragEnd={(event, info) => {
                                  if (info.offset.x > 100) {
                                    // Swipe right -> Present
                                    setScratchAttendance(prev => ({ ...prev, [currentStudent.id]: 'present' }));
                                    setActiveSwipeIndex(idx => idx + 1);
                                    toast.success(`Marked ${currentStudent.name} as Present`);
                                  } else if (info.offset.x < -100) {
                                    // Swipe left -> Absent
                                    setScratchAttendance(prev => ({ ...prev, [currentStudent.id]: 'absent' }));
                                    setActiveSwipeIndex(idx => idx + 1);
                                    toast.error(`Marked ${currentStudent.name} as Absent`);
                                  }
                                }}
                                whileTap={{ scale: 1.02 }}
                                initial={{ scale: 0.92, y: 15, opacity: 0 }}
                                animate={{ scale: 1, y: 0, opacity: 1 }}
                                exit={{
                                  x: scratchAttendance[currentStudent.id] === 'present' ? 260 : -260,
                                  opacity: 0,
                                  scale: 0.9,
                                  rotate: scratchAttendance[currentStudent.id] === 'present' ? 15 : -15
                                }}
                                transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                                className="bg-white border border-slate-200/90 shadow-xl p-5 rounded-3xl w-full h-80 flex flex-col justify-between cursor-grab active:cursor-grabbing text-slate-800 relative select-none"
                              >
                                <div>
                                  <div className="flex justify-between items-center">
                                    <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                                      Roll #{currentStudent.rollNumber}
                                    </span>
                                    <span className="text-xs text-teal-600 font-bold uppercase tracking-wider bg-teal-50 px-2 py-0.5 rounded-md">
                                      👈 Swipe Left (A) | Swipe Right (P) 👉
                                    </span>
                                  </div>

                                  <div className="text-center mt-3">
                                    <div className="relative w-24 h-24 mx-auto mb-2">
                                      {photoUrl ? (
                                        <img 
                                          src={photoUrl} 
                                          alt={currentStudent.name} 
                                          className="w-24 h-24 rounded-2xl object-cover border-2 border-teal-200 shadow-md bg-slate-100" 
                                        />
                                      ) : (
                                        <div className="w-24 h-24 rounded-2xl border-2 border-teal-200 bg-slate-50 shadow-inner mx-auto" />
                                      )}
                                    </div>
                                    <h3 className="text-lg font-black text-slate-900 tracking-tight leading-tight">{currentStudent.name}</h3>
                                    <p className="text-xs text-slate-400 font-mono mt-0.5">{currentStudent.email}</p>
                                  </div>
                                </div>

                                {/* Active Badge Indicator Hints inside card */}
                                <div className="flex items-center justify-between text-xs font-bold tracking-wider pt-3 border-t border-slate-100">
                                  <div className="text-rose-600 font-black flex items-center gap-1 bg-rose-50 px-2 py-1 rounded-lg border border-rose-100">
                                    👈 ABSENT
                                  </div>
                                  <span className="text-slate-400 text-xs uppercase font-semibold">Or tap buttons</span>
                                  <div className="text-amber-600 font-black flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
                                    PRESENT 👉
                                  </div>
                                </div>
                              </motion.div>
                            </AnimatePresence>
                          </div>

                          {/* Quick tap controls */}
                          <div className="grid grid-cols-4 gap-2 w-full font-sans">
                            {(['present', 'absent', 'late', 'leave'] as const).map((st) => (
                              <button
                                key={st}
                                type="button"
                                onClick={() => {
                                  handleSetStatus(currentStudent.id, st);
                                  setActiveSwipeIndex(idx => idx + 1);
                                }}
                                className={`py-3 text-xs font-black tracking-wider uppercase text-center rounded-xl transition-all border shadow-xs cursor-pointer ${
                                  st === 'present' ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-600 hover:text-white' :
                                  st === 'absent' ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-600 hover:text-white' :
                                  st === 'late' ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-600 hover:text-white' :
                                  'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-600 hover:text-white'
                                }`}
                              >
                                {st === 'present' ? '✅ Present' : st === 'absent' ? '❌ Absent' : st === 'late' ? '⏰ Late' : '📄 Leave'}
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              if (activeSwipeIndex > 0) setActiveSwipeIndex(idx => idx - 1);
                            }}
                            disabled={activeSwipeIndex === 0}
                            className="w-full py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 text-xs font-bold uppercase tracking-wider disabled:opacity-40 rounded-xl cursor-pointer"
                          >
                            ⏪ Rewind Previous Student
                          </button>
                        </div>
                      );
                    })()
                  ) : (
                    /* Swiped roster collection complete */
                    <div className="bg-white border border-slate-200 p-8 text-center rounded-3xl shadow-lg max-w-sm w-full space-y-6">
                      <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-2xl mx-auto shadow-inner">
                        ✓
                      </div>
                      <div>
                        <h3 className="text-xl font-black text-slate-900 tracking-tight">All Student Cards Swiped!</h3>
                        <p className="text-xs text-slate-500 mt-1">You have reviewed all student attendance records for this date.</p>
                      </div>

                      {/* Summary statistics */}
                      <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
                        <div>
                          <p className="text-xs font-bold text-amber-600 uppercase tracking-wider font-mono">Present</p>
                          <span className="text-2xl font-black text-amber-700">
                            {Object.values(scratchAttendance).filter(v => v === 'present').length}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-rose-500 uppercase tracking-wider font-mono">Absent</p>
                          <span className="text-2xl font-black text-rose-800">
                            {Object.values(scratchAttendance).filter(v => v === 'absent').length}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 font-sans">
                        <button
                          type="button"
                          onClick={handleSaveAttendance}
                          className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                        >
                          <Save size={16} /> Save & Commit Attendance
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveSwipeIndex(0)}
                          className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase transition-all cursor-pointer"
                        >
                          🔄 Review & Re-Swipe Cards
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="p-12 text-center text-slate-400 ">No students in this class.</div>
                )}
              </div>
            )}

            {/* ========== WHATSAPP ABSENT DISPATCH SERVICE ========== */}
            {(() => {
              const absentsList = viewClassStudents.filter(student => scratchAttendance[student.id] === 'absent');
              return (
                <div className="bg-gradient-to-br from-slate-900 to-teal-900 text-white p-5 rounded-xl border-l-4 border-amber-500 shadow-sm mt-8 space-y-4 font-sans border border-slate-750">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-widest text-amber-400 flex items-center gap-1.5 font-display">
                        📢 WhatsApp Absent Alert Center
                      </h3>
                      <p className="text-xs text-teal-200">
                        Prowl through absent registers on active date {attendanceDate} and execute direct manual alerts or auto rule models to parent contacts.
                      </p>
                    </div>
                    {absentsList.length > 0 && (
                      <div className="bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 flex items-center gap-2">
                         <span className="text-xs font-black text-amber-500 uppercase tracking-widest">Read-Only View</span>
                         <p className="text-xs text-slate-400 font-bold uppercase ">Absence alerts must be approved and dispatched by the school coordinator.</p>
                      </div>
                    )}
                  </div>

                  {absentsList.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {absentsList.map(st => {
                        return (
                          <div key={st.id} className="bg-white/5 border border-white/10 p-3.5 space-y-2 flex flex-col">
                            <div className="flex justify-between items-start border-b border-white/5 pb-2">
                              <h4 className="text-xs font-bold text-white uppercase">{st.name}</h4>
                              <span className="text-xs font-mono text-teal-300 font-bold bg-teal-500/10 px-1.5">Roll: #{st.rollNumber}</span>
                            </div>
                            <div className="pt-1">
                              <p className="text-xs text-slate-400 font-black uppercase tracking-widest">Parent Name</p>
                              <p className="text-xs text-amber-400 font-bold uppercase mt-0.5">{st.guardianName || 'Guardian'}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-850/50 border border-white/5 text-center text-xs text-slate-400 hover:text-white transition-all">
                      ★ Perfect Attendance Record for {viewClass?.className || 'Class Group'} on Date {attendanceDate}! No Parent pings necessary.
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        )}

        {/* ========== TEACHER DIARY / ASSIGNMENTS ========== */}
        {activeTab === 'diary' && (
          <div id="panel-teacher-diary" className="space-y-6 animate-fade-in bg-amber-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-amber-100 shadow-inner pb-20">
            <div className="bg-gradient-to-r from-amber-600 to-teal-700 p-6 sm:p-8 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-8 shadow-lg border-b border-amber-700/50 rounded-b-2xl text-white">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black tracking-tight font-display uppercase leading-none flex items-center gap-3">
                    <ClipboardList size={24} className="text-amber-200 shrink-0" />
                    Teacher Diary & Assignments
                  </h2>
                  <p className="text-xs text-amber-100 font-bold mt-2 uppercase tracking-widest">
                    Post homework instantly — visible only to the students of the selected class.
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-amber-900/40 backdrop-blur-sm px-4 py-2 rounded-xl border border-amber-400/20 text-xs font-bold">
                  <span className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
                  <span>{myAssignments.length} Posted</span>
                </div>
              </div>
            </div>

            {/* Assignment Creation Form */}
            <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
                <PlusCircle size={16} className="text-amber-600" />
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Post New Assignment</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Class</label>
                  <select
                    value={diaryClassId}
                    onChange={(e) => setDiaryClassId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-3 text-xs font-bold outline-none transition-all rounded-xl cursor-pointer"
                  >
                    {myClasses.length === 0 && <option value="">No assigned classes</option>}
                    {myClasses.map(c => (
                      <option key={c.id} value={c.id}>{c.className}-{c.section}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject</label>
                  <input
                    type="text"
                    placeholder={teacherSubject || 'e.g. Mathematics'}
                    value={diarySubject}
                    onChange={(e) => setDiarySubject(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-3 text-xs font-bold outline-none transition-all rounded-xl"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Due Date</label>
                  <input
                    type="date"
                    value={diaryDueDate}
                    onChange={(e) => setDiaryDueDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-3 text-xs font-bold outline-none transition-all rounded-xl"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Assignment Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Chapter 5 Exercise Questions"
                    value={diaryTitle}
                    onChange={(e) => setDiaryTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-3 text-xs font-bold outline-none transition-all rounded-xl"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">Instructions / Details</label>
                <textarea
                  rows={3}
                  placeholder="Write the assignment details, page numbers, or submission instructions here..."
                  value={diaryDescription}
                  onChange={(e) => setDiaryDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white p-3 text-xs font-bold outline-none transition-all rounded-xl resize-none"
                />
              </div>

              <button
                onClick={handleCreateAssignment}
                className="w-full sm:w-auto px-8 py-3.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-amber-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send size={14} /> Publish to Class Diary
              </button>
            </div>

            {/* Posted Assignments List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <ClipboardList size={14} /> My Posted Assignments
                </h3>
              </div>

              {myAssignments.length === 0 ? (
                <div className="py-14 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-white/60">
                  <ClipboardList size={32} className="mx-auto text-amber-400 mb-3 opacity-30" />
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No assignments posted yet</p>
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mt-1">Use the form above to publish homework to your class.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myAssignments.map(assn => {
                    const cls = classesMap.get(assn.classId);
                    const classNameStr = cls ? `${cls.className}-${cls.section}` : assn.classId;
                    const isOverdue = assn.dueDate && assn.dueDate < new Date().toISOString().split('T')[0];
                    return (
                      <div key={assn.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[9px] font-black uppercase tracking-widest">
                                {assn.subject}
                              </span>
                              <span className="px-2.5 py-1 bg-slate-50 text-slate-500 border border-slate-200 rounded-full text-[9px] font-black uppercase tracking-widest">
                                {classNameStr}
                              </span>
                            </div>
                            <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight leading-snug">{assn.title}</h4>
                            {assn.description && (
                              <p className="text-xs text-slate-500 font-medium leading-relaxed break-words whitespace-pre-wrap">{assn.description}</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteAssignment(assn.id)}
                            className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all shrink-0 cursor-pointer"
                            title="Delete assignment"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                          <div className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${isOverdue ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-teal-50 text-teal-600 border border-teal-100'}`}>
                            {isOverdue ? 'Overdue' : `Due: ${assn.dueDate}`}
                          </div>
                          <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">
                            Posted {assn.createdAt ? new Date(assn.createdAt).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== SUBJECT GRADES MANAGMENT ========== */}
        {activeTab === 'marks' && (
          <div id="panel-teacher-marks" className="space-y-6 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            {/* Sub-tab Switcher */}
            <div className="flex flex-wrap bg-white p-1 rounded-xl border border-teal-200 shadow-sm w-fit gap-1">
              <button
                onClick={() => setMarksSubTab('exam')}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer ${
                  marksSubTab === 'exam' ? 'bg-gradient-to-r from-teal-600 to-teal-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Award size={14} /> Exam Marks Entry
              </button>
              <button
                onClick={() => setMarksSubTab('report')}
                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 cursor-pointer ${
                  marksSubTab === 'report' ? 'bg-gradient-to-r from-teal-600 to-teal-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                <ClipboardList size={14} /> Report Card Builder
              </button>
            </div>

            {/* Quick CTA: New Result Card (setup exam/test + enter marks) — opens a fresh test */}
            <button
              onClick={() => { setCardExamName(''); setCardSubjects([]); setCardObtained({}); setCardStudentId(''); setMarksSubTab('report'); }}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-teal-600 to-teal-600 text-white font-black uppercase tracking-wider text-sm shadow-md hover:opacity-90 transition-all"
            >
              <Plus size={16} /> New Result Card — Setup Exam/Test & Enter Marks
            </button>

            {marksSubTab === 'exam' && (
              /* ========== EXAM MARKS ENTRY (bulk, any exam) ========== */
              <div id="teacher-exam-marks-builder" className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Exam Marks Entry</h1>
                  <p className="text-xs text-slate-500 mt-1 font-bold uppercase tracking-wider">
                    Enter marks for ALL students of the selected class for any exam — 1st / 2nd / 3rd Term, Annual, Monthly Test, or any custom name.
                  </p>
                </div>

                {/* Configuration Bar */}
                <div className="bg-white border border-teal-200 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Class</label>
                      <select
                        value={selectedMarkClassId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelectedMarkClassId(v);
                          if (v && selectedSubject.trim() && selectedExamType.trim()) {
                            handleEnterMarksTab(v, selectedSubject, selectedExamType);
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500"
                      >
                        <option value="">-- Choose Class --</option>
                        {myClasses.map(cl => (
                          <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Subject</label>
                      {selectedSubject !== '__manual__' ? (
                        <select
                          value={selectedSubject}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '__manual__') {
                              setManualSubjectInput('');
                              setSelectedSubject('__manual__');
                              return;
                            }
                            setSelectedSubject(v);
                            if (selectedMarkClassId && v.trim() && selectedExamType.trim()) {
                              handleEnterMarksTab(selectedMarkClassId, v, selectedExamType);
                            }
                          }}
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500"
                        >
                          <option value="">-- Choose Subject --</option>
                          {(() => {
                            const cs = selectedMarkClassId ? (classes.find(c => String(c.id) === String(selectedMarkClassId))?.subjects || []) : [];
                            const opts = cs.length > 0 ? cs : [teacherSubject, ...SUBJECT_OPTIONS.filter(s => s.toLowerCase() !== (teacherSubject || '').toLowerCase())];
                            return opts.map(sub => (
                              <option key={sub} value={sub}>{sub}</option>
                            ));
                          })()}
                          <option value="__manual__">➕ Add Manual Subject</option>
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={manualSubjectInput}
                            onChange={(e) => {
                              const v = e.target.value;
                              setManualSubjectInput(v);
                              setSelectedSubject(v.trim() ? v.trim() : '__manual__');
                            }}
                            onBlur={() => {
                              if (!manualSubjectInput.trim()) {
                                setSelectedSubject('');
                              } else if (selectedMarkClassId && selectedExamType.trim()) {
                                handleEnterMarksTab(selectedMarkClassId, manualSubjectInput.trim(), selectedExamType);
                              }
                            }}
                            placeholder="Type subject name (e.g. Quran, Art)"
                            className="w-full px-3 py-2 bg-white border border-teal-300 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500"
                          />
                          <button
                            type="button"
                            onClick={() => { setManualSubjectInput(''); setSelectedSubject(''); }}
                            className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-xs font-black uppercase transition-all cursor-pointer"
                            title="Back to list"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Exam Name</label>
                      <input
                        list="teacher-exam-names-list"
                        value={examNameDraft}
                        onChange={(e) => setExamNameDraft(e.target.value)}
                        placeholder="e.g. 1st Term / Annual"
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-teal-800 focus:outline-none focus:border-teal-500"
                      />
                      <datalist id="teacher-exam-names-list">
                        {EXAM_NAME_OPTIONS.map(opt => <option key={opt} value={opt} />)}
                      </datalist>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Total / Max Marks</label>
                      <input
                        type="number"
                        min="1"
                        value={maxMarksInput}
                        onChange={(e) => setMaxMarksInput(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-teal-500"
                      />
                    </div>

                    <div>
                      <button
                        onClick={() => {
                          if (!selectedMarkClassId) { toast.error('Please select a class first.'); return; }
                          if (!selectedSubject.trim()) { toast.error('Please select a subject.'); return; }
                          const exam = examNameDraft.trim() || 'Monthly Test';
                          setSelectedExamType(exam);
                          setExamNameDraft(exam);
                          handleEnterMarksTab(selectedMarkClassId, selectedSubject, exam);
                          toast.success(`Roster loaded for ${exam} — enter marks below`);
                        }}
                        className="w-full px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 rounded-lg text-xs font-black uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <RefreshCw size={14} /> Load Roster
                      </button>
                    </div>
                  </div>
                </div>

                {/* Saved Exams — long-press to Edit (roster reload) or Delete (removes all marks) */}
                {(() => {
                  const savedExams: { key: string; exam: string; subject: string; classId: string; count: number }[] = [];
                  const seen = new Set<string>();
                  marks.forEach(m => {
                    if (!m.examType || !m.subject) return;
                    const st = students.find(s => String(s.id) === String(m.studentId));
                    if (!st) return;
                    const key = `${m.examType}__${m.subject}__${st.classId}`;
                    if (seen.has(key)) return;
                    seen.add(key);
                    const count = marks.filter(x => (x.examType || '') === m.examType && (x.subject || '').toLowerCase() === (m.subject || '').toLowerCase() && students.some(s => String(s.id) === String(x.studentId) && s.classId === st.classId)).length;
                    savedExams.push({ key, exam: m.examType, subject: m.subject, classId: st.classId, count });
                  });
                  if (savedExams.length === 0) return null;
                  return (
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-4 space-y-2">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Award size={12} className="text-teal-500" /> Saved Exams — long-press to Edit / Delete
                      </h4>
                      {savedExams.map(se => {
                        const cls = classes.find(c => c.id === se.classId);
                        return (
                          <HoldActionWrapper
                            key={se.key}
                            onEdit={() => {
                              handleEnterMarksTab(se.classId, se.subject, se.exam as ExamType);
                              setExamNameDraft(se.exam);
                              toast.success(`Editing: ${se.exam} · ${se.subject} — roster loaded with existing marks`);
                            }}
                            onDelete={() => {
                              if (!window.confirm(`Delete ALL marks for "${se.exam} · ${se.subject}"?`)) return;
                              const removed = marks.filter(x => (x.examType || '') === se.exam && (x.subject || '').toLowerCase() === se.subject.toLowerCase() && students.some(s => String(s.id) === String(x.studentId) && s.classId === se.classId));
                              if (removed.length === 0) { toast.error('No marks found to delete.'); return; }
                              setMarks(prev => prev.filter(m => !removed.includes(m)));
                              syncMarksToFirestore(removed, []);
                              toast.success(`${removed.length} marks deleted.`);
                            }}
                            className="rounded-xl border border-slate-100"
                          >
                            <div className="px-3 py-2.5 flex items-center justify-between gap-2 cursor-pointer">
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-800 truncate">{se.exam}</p>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">{se.subject} · {cls ? `Class ${cls.className}${cls.section ? '-' + cls.section : ''}` : 'Class'}</p>
                              </div>
                              <span className="text-[10px] font-black text-teal-600 shrink-0">{se.count} marks</span>
                            </div>
                          </HoldActionWrapper>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Bulk Marks Table */}
                {(() => {
                  const examClassStudents = students.filter(s => s.classId === selectedMarkClassId);
                  const hasConfig = selectedMarkClassId && selectedSubject.trim() && selectedExamType.trim();

                  if (!hasConfig) {
                    return (
                      <div className="bg-white border text-center border-gray-200 p-12 rounded-2xl shadow-sm text-slate-500 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-300">
                          <Award size={24} />
                        </div>
                        <h3 className="text-sm font-bold text-slate-700">Configure the Exam First</h3>
                        <p className="text-xs text-slate-400 max-w-sm mx-auto mt-2 leading-relaxed">
                          Choose the class, subject and exam name (e.g. 1st Term, 2nd Term, 3rd Term, Annual, Monthly Test) then press Load Roster to begin entering marks.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
                      <div className="p-4 sm:p-5 border-b border-gray-100 bg-teal-50/50 flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-black text-teal-900 uppercase tracking-widest flex items-center gap-2">
                          <Award size={16} className="text-teal-600" /> {selectedExamType} Marks — {selectedSubject}
                        </h3>
                        <span className="text-xs font-black text-slate-500 uppercase tracking-wider bg-white border border-teal-100 px-3 py-1 rounded-full">
                          {examClassStudents.length} Student(s) · Total {maxMarksInput}
                        </span>
                      </div>

                      {/* MOBILE CARDS */}
                      <div className="block md:hidden divide-y divide-slate-100">
                        {examClassStudents.length === 0 ? (
                          <div className="py-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
                            No students enrolled in this class.
                          </div>
                        ) : (
                          examClassStudents.map((s, idx) => (
                            <div key={s.id} className="p-4 bg-white">
                              <div className="flex items-center justify-between gap-3 mb-2.5">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-xs font-black text-teal-500 w-6 shrink-0">#{idx + 1}</span>
                                  <div className="min-w-0">
                                    <h4 className="font-black text-slate-900 uppercase tracking-tight text-xs truncate">{s.name}</h4>
                                    <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">Roll #{s.rollNumber}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-slate-100">
                                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Obtained Marks</span>
                                <div className="flex items-center gap-2">
                                  {['absent', 'leave'].includes(getStudentAttendanceStatus(s.id, attendanceDate) || '') ? (
                                    <span className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-sm text-center font-extrabold text-rose-600 w-24">Absent</span>
                                  ) : (
                                    <input
                                      type="number"
                                      min="0"
                                      max={maxMarksInput > 0 ? maxMarksInput : undefined}
                                      value={scratchMarks[s.id] || ''}
                                      onChange={(e) => setScratchMarks(prev => ({ ...prev, [s.id]: e.target.value.replace(/^0+(?=\d)/, '') }))}
                                      placeholder="0"
                                      className="w-24 px-3 py-2 bg-teal-50 border border-teal-100 rounded-lg text-sm text-center font-extrabold text-teal-900 focus:outline-none focus:border-teal-500"
                                    />
                                  )}
                                  <span className="text-xs text-slate-400 font-bold">/ {maxMarksInput}</span>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* DESKTOP TABLE */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left">
                          <thead>
                            <tr className="border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50">
                              <th className="px-6 py-4 w-14">#</th>
                              <th className="px-6 py-4">Roll No</th>
                              <th className="px-6 py-4">Student</th>
                              <th className="px-6 py-4 text-center w-44">Obtained Marks</th>
                              <th className="px-6 py-4 text-center w-20">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-150 text-sm">
                            {examClassStudents.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm font-medium">
                                  No students enrolled in this class.
                                </td>
                              </tr>
                            ) : (
                              examClassStudents.map((s, idx) => (
                                <tr key={s.id} className="hover:bg-teal-50/20 transition-colors">
                                  <td className="px-6 py-3 text-xs font-black text-teal-500">{idx + 1}</td>
                                  <td className="px-6 py-3 text-xs font-mono font-bold text-slate-500">{s.rollNumber}</td>
                                  <td className="px-6 py-3 font-bold text-slate-900 uppercase tracking-tight">{s.name}</td>
                                  <td className="px-6 py-3 text-center">
                                    {['absent', 'leave'].includes(getStudentAttendanceStatus(s.id, attendanceDate) || '') ? (
                                      <span className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-sm text-center font-extrabold text-rose-600 inline-block">Absent</span>
                                    ) : (
                                      <input
                                        type="number"
                                        min="0"
                                        max={maxMarksInput > 0 ? maxMarksInput : undefined}
                                        value={scratchMarks[s.id] || ''}
                                        onChange={(e) => setScratchMarks(prev => ({ ...prev, [s.id]: e.target.value.replace(/^0+(?=\d)/, '') }))}
                                        placeholder="0"
                                        className="w-28 px-3 py-2 bg-teal-50 border border-teal-100 rounded-lg text-sm text-center font-extrabold text-teal-900 focus:outline-none focus:border-teal-500 inline-block"
                                      />
                                    )}
                                  </td>
                                  <td className="px-6 py-3 text-center text-xs font-black text-slate-500">{maxMarksInput}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="p-4 sm:p-5 border-t border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                          Exam: <span className="text-teal-700">{selectedExamType}</span> · Subject: <span className="text-teal-700">{selectedSubject}</span>
                        </div>
                        <button
                          onClick={handleSaveMarks}
                          className="px-8 py-3 bg-teal-600 text-white hover:bg-teal-700 rounded-lg text-xs font-black uppercase tracking-wider shadow-md transition-all flex items-center gap-2 cursor-pointer"
                        >
                          <Save size={14} /> Save {selectedExamType} Marks
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
             {false && ( /* legacy report-card builder disabled; replaced by unified flow below */
              <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Student Report Card Builder</h1>
              </div>

              {/* Filter tools */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-gray-500">Select Class:</span>
                  <select
                    id="marks-class-select"
                    value={selectedMarkClassId}
                    onChange={(e) => {
                      setSelectedMarkClassId(e.target.value);
                      setReportStudentId('');
                    }}
                    className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">-- Choose Class --</option>
                    {myClasses.map(cl => (
                      <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                    ))}
                  </select>
                </div>
                
                {selectedMarkClassId && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-gray-500">Select Student:</span>
                    <select
                      value={reportStudentId}
                      onChange={(e) => setReportStudentId(e.target.value)}
                      className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-teal-800 focus:outline-none focus:border-teal-500 w-48"
                    >
                      <option value="">-- Choose Student --</option>
                      {students.filter(s => s.classId === selectedMarkClassId).map(st => (
                        <option key={st.id} value={st.id}>{st.rollNumber} - {st.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {reportStudentId ? (() => {
              const student = students.find(s => s.id === reportStudentId);
              if (!student) return null;
              
              let totalObtained = 0;
              let totalMax = 0;
              reportSubjectsList.forEach(sj => {
                totalObtained += Number(sj.obtained) || 0;
                totalMax += Number(sj.maxMarks) || 0;
              });
              const overallPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;
              const whatsappText = `Greetings, Respected Parent! Report for ${student.name} (Roll: ${student.rollNumber}):

` + 
                reportSubjectsList.map(s => `- ${s.subject} (${s.ref}): ${s.obtained}/${s.maxMarks}`).join('\n') + 
                `

Total: ${totalObtained}/${totalMax} (${overallPct}%). Status: ${overallPct >= 40 ? 'PASS' : 'RE-STUDY'}`;

              return (
                <div className="space-y-6">
                  {/* Student + Exam Name Header */}
                  <div className="bg-gradient-to-r from-teal-600 to-teal-600 text-white p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.3em] opacity-80">Report Card For</p>
                      <h3 className="text-lg font-black uppercase tracking-tight leading-tight">{student.name}</h3>
                      <p className="text-xs opacity-90 mt-0.5">Roll #{student.rollNumber} · {classesMap.get(String(student.classId))?.className || 'N/A'}{classesMap.get(String(student.classId))?.section ? ` - ${classesMap.get(String(student.classId))?.section}` : ''}</p>
                    </div>
                    <div className="w-full sm:w-64">
                      <label className="block text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Exam / Assessment Name</label>
                      <input
                        type="text"
                        value={reportExamName}
                        onChange={(e) => setReportExamName(e.target.value)}
                        placeholder="e.g. 1st Term 2025"
                        className="w-full px-3 py-2 bg-white border border-white/30 rounded-lg text-sm font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>

                  {/* Add Subject Config Bar */}
                  <div className="bg-teal-50/50 border border-teal-100/50 rounded-xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="bg-teal-100 text-teal-700 p-1.5 rounded-lg"><Award size={16} /></div>
                      <h3 className="text-sm font-bold text-teal-900">Add Subject to Report</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-3 space-y-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Active Subject</label>
                        {reportSubjectToAdd !== 'Other' ? (
                          <select
                            value={reportSubjectToAdd}
                            onChange={(e) => setReportSubjectToAdd(e.target.value)}
                            className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-slate-950 focus:outline-none focus:border-teal-500"
                          >
                            <option value="">Select Subject</option>
                            <option value="English">English</option>
                            <option value="Mathematics">Mathematics</option>
                            <option value="Science">Science</option>
                            <option value="Urdu">Urdu</option>
                            <option value="Islamiat">Islamiat</option>
                            <option value="Computer">Computer</option>
                            <option value="Physics">Physics</option>
                            <option value="Chemistry">Chemistry</option>
                            <option value="Biology">Biology</option>
                            <option value="History">History</option>
                            <option value="Geography">Geography</option>
                            <option value="Other">➕ Manual Subject...</option>
                          </select>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={reportManualSubject}
                              onChange={(e) => setReportManualSubject(e.target.value)}
                              placeholder="Type subject name (e.g. Quran, Art)"
                              className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-lg text-xs font-semibold text-slate-950 focus:outline-none focus:border-teal-500"
                            />
                            <button
                              type="button"
                              onClick={() => { setReportManualSubject(''); setReportSubjectToAdd(''); }}
                              className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-xs font-black transition-all cursor-pointer"
                              title="Back to list"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="sm:col-span-4 space-y-1">
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Book / Test Reference</label>
                        <input
                          type="text"
                          value={reportRefToAdd}
                          onChange={(e) => setReportRefToAdd(e.target.value)}
                          placeholder="e.g. Oxford Book Ch 2, Mid Term"
                          className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-slate-950 focus:outline-none focus:border-teal-500"
                        />
                      </div>
                      
                      <div className="sm:col-span-5 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const finalSubject = reportSubjectToAdd === 'Other' ? reportManualSubject.trim() : reportSubjectToAdd.trim();
                            if (!finalSubject) { toast.error('Please enter a subject'); return; }
                            setReportSubjectsList([...reportSubjectsList, { 
                              id: Date.now().toString(), 
                              subject: finalSubject, 
                              ref: reportRefToAdd || 'General',
                              maxMarks: '100',
                              obtained: '0'
                            }]);
                            setReportSubjectToAdd('');
                            setReportManualSubject('');
                            setReportRefToAdd('');
                            toast.success('Subject row added below');
                          }}
                          className="py-1.5 px-4 bg-teal-600 text-white hover:bg-teal-700 rounded-lg text-xs font-bold uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
                        >
                          <Plus size={14} />
                          Add subject to Report
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Interactive Scores Board */}
                  <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
              {/* MOBILE CARD VIEW (< md) */}
              <div className="block md:hidden divide-y divide-slate-100">
                {viewClassStudents.length > 0 ? (
                  viewClassStudents.map(s => (
                    <div key={s.id} className="p-4 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          {s.photo ? (
                            <img src={s.photo} alt={s.name} className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0" />
                          ) : (
                            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200 shrink-0">
                              <Users size={16} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="font-black text-slate-900 uppercase tracking-tight text-sm truncate">{s.name}</h4>
                            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">Roll #{s.rollNumber}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            setSelectedStudentProfile(s);
                            setShowProfileModal(true);
                            setProfileMarkSubject(teacherSubject);
                          }}
                          className="shrink-0 px-3.5 py-2 bg-teal-50 text-teal-600 hover:bg-teal-600 hover:text-white border border-teal-100 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-sm"
                        >
                          Profile
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2.5 mt-2.5 border-t border-slate-100">
                        <span className="text-xs text-gray-500 truncate">{s.email || '—'}</span>
                        <span className="text-xs font-mono font-bold text-gray-600 shrink-0">{s.parentPhone}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 text-center text-gray-400 text-sm">
                    No student profiles enrolled inside this class register.
                  </div>
                )}
              </div>

              {/* DESKTOP ROSTER TABLE (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50">
                            <th className="px-6 py-4">Subject</th>
                            <th className="px-6 py-4">Assessment Reference</th>
                            <th className="px-6 py-4 text-center">Total Marks</th>
                            <th className="px-6 py-4 text-center">Obtained Marks</th>
                            <th className="px-4 py-4 text-center w-16">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-150 text-sm">
                          {reportSubjectsList.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm  font-medium">
                                No subjects added to this report card yet. Select a subject above and press Add.
                              </td>
                            </tr>
                          ) : (
                            reportSubjectsList.map((item, index) => (
                              <tr key={item.id} className="hover:bg-gray-50/20">
                                <td className="px-6 py-4">
                                  <span className="font-bold text-slate-900 block">{item.subject}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="text-xs text-gray-500">{item.ref}</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <input
                                    type="number"
                                    min="1"
                                    value={item.maxMarks}
                                    onChange={(e) => {
                                      const newList = [...reportSubjectsList];
                                      newList[index].maxMarks = e.target.value;
                                      setReportSubjectsList(newList);
                                    }}
                                    className="w-20 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-center font-bold text-slate-700 focus:outline-none focus:border-teal-500 inline-block"
                                  />
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <input
                                    type="number"
                                    min="0"
                                     value={item.obtained}
                                     onChange={(e) => {
                                       const newList = [...reportSubjectsList];
                                       newList[index].obtained = e.target.value.replace(/^0+(?=\d)/, '');
                                       setReportSubjectsList(newList);
                                     }}
                                    placeholder="0"
                                    className="w-20 px-3 py-1.5 bg-teal-50 border border-teal-100 rounded-lg text-sm text-center font-extrabold text-teal-900 focus:outline-none focus:border-teal-500 inline-block"
                                  />
                                </td>
                                <td className="px-4 py-4 text-center">
                                  <button onClick={() => {
                                    setReportSubjectsList(reportSubjectsList.filter(s => s.id !== item.id));
                                  }} className="text-gray-400 hover:text-red-500 transition-colors p-2">
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="border-t border-gray-100 p-4 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                        Total: <span className="text-teal-700 text-sm">{totalObtained}/{totalMax}</span> ({overallPct}%) ·{' '}
                        <span className={overallPct >= 40 ? 'text-amber-600' : 'text-rose-600'}>{overallPct >= 40 ? 'PASS' : 'RE-STUDY'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSaveReport}
                          disabled={reportSubjectsList.length === 0}
                          className="py-2 px-5 bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-black uppercase tracking-wider shadow-sm transition-all flex items-center gap-2"
                        >
                          <Save size={14} /> Save Report
                        </button>
                      </div>
                    </div>
                     </div>

                  {/* RESULT CARD PREVIEW */}
                  {reportSubjectsList.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                      <div className="bg-gradient-to-r from-teal-600 to-teal-600 text-white px-5 py-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-black uppercase tracking-wide">Result Card</h3>
                          <p className="text-xs opacity-90">{reportExamName.trim() || 'General Assessment'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] opacity-80 uppercase tracking-widest">Overall</p>
                          <p className="text-3xl font-black leading-none">{overallPct}%</p>
                        </div>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-widest bg-slate-50">
                            <th className="px-5 py-3">Subject</th>
                            <th className="px-5 py-3">Reference</th>
                            <th className="px-5 py-3 text-center">Marks</th>
                            <th className="px-5 py-3 text-center">Percentage</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {reportSubjectsList.map(sj => {
                            const rmax = Number(sj.maxMarks) || 0;
                            const rob = Number(sj.obtained) || 0;
                            const rpct = rmax > 0 ? Math.round((rob / rmax) * 100) : 0;
                            return (
                              <tr key={sj.id}>
                                <td className="px-5 py-3 font-bold text-slate-900">{sj.subject}</td>
                                <td className="px-5 py-3 text-xs text-slate-500">{sj.ref}</td>
                                <td className="px-5 py-3 text-center font-bold text-slate-700">{rob}/{rmax}</td>
                                <td className="px-5 py-3 text-center">
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-black ${rpct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{rpct}%</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 border-t border-slate-200">
                            <td colSpan={2} className="px-5 py-3 font-black text-slate-900 uppercase text-xs">Total</td>
                            <td className="px-5 py-3 text-center font-black text-slate-900">{totalObtained}/{totalMax}</td>
                            <td className="px-5 py-3 text-center font-black text-teal-700">{overallPct}%</td>
                          </tr>
                        </tfoot>
                      </table>
                      <div className="px-5 py-3 flex items-center justify-between bg-white border-t border-slate-100">
                        <span className={`text-sm font-black uppercase tracking-wider px-3 py-1 rounded-full ${overallPct >= 40 ? 'bg-amber-600 text-white' : 'bg-rose-600 text-white'}`}>{overallPct >= 40 ? 'PASS' : 'RE-STUDY'}</span>
                        <span className="text-xs text-slate-400">Generated from entered marks</span>
                      </div>
                    </div>
                  )}

                   </div>
                 );
                })() : (
               <div className="bg-white border text-center border-gray-200 p-12 rounded-2xl shadow-sm text-slate-500 flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-300">
                  <Award size={24} />
                </div>
                <h3 className="text-sm font-bold text-slate-700">No Student Selected</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-2 leading-relaxed">
                  Please select a class and then choose a student from the dropdown above to begin building their multi-subject report card.
                </p>
              </div>
             )}
             </>
             )}
               {marksSubTab === 'report' && (
               <div id="teacher-student-result-card" className="space-y-6">
                 <div>
                   <h1 className="text-2xl font-bold text-gray-900">Exam / Test Marks Entry</h1>
                   <p className="text-xs text-slate-500 mt-1 font-bold uppercase tracking-wider">First add the exam/test name and its subjects, then click a student to enter their marks for that complete test.</p>
                 </div>

                 {/* Step 1: Class + Exam/Test name */}
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="bg-teal-50/50 border border-teal-100/50 rounded-xl p-4 shadow-sm space-y-1">
                     <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Select Class</label>
                     <select
                       value={selectedMarkClassId}
                       onChange={(e) => { setSelectedMarkClassId(e.target.value); setCardStudentId(''); setCardObtained({}); }}
                       className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-slate-950 focus:outline-none focus:border-teal-500"
                     >
                       <option value="">-- Choose Class --</option>
                       {myClasses.map(cl => (
                         <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                       ))}
                     </select>
                   </div>
                   <div className="bg-teal-50/50 border border-teal-100/50 rounded-xl p-4 shadow-sm space-y-1">
                     <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Exam / Test Name</label>
                     <input
                       type="text"
                       value={cardExamName}
                       onChange={(e) => setCardExamName(e.target.value)}
                       placeholder="e.g. 1st Term 2025 / Weekly Test 3"
                       className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:border-teal-500"
                     />
                   </div>
                  </div>

                  {/* Saved Tests — view / reopen previously saved exams/tests */}
                  {selectedMarkClassId && (
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="bg-amber-100 text-amber-700 p-1.5 rounded-lg"><ClipboardList size={16} /></div>
                          <h3 className="text-sm font-bold text-slate-700">Saved Tests / Exams</h3>
                        </div>
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Click to open &amp; view marks</span>
                      </div>
                      {(() => {
                        const css = students.filter(s => String(s.classId) === String(selectedMarkClassId));
                        const classMarkIds = new Set(css.map(s => String(s.id)));
                        const testNames = Array.from(new Set(
                          marks.filter(m => classMarkIds.has(String(m.studentId))).map(m => m.examType)
                        )).filter(Boolean);
                        if (testNames.length === 0) {
                          return <p className="text-xs text-slate-400">No saved tests yet for this class. Create one above.</p>;
                        }
                        return (
                          <div className="flex flex-wrap gap-2">
                            {testNames.map(tn => {
                              const tMarks = marks.filter(m => m.examType === tn && classMarkIds.has(String(m.studentId)));
                              const subjCount = new Set(tMarks.map(m => m.subject)).size;
                              const marked = css.filter(s => tMarks.some(m => String(m.studentId) === String(s.id))).length;
                              return (
                                <button key={tn} type="button" onClick={() => {
                                  const subjMap: Record<string, number> = {};
                                  tMarks.forEach(m => { if (!(m.subject in subjMap)) subjMap[m.subject] = m.maxMarks; });
                                  const rec = Object.keys(subjMap).map((s, i) => ({ id: 'sv_' + i, subject: s, maxMarks: String(subjMap[s]) }));
                                  setCardExamName(tn); setCardSubjects(rec); setCardStudentId(''); setCardObtained({});
                                  toast.success('Opened saved test: ' + tn);
                                }} className="text-left bg-amber-50 border border-amber-100 hover:bg-amber-100 text-amber-700 text-xs font-bold px-3 py-2 rounded-xl flex flex-col gap-0.5">
                                  <span>{tn}</span>
                                  <span className="text-[10px] font-semibold text-amber-500">{subjCount} subjects · {marked}/{css.length} students</span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Step 2: Define subjects of the test */}
                 <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-4">
                   <div className="flex items-center gap-2">
                     <div className="bg-teal-100 text-teal-700 p-1.5 rounded-lg"><Award size={16} /></div>
                     <h3 className="text-sm font-bold text-teal-900">Test Subjects ({cardSubjects.length})</h3>
                   </div>
                   <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                     <div className="sm:col-span-5 space-y-1">
                       <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Subject</label>
                       {cardSubjectToAdd !== 'Other' ? (
                         <select value={cardSubjectToAdd} onChange={(e) => setCardSubjectToAdd(e.target.value)} className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-slate-950 focus:outline-none focus:border-teal-500">
                            <option value="">Select Subject</option>
                            {(() => {
                              const cs = selectedMarkClassId ? (classes.find(c => String(c.id) === String(selectedMarkClassId))?.subjects || []) : [];
                              const fallback = ['English','Mathematics','Urdu','Pakistan Studies','Islamiyat','Physics','Chemistry','Biology','History','Geography'];
                              const base = cs.length > 0 ? cs : fallback;
                              return base.filter(s => !cardSubjects.some(x => x.subject === s)).map(s => (
                                <option key={s} value={s}>{s}</option>
                              ));
                            })()}
                            <option value="Other">➕ Manual Subject...</option>
                         </select>
                       ) : (
                         <div className="flex items-center gap-2">
                           <input type="text" value={cardManualSubject} onChange={(e) => setCardManualSubject(e.target.value)} placeholder="Type subject name" className="w-full px-3 py-1.5 bg-white border border-teal-300 rounded-lg text-xs font-semibold text-slate-950 focus:outline-none focus:border-teal-500" />
                           <button type="button" onClick={() => { setCardManualSubject(''); setCardSubjectToAdd(''); }} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-xs font-black">✕</button>
                         </div>
                       )}
                     </div>
                     <div className="sm:col-span-3 space-y-1">
                       <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Total Marks</label>
                       <input type="number" min="1" value={cardMaxToAdd} onChange={(e) => setCardMaxToAdd(e.target.value)} placeholder="100" className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-slate-950 focus:outline-none focus:border-teal-500" />
                     </div>
                     <div className="sm:col-span-4 flex justify-end">
                       <button type="button" onClick={() => {
                         const fSubj = cardSubjectToAdd === 'Other' ? cardManualSubject.trim() : cardSubjectToAdd.trim();
                         if (!fSubj) { toast.error('Please enter a subject'); return; }
                         if (!cardMaxToAdd || Number(cardMaxToAdd) <= 0) { toast.error('Enter total marks'); return; }
                         setCardSubjects([...cardSubjects, { id: Date.now().toString(), subject: fSubj, maxMarks: cardMaxToAdd }]);
                         setCardSubjectToAdd(''); setCardManualSubject(''); setCardMaxToAdd('100');
                         toast.success('Subject added to test');
                       }} className="py-1.5 px-4 bg-teal-600 text-white hover:bg-teal-700 rounded-lg text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-2"><Plus size={14} /> Add Subject</button>
                     </div>
                   </div>

                   {cardSubjects.length > 0 && (
                     <div className="flex flex-wrap gap-2 pt-1">
                       {cardSubjects.map(sj => (
                         <span key={sj.id} className="inline-flex items-center gap-2 bg-teal-50 border border-teal-100 text-teal-800 text-xs font-bold px-3 py-1.5 rounded-full">
                           {sj.subject} <span className="text-teal-400">/ {sj.maxMarks}</span>
                           <button onClick={() => setCardSubjects(cardSubjects.filter(s => s.id !== sj.id))} className="text-teal-400 hover:text-rose-600"><Trash2 size={12} /></button>
                         </span>
                       ))}
                     </div>
                   )}
                 </div>

                 {/* Step 3: Pick student -> enter complete test marks */}
                 {!cardExamName.trim() || cardSubjects.length === 0 ? (
                   <div className="bg-white border text-center border-gray-200 p-10 rounded-2xl shadow-sm text-slate-500 flex flex-col items-center justify-center">
                     <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-3 text-slate-300"><ClipboardList size={22} /></div>
                     <h3 className="text-sm font-bold text-slate-700">Define the test first</h3>
                     <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">Add the exam/test name and at least one subject above, then choose a student to enter marks.</p>
                   </div>
                 ) : selectedMarkClassId ? (
                   (() => {
                     const examN = cardExamName.trim();
                     const classStudents = students.filter(s => String(s.classId) === String(selectedMarkClassId));
                     const handleSaveStudentTest = () => {
                       if (!cardStudentId) { toast.error('Select a student'); return; }
                       const student = students.find(s => String(s.id) === String(cardStudentId));
                       if (!student) return;
                        const clean = marks.filter(m => !(String(m.studentId) === String(student.id) && m.examType === examN));
                        const removedCard = marks.filter(m => String(m.studentId) === String(student.id) && m.examType === examN);
                        const recs = cardSubjects.map(sj => ({
                          id: `m_test_${student.id}_${sj.id}_${Date.now()}`,
                          studentId: student.id,
                          subject: sj.subject,
                          examType: examN,
                          marksObtained: Math.min(parseFloat(cardObtained[sj.id] || '0') || 0, parseFloat(sj.maxMarks) || 0),
                          maxMarks: parseFloat(sj.maxMarks) || 0
                        }));
                        setMarks([...clean, ...recs]);
                        syncMarksToFirestore(removedCard, recs);
                        toast.success(`Saved ${examN} for ${student.name}`);
                      };
                      const handlePrintResultCard = () => {
                        const st = students.find(s => String(s.id) === String(cardStudentId));
                        if (!st) { toast.error('Select a student'); return; }
                        const cls = classesMap.get(String(st.classId));
                        const rows = cardSubjects.map(sj => {
                          const rmax = Number(sj.maxMarks) || 0;
                          const rob = Number(cardObtained[sj.id] || '0') || 0;
                          const rpct = rmax > 0 ? Math.round((rob / rmax) * 100) : 0;
                          const status = rpct >= 40 ? 'PASS' : 'RE-STUDY';
                          return `<tr>
                            <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a">${sj.subject}</td>
                            <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:#334155">${rob} / ${rmax}</td>
                            <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700">${rpct}% <span style="font-size:11px;color:${rpct >= 40 ? '#0d9488' : '#e11d48'}">(${status})</span></td>
                          </tr>`;
                        }).join('');
                        const totO = cardSubjects.reduce((a, sj) => a + (Number(cardObtained[sj.id] || '0') || 0), 0);
                        const totM = cardSubjects.reduce((a, sj) => a + (Number(sj.maxMarks) || 0), 0);
                        const pct = totM > 0 ? Math.round((totO / totM) * 100) : 0;
                        const clsName = cls ? `${cls.className}${cls.section ? (' - ' + cls.section) : ''}` : 'N/A';
                        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Result Card - ${st.name}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Inter', Arial, sans-serif; color:#0f172a; margin:0; padding:32px; }
    .card { max-width:760px; margin:0 auto; border:2px solid #0d9488; border-radius:16px; overflow:hidden; }
    .head { background:linear-gradient(90deg,#0d9488,#14b8a6); color:#fff; padding:22px 26px; display:flex; justify-content:space-between; align-items:center; }
    .head h1 { margin:0; font-size:20px; letter-spacing:.04em; text-transform:uppercase; }
    .head .sub { font-size:12px; opacity:.9; margin-top:4px; }
    .head .pct { text-align:right; }
    .head .pct .big { font-size:34px; font-weight:900; line-height:1; }
    .head .pct .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.15em; opacity:.85; }
    .meta { display:flex; gap:24px; padding:16px 26px; border-bottom:1px solid #e2e8f0; font-size:13px; }
    .meta b { display:block; font-size:10px; text-transform:uppercase; letter-spacing:.1em; color:#64748b; margin-bottom:2px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    thead th { background:#f8fafc; text-align:left; padding:10px 14px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#64748b; border-bottom:2px solid #e2e8f0; }
    thead th.c, tbody td.c, tfoot td.c { text-align:center; }
    tfoot td { padding:12px 14px; font-weight:900; text-transform:uppercase; font-size:12px; background:#f8fafc; }
    .foot { padding:14px 26px; font-size:11px; color:#94a3b8; display:flex; justify-content:space-between; }
  </style></head>
  <body>
    <div class="card">
      <div class="head">
        <div><h1>${st.name}</h1><div class="sub">${examN} · Roll #${st.rollNumber}</div></div>
        <div class="pct"><div class="lbl">Overall</div><div class="big">${pct}%</div><div class="sub">${pct >= 40 ? 'PASS' : 'RE-STUDY'}</div></div>
      </div>
      <div class="meta"><div><b>Class</b>${clsName}</div><div><b>Roll Number</b>#${st.rollNumber}</div><div><b>Total</b>${totO} / ${totM}</div></div>
      <table>
        <thead><tr><th>Subject</th><th class="c">Marks</th><th class="c">Percentage</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total Percentage</td><td class="c">${pct}%</td></tr></tfoot>
      </table>
      <div class="foot"><span>Demo School — Result Card</span><span>Date: ${new Date().toLocaleDateString()}</span></div>
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
  </body></html>`;
                        const w = window.open('', '_blank');
                        if (!w) { toast.error('Pop-up blocked. Allow pop-ups to print.'); return; }
                        w.document.open();
                        w.document.write(html);
                        w.document.close();
                      };
                      let totO = 0; let totM = 0;
                     cardSubjects.forEach(sj => { totO += Number(cardObtained[sj.id] || '0') || 0; totM += Number(sj.maxMarks) || 0; });
                     const pct = totM > 0 ? Math.round((totO / totM) * 100) : 0;
                     if (cardStudentId) {
                       const student = students.find(s => String(s.id) === String(cardStudentId));
                       if (!student) return null;
                       return (
                         <div className="space-y-6">
                           <div className="bg-gradient-to-r from-teal-600 to-teal-600 text-white p-4 sm:p-5 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                             <div>
                               <p className="text-[10px] uppercase tracking-[0.3em] opacity-80">Entering: {examN}</p>
                               <h3 className="text-lg font-black uppercase tracking-tight">{student.name}</h3>
                               <p className="text-xs opacity-90 mt-0.5">Roll #{student.rollNumber} · {classesMap.get(String(student.classId))?.className || 'N/A'}{(classesMap.get(String(student.classId))?.section) ? ` - ${classesMap.get(String(student.classId))?.section}` : ''}</p>
                             </div>
                             <button onClick={() => { setCardStudentId(''); setCardObtained({}); }} className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs font-black uppercase tracking-wider">← Back to Students</button>
                           </div>

                           <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
                             <div className="hidden md:block overflow-x-auto">
                               <table className="w-full text-left">
                                 <thead>
                                   <tr className="border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50">
                                     <th className="px-6 py-4">Subject</th>
                                     <th className="px-6 py-4 text-center">Total Marks</th>
                                     <th className="px-6 py-4 text-center">Obtained Marks</th>
                                   </tr>
                                 </thead>
                                 <tbody className="divide-y divide-gray-150 text-sm">
                                   {cardSubjects.map(sj => (
                                     <tr key={sj.id} className="hover:bg-gray-50/20">
                                       <td className="px-6 py-4 font-bold text-slate-900">{sj.subject}</td>
                                       <td className="px-6 py-4 text-center font-semibold text-slate-500">{sj.maxMarks}</td>
                                       <td className="px-6 py-4 text-center">
                                         <input type="number" min="0" value={cardObtained[sj.id] || ''} onChange={(e) => setCardObtained({ ...cardObtained, [sj.id]: e.target.value.replace(/^0+(?=\d)/, '') })} placeholder="0" className="w-24 px-3 py-1.5 bg-teal-50 border border-teal-100 rounded-lg text-sm text-center font-extrabold text-teal-900 focus:outline-none focus:border-teal-500 inline-block" />
                                       </td>
                                     </tr>
                                   ))}
                                 </tbody>
                               </table>
                             </div>
                             <div className="block md:hidden divide-y divide-slate-100">
                               {cardSubjects.map(sj => (
                                 <div key={sj.id} className="p-4 flex items-center justify-between gap-3">
                                   <div>
                                     <p className="font-bold text-slate-900 text-sm">{sj.subject}</p>
                                     <p className="text-xs text-slate-400">/ {sj.maxMarks}</p>
                                   </div>
                                   <input type="number" min="0" value={cardObtained[sj.id] || ''} onChange={(e) => setCardObtained({ ...cardObtained, [sj.id]: e.target.value.replace(/^0+(?=\d)/, '') })} placeholder="0" className="w-20 px-2 py-1.5 bg-teal-50 border border-teal-100 rounded-lg text-sm text-center font-extrabold text-teal-900" />
                                 </div>
                               ))}
                             </div>
                             <div className="border-t border-gray-100 p-4 bg-gray-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
                               <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">Total: <span className="text-teal-700 text-sm">{totO}/{totM}</span> ({pct}%) · <span className={pct >= 40 ? 'text-amber-600' : 'text-rose-600'}>{pct >= 40 ? 'PASS' : 'RE-STUDY'}</span></div>
                                <button onClick={handlePrintResultCard} className="py-2 px-5 bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-xs font-black uppercase tracking-wider shadow-sm flex items-center gap-2"><Printer size={14} /> Print</button>
                                <button onClick={handleSaveStudentTest} className="py-2 px-5 bg-teal-600 text-white hover:bg-teal-700 rounded-lg text-xs font-black uppercase tracking-wider shadow-sm flex items-center gap-2"><Save size={14} /> Save Test</button>
                             </div>
                           </div>

                           {cardSubjects.length > 0 && (
                             <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                               <div className="bg-gradient-to-r from-teal-600 to-teal-600 text-white px-5 py-4 flex items-center justify-between gap-3">
                                 <div>
                                   <h3 className="text-base font-black uppercase tracking-wide">Result Card</h3>
                                   <p className="text-xs opacity-90">{examN}</p>
                                 </div>
                                 <div className="text-right">
                                   <p className="text-[10px] opacity-80 uppercase tracking-widest">Overall</p>
                                   <p className="text-3xl font-black leading-none">{pct}%</p>
                                 </div>
                               </div>
                               <table className="w-full text-left">
                                 <thead>
                                   <tr className="border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-widest bg-slate-50">
                                     <th className="px-5 py-3">Subject</th>
                                     <th className="px-5 py-3 text-center">Marks</th>
                                     <th className="px-5 py-3 text-center">Percentage</th>
                                   </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100">
                                   {cardSubjects.map(sj => {
                                     const rmax = Number(sj.maxMarks) || 0; const rob = Number(cardObtained[sj.id] || '0') || 0; const rpct = rmax > 0 ? Math.round((rob / rmax) * 100) : 0;
                                     return (
                                       <tr key={sj.id}>
                                         <td className="px-5 py-3 font-bold text-slate-900">{sj.subject}</td>
                                         <td className="px-5 py-3 text-center font-bold text-slate-700">{rob}/{rmax}</td>
                                         <td className="px-5 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-black ${rpct >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{rpct}%</span></td>
                                       </tr>
                                     );
                                   })}
                                 </tbody>
                                 <tfoot>
                                   <tr className="bg-slate-50 border-t border-slate-200">
                                     <td colSpan={2} className="px-5 py-3 font-black text-slate-900 uppercase text-xs">Total</td>
                                     <td className="px-5 py-3 text-center font-black text-teal-700">{pct}%</td>
                                   </tr>
                                 </tfoot>
                               </table>
                             </div>
                           )}
                         </div>
                       );
                     }
                     return (
                       <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                         <div className="p-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                           <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Students in {classesMap.get(String(selectedMarkClassId))?.className || 'N/A'} — click to enter {examN}</h3>
                           <span className="text-xs bg-slate-200 text-slate-800 font-bold px-2 py-0.5 rounded">{classStudents.length} Pupils</span>
                         </div>
                         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
                           {classStudents.map(st => {
                             const init: Record<string, string> = {};
                             cardSubjects.forEach(sj => {
                               const ex = marks.find(m => String(m.studentId) === String(st.id) && m.examType === examN && m.subject === sj.subject);
                               init[sj.id] = ex ? String(ex.marksObtained) : '';
                             });
                             const done = cardSubjects.every(sj => marks.some(m => String(m.studentId) === String(st.id) && m.examType === examN && m.subject === sj.subject));
                             return (
                               <button key={st.id} onClick={() => { setCardObtained(init); setCardStudentId(st.id); }} className="text-left bg-teal-50/50 hover:bg-teal-100 border border-teal-100 rounded-xl p-4 transition-all flex items-center gap-3 cursor-pointer">
                                 {st.photo ? (
                                   <img src={st.photo} alt={st.name} className="w-9 h-9 rounded-full object-cover border border-slate-200" />
                                 ) : (
                                   <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border border-slate-200"><Users size={14} /></div>
                                 )}
                                 <div className="min-w-0 flex-1">
                                   <p className="font-bold text-slate-900 text-sm truncate">{st.name.split(' ').slice(0, 1).join(' ') || st.name}</p>
                                   <p className="text-xs text-slate-400">Roll #{st.rollNumber}</p>
                                 </div>
                                 {done && <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">SAVED</span>}
                               </button>
                             );
                           })}
                         </div>
                       </div>
                     );
                   })()
                 ) : (
                   <div className="bg-white border text-center border-gray-200 p-10 rounded-2xl shadow-sm text-slate-500 flex flex-col items-center justify-center">
                     <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mb-3 text-slate-300"><User size={22} /></div>
                     <h3 className="text-sm font-bold text-slate-700">No Class Selected</h3>
                     <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">Select a class above to see its students.</p>
                   </div>
                 )}
               </div>
              )}
           </div>
         )}

{/* ========== TEACHER TIMETABLE SCHEDULE ========== */}
        {activeTab === 'timetable' && (
          <div id="panel-teacher-timetable" className="space-y-6 animate-fade-in bg-amber-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-amber-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Class Schedule Overview</h1>
              </div>

              {/* Sub-tabs for Timetable */}
              <div className="flex bg-white p-1 rounded-xl border border-amber-200 shadow-sm">
                <button 
                  onClick={() => setTimetableSubTab('my')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${timetableSubTab === 'my' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  My Schedule
                </button>
                <button 
                  onClick={() => setTimetableSubTab('class')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${timetableSubTab === 'class' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Class Schedule
                </button>
              </div>
            </div>

            {timetableSubTab === 'class' && (
              <div className="flex items-center gap-3 bg-white p-4 rounded-2xl border border-amber-100 shadow-sm animate-fade-in">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Select Class:</span>
                <select 
                  value={timetableClassId}
                  onChange={(e) => setTimetableClassId(e.target.value)}
                  className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-amber-500 transition-all"
                >
                  {myClasses.map(cl => (
                    <option key={cl.id} value={cl.id}>{cl.className} ({cl.section})</option>
                  ))}
                </select>
              </div>
            )}

            {timetableSubTab === 'my' && (
              <div className="flex items-center gap-3 bg-white p-4 rounded-2xl border border-amber-100 shadow-sm animate-fade-in flex-wrap">
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Select Day:</span>
                <select 
                  value={scheduleDay}
                  onChange={(e) => setScheduleDay(e.target.value)}
                  className="bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-amber-500 transition-all cursor-pointer"
                >
                  {DAYS.map(d => (
                    <option key={d} value={d}>{d}{d === currentDayName ? ' (Today)' : ''}</option>
                  ))}
                </select>
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 ml-auto">
                  {myWeekLectures.filter(tt => tt.day === scheduleDay).length} Lecture(s) on {scheduleDay}
                </span>
              </div>
            )}

            {/* Timetable Grid mapping (Class Schedule view) */}
            {timetableSubTab === 'class' ? (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-left">
                  <thead>
                    <tr className="bg-gray-100/60 border-b border-gray-200">
                      <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-widest w-28">
                        Weekday
                      </th>
                      {PERIODS.map(p => (
                        <th key={p} className="px-4 py-3.5 text-sm font-bold text-gray-500 uppercase tracking-wider text-center border-l border-gray-150">
                          {p}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150">
                    {DAYS.map(day => (
                      <tr key={day} className="hover:bg-gray-50/20">
                        <td className="px-4 py-6 font-bold text-gray-700 text-xs bg-gray-50/50">
                          {day}
                        </td>
                        {PERIODS.map(p => {
                          // Find entries for the selected class
                          const entry = timetable.find(
                            tt => tt.classId === timetableClassId && 
                                 tt.day === day && 
                                 tt.period === p
                          );

                          return (
                            <td key={p} className="px-3 py-3 text-center border-l border-gray-200 align-top min-w-36">
                              {(() => {
                                if (!entry) return (
                                  <span className="text-xs text-gray-300 font-medium  block py-4 select-none">
                                    No Lecture
                                  </span>
                                );
                                
                                let col = '#0d9488'; // default emerald
                                try {
                                  const savedColors = safeStorage.getItem('acadamis_period_colors');
                                  if (savedColors) {
                                    const parsedColors = JSON.parse(savedColors);
                                    col = parsedColors[`${entry.classId}_${p}`] || '#0d9488';
                                  }
                                } catch (e) {}
                                
                                const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                const systName = systemDays[new Date().getDay()];
                                const isLive = (day === systName || day === currentDayName) && getPeriodStatus(entry.time) === 'current';

                                return (
                                  <div 
                                    style={{ 
                                      borderLeft: isLive ? `4px solid #ef4444` : `3px solid ${col}`, 
                                      backgroundColor: isLive ? '#fef2f2' : `${col}12` 
                                    }}
                                    className={`p-2.5 rounded-r-xl border-t border-r border-b border-l-0 border-gray-150 text-left transition-all ${
                                      isLive ? 'ring-2 ring-red-500 shadow-md shadow-red-100 animate-pulse' : ''
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="font-bold text-xs truncate" style={{ color: isLive ? '#ef4444' : col }}>
                                        {entry.subject}
                                      </div>
                                      {isLive && (
                                        <span className="shrink-0 bg-red-650 text-white text-[10px] font-black tracking-widest px-1 py-0.5 rounded uppercase font-display scale-90">
                                          LIVE
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-755 mt-0.5 truncate font-medium">
                                      👤 Teacher: {getTeacherName(entry.teacherId)}
                                    </div>
                                    <div className="text-xs font-mono text-slate-500 mt-1 flex items-center justify-between">
                                      <span>{entry.time}</span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            ) : (
              /* Compact Day-wise Dropdown List (My Schedule) */
              <div className="space-y-3">
                {(() => {
                  const dayLectures = myWeekLectures.filter(tt => tt.day === scheduleDay);
                  if (dayLectures.length === 0) {
                    return (
                      <div className="py-14 text-center bg-white border-2 border-dashed border-amber-200 rounded-2xl">
                        <CalendarDays size={32} className="mx-auto text-amber-300 mb-3 opacity-50" />
                        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No Lectures on {scheduleDay}</p>
                        <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mt-1">You have no classes scheduled for this day.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {dayLectures.map(entry => {
                        let col = '#0d9488';
                        try {
                          const savedColors = safeStorage.getItem('acadamis_period_colors');
                          if (savedColors) {
                            const parsedColors = JSON.parse(savedColors);
                            col = parsedColors[`${entry.classId}_${entry.period}`] || '#0d9488';
                          }
                        } catch (e) {}

                        const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        const systName = systemDays[new Date().getDay()];
                        const isLive = (scheduleDay === systName || scheduleDay === currentDayName) && getPeriodStatus(entry.time) === 'current';

                        return (
                          <div 
                            key={entry.id} 
                            className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all"
                            style={{ borderLeft: `4px solid ${isLive ? '#ef4444' : col}` }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[10px] font-black uppercase shrink-0 text-white" style={{ backgroundColor: col }}>
                                  {entry.period.replace('Period ', 'P')}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate" style={{ color: isLive ? '#ef4444' : '#0f172a' }}>
                                      {entry.subject}
                                    </h4>
                                    {isLive && (
                                      <span className="shrink-0 bg-red-500 text-white text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded uppercase animate-pulse">
                                        LIVE
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-0.5 truncate">
                                    🏫 Class: {getClassLabel(entry.classId)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-black uppercase tracking-widest">
                                <Clock size={11} /> {entry.time}
                              </div>
                              <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">{scheduleDay}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* ========== MY ATTENDANCE (GPS CHECK-IN / OUT) ========== */}
        {activeTab === 'my-attendance' && (
          <div id="panel-teacher-my-attendance" className="space-y-6 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">My Attendance</h1>
                <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">GPS Verified Check-in / Check-out — Digital Staff Register</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Today status + buttons */}
              <div className="bg-gradient-to-br from-slate-900 via-teal-900 to-slate-900 rounded-2xl shadow-xl shadow-teal-100 p-6 relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-teal-500/20 rounded-full blur-3xl pointer-events-none"></div>
                {(() => {
                  const rec = myTodayAttendance;
                  const badge = !rec ? 'bg-slate-500 text-white' : rec.status === 'present' ? 'bg-teal-600 text-white' : rec.status === 'late' ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white';
                  return (
                    <div className="relative z-10">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-teal-300 mb-1">Today · {todayStr}</p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg sm:text-xl font-black text-white tracking-tight uppercase">{new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${badge}`}>{rec ? rec.status.toUpperCase() : 'NOT CHECKED IN'}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="bg-white/10 border border-white/10 rounded-xl p-3">
                          <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Check-In</p>
                          <p className="text-sm font-black text-teal-300">{rec?.checkIn ? new Date(rec.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                        </div>
                        <div className="bg-white/10 border border-white/10 rounded-xl p-3">
                          <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Check-Out</p>
                          <p className="text-sm font-black text-teal-300">{rec?.checkOut ? new Date(rec.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                        </div>
                        <div className="bg-white/10 border border-white/10 rounded-xl p-3">
                          <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">School Dist</p>
                          <p className="text-sm font-black text-teal-300">{formatDistance(rec?.distanceMeters)}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3 items-center">
                        <button
                          onClick={handleTeacherCheckIn}
                          disabled={Boolean(myTodayAttendance?.checkIn)}
                          className="flex items-center gap-2 px-6 py-3.5 bg-teal-500 hover:bg-teal-600 disabled:bg-slate-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed"
                        >
                          <Fingerprint size={16} /> Check-In
                        </button>
                        <button
                          onClick={handleTeacherCheckOut}
                          disabled={!myTodayAttendance?.checkIn || Boolean(myTodayAttendance?.checkOut)}
                          className="flex items-center gap-2 px-6 py-3.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 text-slate-950 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg transition-all active:scale-95 disabled:cursor-not-allowed"
                        >
                          <LogOut size={16} /> Check-Out
                        </button>
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={useDemoPosition} onChange={(e) => setUseDemoPosition(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                          <span className="text-[9px] font-black uppercase tracking-wider text-teal-200">Demo GPS (School Location)</span>
                        </label>
                      </div>
                      <p className="text-[10px] text-slate-300 font-bold mt-3 flex items-center gap-1.5">
                        <MapPin size={12} className="text-teal-300" />
                        School: {schoolLocation.name} · Radius {schoolLocation.radiusMeters} m — check-in sirf school ke andar se hota hai.
                      </p>
                    </div>
                  );
                })()}
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><CalendarClock size={14} className="text-teal-600" /> Monthly Overview</h3>
                  <input type="month" value={selfAttMonth} onChange={(e) => setSelfAttMonth(e.target.value)} className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800" />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 text-center">
                  {[['Present', selfAttSummary.presentDays, 'bg-teal-50 text-teal-700 border-teal-200'], ['Late', selfAttSummary.lateDays, 'bg-amber-50 text-amber-700 border-amber-200'], ['Absent', selfAttSummary.absentDays, 'bg-rose-50 text-rose-700 border-rose-200'], ['Leave', selfAttSummary.leaveDays, 'bg-slate-50 text-slate-600 border-slate-200'], ['Marked', selfAttSummary.totalMarked, 'bg-slate-50 text-slate-600 border-slate-200']].map((item) => (
                    <div key={String(item[0])} className={`rounded-xl border p-2.5 ${item[2]}`}>
                      <p className="text-[8px] font-black uppercase tracking-widest">{item[0]}</p>
                      <p className="text-lg font-black mt-0.5">{item[1]}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Attendance Calendar — {monthLabel(selfAttYear, selfAttMonthIdx)}</p>
                  <div className="grid grid-cols-7 gap-1 mt-2">
                    {['M','T','W','T','F','S','S'].map((d, i) => <div key={i} className="text-center text-[9px] font-black text-slate-400">{d}</div>)}
                    {selfAttGrid.map((d, i) => {
                      if (d === null) return <div key={`e${i}`} />;
                      const dateStr = `${selfAttYear}-${String(selfAttMonthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const st = statusOnDate(dateStr);
                      const cellCls = st === 'present' ? 'bg-teal-600 text-white' : st === 'late' ? 'bg-amber-400 text-white' : st === 'absent' ? 'bg-rose-500 text-white' : st === 'leave' ? 'bg-slate-300 text-slate-700' : 'bg-slate-50 text-slate-500';
                      return (
                        <div key={d} title={dateStr + (st ? ` · ${st}` : '')} className={`aspect-square rounded-md flex items-center justify-center text-[10px] font-black ${cellCls}`}>
                          {d}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-slate-50 flex items-center gap-2">
                <Receipt size={14} className="text-teal-600" />
                <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest">My Attendance History</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-widest bg-gray-50">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Check-In</th>
                      <th className="px-5 py-3">Check-Out</th>
                      <th className="px-5 py-3">School Dist</th>
                      <th className="px-5 py-3">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150 text-sm">
                    {myTeacherAttendance.length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-8 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">Koi attendance record nahi — aaj check-in karein</td></tr>
                    ) : myTeacherAttendance.slice().sort((a, b) => (b.date + (b.checkIn || '')).localeCompare(a.date + (a.checkIn || ''))).map(rec => (
                      <tr key={rec.id} className="hover:bg-gray-50/20">
                        <td className="px-5 py-3 font-bold text-slate-800">{rec.date}</td>
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${rec.status === 'present' ? 'bg-teal-600 text-white' : rec.status === 'late' ? 'bg-amber-500 text-white' : rec.status === 'leave' ? 'bg-slate-400 text-white' : 'bg-rose-600 text-white'}`}>{rec.status}</span>
                        </td>
                        <td className="px-5 py-3 text-slate-500">{rec.checkIn ? new Date(rec.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-5 py-3 text-slate-500">{rec.checkOut ? new Date(rec.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                        <td className="px-5 py-3 text-slate-500">{formatDistance(rec.distanceMeters)}</td>
                        <td className="px-5 py-3 text-slate-500">{rec.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
        {/* ========== MY PAY ========== */}
        {activeTab === 'my-pay' && (
          <div id="panel-teacher-my-pay" className="space-y-6 animate-fade-in bg-amber-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-amber-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">My Pay & Salary Slip</h1>
                <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Monthly hisab-e-tankhwah — attendance k sath linked (Digital Registrar)</p>
              </div>
              <select
                value={payMonthSel}
                onChange={(e) => setPayMonthSel(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-800"
              >
                {(() => {
                  const opts: string[] = [];
                  const now = new Date();
                  for (let i = 0; i < 6; i++) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                  }
                  return opts.map(o => <option key={o} value={o}>{monthLabel(Number(o.split('-')[0]), Number(o.split('-')[1]) - 1)}</option>);
                })()}
              </select>
            </div>

            <div className="bg-gradient-to-br from-slate-900 via-teal-900 to-slate-900 animate-gradient rounded-2xl shadow-xl shadow-teal-100 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 overflow-hidden relative animate-slide-up">
              <div className="absolute -top-16 -right-16 w-64 h-64 bg-amber-400/20 rounded-full blur-3xl pointer-events-none animate-float"></div>
              <div className="relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-teal-300 mb-1">Payslip · {monthLabel(myPayslip.year, myPayslip.month)}</p>
                <h3 className="text-2xl font-black text-white tracking-tight uppercase">{teacherProfile?.name || userSession.name}</h3>
                <p className="text-xs text-teal-200 font-bold uppercase tracking-widest mt-1">{teacherProfile?.subject || teacherSubject}</p>
                <p className="text-[10px] text-teal-300/80 font-bold uppercase tracking-widest mt-1.5 flex items-center gap-1.5">
                  <CalendarClock size={12} />
                  Tenure: {salaryHistory.tenureYears} Saal {salaryHistory.tenureRemMonths} Mahine · Since {salaryHistory.startLabel}
                </p>
              </div>
              <div className="relative z-10 text-right">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Net Payable</p>
                <p className="text-3xl font-black text-amber-400 tracking-tight">{formatPKR(myPayslip.netPay)}</p>
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${myPayslip.paid ? 'bg-teal-500 text-white' : 'bg-amber-500 text-slate-950'}`}>
                  {myPayslip.paid ? `PAID ${myPayslip.paidDate ? '· ' + myPayslip.paidDate : ''}` : 'PENDING'}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 bg-slate-50 flex items-center gap-2"><Wallet size={14} className="text-teal-600" /><h3 className="text-xs font-black text-slate-600 uppercase tracking-widest">Earnings</h3></div>
                <div className="space-y-2.5 px-5 py-4">
                  <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Base Salary</span><span className="text-xs font-black text-slate-900">{formatPKR(myPayslip.baseSalary)}</span></div>
                  <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Present Bonus ({myPayslip.presentDays} days × {formatPKR(myPayConfig.bonusPerPresentDay)})</span><span className="text-xs font-black text-teal-600">+ {formatPKR(myPayslip.presentBonus)}</span></div>
                  <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Allowances</span><span className="text-xs font-black text-teal-600">+ {formatPKR(myPayslip.allowances)}</span></div>
                </div>
                <div className="px-5 py-3 bg-teal-50 text-teal-800 border border-teal-100">
                  <div className="flex justify-between text-xs font-black"><span>Total Earnings</span><span>{formatPKR(myPayslip.baseSalary + myPayslip.presentBonus + myPayslip.allowances)}</span></div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-5 py-3 bg-slate-50 flex items-center gap-2"><Coins size={14} className="text-amber-600" /><h3 className="text-xs font-black text-slate-600 uppercase tracking-widest">Deductions</h3></div>
                <div className="space-y-2.5 px-5 py-4">
                  <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Late ({myPayslip.lateDays} day × {formatPKR(myPayConfig.lateDeductionPerDay)})</span><span className="text-xs font-black text-rose-600">- {formatPKR(myPayslip.lateDeduction)}</span></div>
                  <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Absent ({myPayslip.absentDays} day × {formatPKR(myPayConfig.absentDeductionPerDay)})</span><span className="text-xs font-black text-rose-600">- {formatPKR(myPayslip.absentDeduction)}</span></div>
                  <div className="flex justify-between"><span className="text-xs font-bold text-slate-500">Fixed Deductions</span><span className="text-xs font-black text-rose-600">- {formatPKR(myPayslip.fixedDeductions)}</span></div>
                </div>
                <div className="px-5 py-3 bg-amber-50 text-amber-800 border border-amber-200">
                  <div className="flex justify-between text-xs font-black"><span>Net Payable</span><span>{formatPKR(myPayslip.netPay)}</span></div>
                </div>
              </div>
            </div>

            {/* ========== COMPLETE SALARY HISTORY — pura hisab, join se aaj tak ========== */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm animate-slide-up">
              <div className="px-5 py-4 bg-gradient-to-r from-teal-600 via-teal-500 to-teal-600 animate-gradient flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays size={16} className="text-white" />
                  <div>
                    <h3 className="text-xs font-black text-white uppercase tracking-widest">Complete Salary History</h3>
                    <p className="text-[10px] text-teal-100 font-bold uppercase tracking-widest mt-0.5">
                      {salaryHistory.startLabel} se {salaryHistory.monthsCount} mahine ka pura hisab-e-tankhwah
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-teal-100 uppercase tracking-widest">Service Tenure</p>
                  <p className="text-lg font-black text-white tracking-tight leading-none">
                    {salaryHistory.tenureYears}<span className="text-xs"> saal</span> {salaryHistory.tenureRemMonths}<span className="text-xs"> mahine</span>
                  </p>
                </div>
              </div>

              {/* Lifetime Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-50 border-b border-slate-100">
                {[
                  { label: 'Total Earned (Net)', val: formatPKR(salaryHistory.totalNet), color: 'text-slate-900' },
                  { label: 'Total Paid', val: formatPKR(salaryHistory.totalPaid), color: 'text-teal-600' },
                  { label: 'Pending', val: formatPKR(salaryHistory.totalPending), color: 'text-rose-600' },
                  { label: 'Avg / Month', val: formatPKR(salaryHistory.avgMonthly), color: 'text-amber-600' },
                ].map((st, i) => (
                  <motion.div
                    key={st.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.35 }}
                    className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-sm"
                  >
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{st.label}</p>
                    <p className={`text-sm font-black tabular-nums mt-1 ${st.color}`}>{st.val}</p>
                  </motion.div>
                ))}
              </div>

              {/* Month-wise table */}
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 sticky top-0 z-10">
                    <tr>
                      {['Month', 'P', 'L', 'A', 'Gross', 'Net Pay', 'Status'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salaryHistory.slips.map((s, i) => {
                      const gross = s.baseSalary + s.presentBonus + s.allowances;
                      const isCurrent = s.year === myPayslip.year && s.month === myPayslip.month;
                      return (
                        <tr
                          key={`${s.teacherId}_${s.year}_${s.month}`}
                          className={`border-t border-slate-100 ${isCurrent ? 'bg-amber-50/60' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-teal-50/60 transition-colors`}
                        >
                          <td className="px-3 py-2 text-xs font-black text-slate-800 whitespace-nowrap">
                            {monthLabel(s.year, s.month)}{isCurrent ? ' ←' : ''}
                          </td>
                          <td className="px-3 py-2 text-xs font-bold text-teal-600 tabular-nums">{s.presentDays + s.lateDays}</td>
                          <td className="px-3 py-2 text-xs font-bold text-amber-600 tabular-nums">{s.lateDays}</td>
                          <td className="px-3 py-2 text-xs font-bold text-rose-600 tabular-nums">{s.absentDays}</td>
                          <td className="px-3 py-2 text-xs font-bold text-slate-600 tabular-nums whitespace-nowrap">{formatPKR(gross)}</td>
                          <td className="px-3 py-2 text-xs font-black text-slate-900 tabular-nums whitespace-nowrap">{formatPKR(s.netPay)}</td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${
                              s.paid ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'
                            }`}>
                              {s.paid ? `PAID${s.paidDate ? ' · ' + s.paidDate : ''}` : 'PENDING'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {salaryHistory.slips.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">Koi salary record nahi mila</td></tr>
                    )}
                  </tbody>
                  <tfoot className="bg-slate-900 text-white sticky bottom-0">
                    <tr>
                      <td className="px-3 py-2.5 text-[10px] font-black uppercase tracking-widest" colSpan={4}>Total ({salaryHistory.monthsCount} months)</td>
                      <td className="px-3 py-2.5 text-[10px] font-black tabular-nums whitespace-nowrap">{formatPKR(salaryHistory.totalNet + salaryHistory.slips.reduce((a, s) => a + s.lateDeduction + s.absentDeduction + s.fixedDeductions, 0))}</td>
                      <td className="px-3 py-2.5 text-[11px] font-black text-amber-400 tabular-nums whitespace-nowrap">{formatPKR(salaryHistory.totalNet)}</td>
                      <td className="px-3 py-2.5 text-[9px] font-bold text-slate-300 uppercase tracking-widest">
                        {salaryHistory.totalPending > 0 ? `${formatPKR(salaryHistory.totalPending)} pending` : 'Sab Paid ✓'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                <span>📍 Present+Late total: <b className="text-teal-600">{salaryHistory.totalPresent} din</b></span>
                <span>⚠️ Absent total: <b className="text-rose-600">{salaryHistory.totalAbsent} din</b></span>
                <span>🏢 Started: <b className="text-slate-700">{salaryHistory.startLabel}</b></span>
              </div>
            </div>

            <button
              onClick={printPayslip}
              className="w-full sm:w-auto px-6 py-3.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-teal-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer size={16} /> Print / Save Payslip (PDF)
            </button>
          </div>
        )}
        {/* ========== ONLINE QUIZZES ========== */}
        {activeTab === 'quiz' && (
          <div className="bg-white/40 rounded-2xl p-2 sm:p-4">
            <QuizModule userSession={userSession} students={students} classes={classes} />
          </div>
        )}
        {/* ========== AI PAPER GENERATOR ========== */}
        {activeTab === 'ai_paper' && (
          <div className="bg-white/40 rounded-2xl p-2 sm:p-4">
            <AiPaperGenerator userSession={userSession} classes={classes} />
          </div>
        )}
        {/* ========== NOTICE BOARD ========== */}
        {activeTab === 'notices' && (
          <div className="bg-white/40 rounded-2xl p-2 sm:p-4">
            <NoticeBoard userSession={userSession} />
          </div>
        )}
        {/* ========== SCHOOL CALENDAR ========== */}
        {activeTab === 'calendar' && (
          <EventsCalendar userSession={userSession} />
        )}
        {/* ========== SETTINGS TAB (CHANGE ID/PASSWORD) ========== */}
        {/* ========== FEES & FINANCIAL HUB PANEL ========== */}
        {activeTab === 'fees' && (
          <div id="panel-teacher-fees" className="space-y-6 animate-fade-in bg-slate-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-slate-100 shadow-inner">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase ">Ledger & Financials</h1>
                <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Class Fee Tracking & Collection Status (Digital Registrar)</p>
              </div>
              <button
                onClick={() => setShowAddFeeModal(true)}
                className="px-6 py-3 bg-slate-900 text-white text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2 hover:bg-amber-600 transition-all shadow-xl shadow-slate-200"
              >
                <Plus size={14} /> Record Cash Collection
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white p-6 border border-slate-100 shadow-sm rounded-xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1 ">Total Expected</p>
                <h3 className="text-2xl font-black text-slate-900 tracking-tighter">
                  {students.length * 5500}
                </h3>
              </div>
              <div className="bg-white p-6 border border-amber-100 shadow-sm rounded-xl">
                <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1 ">Cash Collected</p>
                <h3 className="text-2xl font-black text-amber-700 tracking-tighter">
                  {fees.reduce((acc, curr) => acc + curr.amount, 0)}
                </h3>
              </div>
              <div className="bg-white p-6 border border-amber-100 shadow-sm rounded-xl">
                <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1 ">Pending Dues</p>
                <h3 className="text-2xl font-black text-amber-700 tracking-tighter">
                  {(students.length * 5500) - fees.reduce((acc, curr) => acc + curr.amount, 0)}
                </h3>
              </div>
            </div>

            <div className="bg-white border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-900 flex items-center gap-2">
                  <CreditCard size={14} className="text-amber-600" /> Recent Collection Ledger
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-100 uppercase text-xs font-black tracking-widest text-slate-400">
                    <tr>
                      <th className="px-6 py-4">Transaction ID</th>
                      <th className="px-6 py-4">Student Profile</th>
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Amount</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-xs">
                    {fees.length > 0 ? (
                      fees.slice().reverse().map(fee => {
                        const student = students.find(s => String(s.id) === String(fee.studentId));
const sName = student?.name || (fee as any).studentName || ('Student #' + String(fee.studentId || '').slice(-4));
const sRoll = student?.rollNumber ? ('Roll #' + student.rollNumber) : 'Student Record';
                        return (
                          <tr key={fee.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 font-mono font-bold text-slate-400">#{fee.id.slice(-6)}</td>
                            <td className="px-6 py-4">
                              <span className="font-black text-slate-900 block tracking-tight uppercase">{sName}</span>
                              <span className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-none">{sRoll}</span>
                            </td>
                            <td className="px-6 py-4 text-slate-500 font-bold tracking-widest text-xs">{fee.paidDate || fee.month}</td>
                            <td className="px-6 py-4 text-amber-600 font-black tracking-tighter text-sm">{fee.amount}</td>
                            <td className="px-6 py-4 uppercase">
                              <span className="bg-amber-50 text-amber-600 px-2 py-1 text-xs font-black tracking-widest border border-amber-100">Verified</span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-400  font-bold uppercase tracking-widest text-xs">No collection records found in active period</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div id="panel-teacher-settings" className="space-y-8 animate-fade-in bg-slate-50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-slate-200 shadow-inner">
            <AiSettingsSection />

            <div className="bg-white rounded-xl p-8 border border-slate-200 shadow-sm border-t-4 border-t-teal-600">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-teal-50 rounded-xl border border-teal-100">
                  <Sparkles size={24} className="text-teal-600" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Security & Profile Settings</h2>
                  <p className="text-xs text-slate-500">Update your portal login identity and password credentials below.</p>
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

                  // Update teacher record in state
                  const updatedTeachers = teachers.map(t => 
                    t.id === userSession.id ? { ...t, username: newID, password: newPass } : t
                  );
                  setTeachers(updatedTeachers);
                  toast.success("Profile credentials updated successfully! These changes are now active.");
                }}
                className="max-w-md space-y-6"
              >
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">Portal Login ID / Username</label>
                    <input 
                      name="username"
                      type="text" 
                      defaultValue={teacherProfile?.username || ''}
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500 outline-none font-mono text-sm"
                      placeholder="Enter new login ID"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">New Password</label>
                    <input 
                      name="password"
                      type="password" 
                      defaultValue={teacherProfile?.password || ''}
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500 outline-none font-mono text-sm"
                      placeholder="Enter new password"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">Confirm New Password</label>
                    <input 
                      name="confirm_password"
                      type="password" 
                      className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl focus:ring-1 focus:ring-teal-500 outline-none font-mono text-sm"
                      placeholder="Confirm new password"
                      required
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-teal-600 hover:bg-teal-700 text-white font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-teal-100 flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  Update Credentials
                </button>
              </form>

              <div className="mt-12 p-4 bg-amber-50 border border-amber-100 text-amber-800 text-xs leading-relaxed">
                <p className="font-bold flex items-center gap-1.5 mb-1 uppercase tracking-wider">
                  <AlertCircle size={12} /> Security Notice
                </p>
                Once you change your ID or Password, you must use the new credentials for your next login session. These settings are tracked by the Digital Registrar Office (Principal Dashboard) for administrative security protocols.
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ========== MOBILE RESPONSIVE BOTTOM FOOTER NAVIGATION ========== */}
      <div id="teacher-mobile-footer-nav" className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 text-white z-50 shadow-2xl px-2 pb-safe select-none">
        <div className="flex justify-around items-center h-16 relative">
          
          <div className={`flex-1 flex justify-center transition-all duration-300 ${activeTab === 'dashboard' ? '-translate-y-4' : 'translate-y-0'}`}>
            <button
              id="mobile-nav-dashboard"
              onClick={() => { handleTabChange('dashboard'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${
                activeTab === 'dashboard' 
                  ? 'rounded-full p-2.5 shadow-2xl border-4 border-slate-900 scale-110 bg-teal-600 text-white' 
                  : 'text-slate-400 hover:text-white p-2'
              }`}
              style={activeTab === 'dashboard' ? { minHeight: '52px', minWidth: '52px' } : {}}
            >
              <Sparkles size={activeTab === 'dashboard' ? 20 : 18} />
              <span className={`text-[10px] uppercase tracking-widest mt-0.5 ${activeTab === 'dashboard' ? 'font-black' : 'font-bold'}`}>Home</span>
            </button>
          </div>

          <div className={`flex-1 flex justify-center transition-all duration-300 ${activeTab === 'marks' ? '-translate-y-4' : 'translate-y-0'}`}>
            <button
              id="mobile-nav-marks"
              onClick={() => {
                handleEnterMarksTab(selectedMarkClassId || classes[0]?.id || '', selectedSubject, selectedExamType);
                handleTabChange('marks');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${
                activeTab === 'marks' 
                  ? 'rounded-full p-2.5 shadow-2xl border-4 border-slate-900 scale-110 bg-teal-600 text-white' 
                  : 'text-slate-400 hover:text-white p-2'
              }`}
              style={activeTab === 'marks' ? { minHeight: '52px', minWidth: '52px' } : {}}
            >
              <Award size={activeTab === 'marks' ? 20 : 18} />
              <span className={`text-[10px] uppercase tracking-widest mt-0.5 ${activeTab === 'marks' ? 'font-black' : 'font-bold'}`}>Grades</span>
            </button>
          </div>

          <div className={`flex-1 flex justify-center transition-all duration-300 ${activeTab === 'attendance' ? '-translate-y-4' : 'translate-y-0'}`}>
            <button
              id="mobile-nav-attendance"
              onClick={() => {
                handleEnterAttendanceTab(activeClassId || myClasses[0]?.id || '', attendanceDate);
                handleTabChange('attendance');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${
                activeTab === 'attendance'
                  ? 'rounded-full p-2.5 shadow-2xl border-4 border-slate-900 scale-110 bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-white p-2'
              }`}
              style={activeTab === 'attendance' ? { minHeight: '52px', minWidth: '52px' } : {}}
            >
              <CheckSquare size={activeTab === 'attendance' ? 20 : 18} className={activeTab === 'attendance' ? 'stroke-[2.5]' : ''} />
              <span className={`text-[10px] uppercase tracking-widest mt-0.5 ${activeTab === 'attendance' ? 'font-black' : 'font-bold'}`}>Attd</span>
            </button>
          </div>

          <div className={`flex-1 flex justify-center transition-all duration-300 ${activeTab === 'students' ? '-translate-y-4' : 'translate-y-0'}`}>
            <button
              id="mobile-nav-students"
              onClick={() => { handleTabChange('students'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${
                activeTab === 'students' 
                  ? 'rounded-full p-2.5 shadow-2xl border-4 border-slate-900 scale-110 bg-teal-600 text-white' 
                  : 'text-slate-400 hover:text-white p-2'
              }`}
              style={activeTab === 'students' ? { minHeight: '52px', minWidth: '52px' } : {}}
            >
              <Users size={activeTab === 'students' ? 20 : 18} />
              <span className={`text-[10px] uppercase tracking-widest mt-0.5 ${activeTab === 'students' ? 'font-black' : 'font-bold'}`}>Pupils</span>
            </button>
          </div>

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

      {/* Removed fee collection for teachers per principal request */}
      
      {/* Student Profile & Direct Mark Management Modal */}
      <AnimatePresence>
        {showProfileModal && selectedStudentProfile && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-slate-200 shadow-2xl rounded-3xl"
            >
              {/* Modal Header */}
              <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center border-2 border-teal-300/30 overflow-hidden shrink-0 shadow-lg">
                    {getStudentPhoto(selectedStudentProfile) ? (
                      <img src={getStudentPhoto(selectedStudentProfile)} alt={selectedStudentProfile.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-slate-800 flex items-center justify-center" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight">{selectedStudentProfile.name}</h2>
                    <p className="text-xs text-teal-300 font-bold tracking-widest uppercase mt-1">
                      Roll #{selectedStudentProfile.rollNumber}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="p-2 hover:bg-white/10 transition-colors text-slate-300 hover:text-white rounded-xl cursor-pointer"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-10 text-left">
                {/* Information Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Student Bio</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase">Academic Email</p>
                        <p className="text-xs font-bold text-slate-800">{selectedStudentProfile.email}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase">Username</p>
                        <p className="text-xs font-mono text-slate-600">{selectedStudentProfile.username}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Guardian Context</h3>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase">Parent Phone</p>
                        <p className="text-xs font-mono font-bold text-slate-800">{selectedStudentProfile.parentPhone}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-400 uppercase">Guardian Name</p>
                        <p className="text-xs font-bold text-slate-800">{selectedStudentProfile.guardianName || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100 pb-2">Financial Status</h3>
                    <div className="bg-slate-50 p-3 border border-slate-100">
                      <p className="text-xs font-bold text-slate-400 uppercase">Monthly Base Fee</p>
                      <p className="text-lg font-black text-slate-900">{selectedStudentProfile.baseFee || '0'}</p>
                    </div>
                  </div>
                </div>

                {/* Mark Management Section */}
                <div className="pt-8 border-t border-slate-100 grid grid-cols-1 lg:grid-cols-2 gap-10">
                  {/* Mark Input Form */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-2">
                       <Award className="text-teal-600" size={20} />
                       <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider ">Direct Mark Management</h3>
                    </div>
                    
                    <div className="bg-teal-50/50 p-6 border border-teal-100 space-y-4 shadow-sm">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5 font-sans">
                          <label className="text-xs font-black text-teal-900 uppercase">Subject</label>
                          <input 
                            type="text"
                            value={profileMarkSubject}
                            onChange={(e) => setProfileMarkSubject(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-teal-200 text-xs font-bold focus:border-teal-600 focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1.5 font-sans">
                          <label className="text-xs font-black text-teal-900 uppercase">Max Marks</label>
                          <input 
                            type="number"
                            value={profileMarkMax}
                            onChange={(e) => setProfileMarkMax(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-teal-200 text-xs font-bold focus:border-teal-600 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5 font-sans">
                         <label className="text-xs font-black text-teal-900 uppercase">Test / Assignment Title</label>
                         <input 
                           type="text"
                           value={profileMarkExam}
                           onChange={(e) => setProfileMarkExam(e.target.value)}
                           placeholder="e.g. Monthly Test, Assignment 1"
                           className="w-full px-3 py-2 bg-white border border-teal-200 text-xs font-bold focus:border-teal-600 focus:outline-none"
                         />
                      </div>

                      <div className="space-y-1.5 font-sans">
                         <label className="text-xs font-black text-teal-900 uppercase">Marks Obtained</label>
                         <div className="flex items-center gap-3">
                           <input 
                             type="number"
                              value={profileMarkObtained}
                              onChange={(e) => setProfileMarkObtained(e.target.value.replace(/^0+(?=\d)/, ''))}
                             placeholder="Score"
                             className="w-full px-4 py-3 bg-white border border-teal-200 text-lg font-black text-teal-900 focus:border-teal-600 focus:outline-none"
                           />
                           <span className="text-slate-400 font-black text-xl ">/ {profileMarkMax}</span>
                         </div>
                      </div>

                      <button 
                        onClick={handleAddMarkFromProfile}
                        className="w-full py-4 bg-teal-600 hover:bg-slate-900 text-white text-xs font-black uppercase tracking-[0.2em] shadow-lg shadow-teal-200 transition-all active:scale-95"
                      >
                        Commit Mark to Record
                      </button>
                    </div>
                  </div>

                  {/* Existing Marks List */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                       <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Academic History</h3>
                       <span className="text-xs font-bold text-teal-600 uppercase">Latest Entries</span>
                    </div>

                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                      {marks.filter(m => m.studentId === selectedStudentProfile.id).length > 0 ? (
                        marks
                          .filter(m => m.studentId === selectedStudentProfile.id)
                          .sort((a, b) => b.id.localeCompare(a.id))
                          .map(m => (
                            <div key={m.id} className="p-4 bg-white border border-slate-100 flex items-center justify-between hover:border-teal-200 transition-all shadow-xs rounded-xl">
                              <div className="text-left">
                                <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">{m.examType}</h4>
                                <p className="text-xs text-slate-400 font-bold uppercase mt-0.5">{m.subject}</p>
                              </div>
                              <div className="text-right">
                                <span className={`text-base font-black  ${ (m.marksObtained / Math.max(1, m.maxMarks)) >= 0.33 ? 'text-amber-600' : 'text-rose-600'}`}>
                                  {m.marksObtained}
                                </span>
                                <span className="text-xs text-slate-300 font-bold"> / {m.maxMarks}</span>
                              </div>
                            </div>
                          ))
                      ) : (
                        <div className="py-12 border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-slate-400 gap-3">
                           <Award size={32} className="opacity-20" />
                           <p className="text-xs font-bold uppercase tracking-widest">No academic records found</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setShowProfileModal(false)}
                  className="px-8 py-3 bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                >
                  Close Profile
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Minimalist Parent Message Notification Alert Popup */}
      {feeNotificationPopup && (
        <div id="parent-notification-modal-teacher" className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-[999] backdrop-blur-sm animate-fade-in">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-slate-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col rounded-xl"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bell size={20} className="text-teal-600" />
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-900">Receipt Dispatch</h3>
              </div>
              <button 
                onClick={() => setFeeNotificationPopup(null)}
                className="text-slate-400 hover:text-slate-900 transition-colors"
                title="Close window"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 space-y-6">
              <div className="flex justify-between items-end border-b border-slate-50 pb-4">
                <div className="text-left">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Recipient Parent</p>
                  <p className="text-sm font-bold text-slate-900">{feeNotificationPopup.guardianName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Phone Number</p>
                  <p className="text-xs font-mono font-bold text-slate-600">{feeNotificationPopup.parentPhone}</p>
                </div>
              </div>

              <div className="space-y-2 text-left">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Message Content</label>
                <textarea
                  value={feeNotificationPopup.messageText}
                  onChange={(e) => {
                    const revisedText = e.target.value;
                    setFeeNotificationPopup(prev => prev ? { ...prev, messageText: revisedText } : null);
                  }}
                  rows={6}
                  className="w-full bg-slate-50 text-xs p-4 rounded-xl text-slate-800 border border-slate-100 focus:outline-none focus:border-teal-600 leading-relaxed resize-none font-medium"
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(feeNotificationPopup.messageText);
                    toast.success("Copied to clipboard");
                  }}
                  className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black uppercase tracking-[0.2em] transition-all"
                >
                  Copy Text
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-4 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setFeeNotificationPopup(null)}
                className="px-6 py-2 bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all font-sans"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
