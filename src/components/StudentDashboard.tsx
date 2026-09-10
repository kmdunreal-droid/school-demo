import { subscribeRecords, loadCollectionFromSupabase, sbQueueWrite, flushSupabase } from '../lib/supabaseSync';
import { listChanged } from '../lib/dataUtils';
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { 
  Award, Calendar, Clock, LogOut, CheckSquare, Sparkles, BookOpen, 
  Menu, X, TrendingUp, Info, User, CheckCircle2, AlertCircle, CreditCard, Bell, Sun, Moon, Download, Fingerprint, ClipboardList
} from 'lucide-react';
import { getNotifications, saveNotifications, addNotification, PortalNotification } from '../lib/notificationUtils';
import { getPeriodStatus, getStatusColor } from '../lib/periodUtils';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Teacher, Student, Class, TimetableEntry, Attendance, Mark, UserSession, DayOfWeek, FeeRecord, Assignment } from '../types';
import { loadFromLocalStorage, getStudentFullAccount, StudentFeeData } from '../lib/feeEngine';
import AttendanceSwipeOverlay from './AttendanceSwipeOverlay';

interface StudentDashboardProps {
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

type TabType = 'dashboard' | 'attendance' | 'marks' | 'timetable' | 'fees' | 'id_card' | 'assignments';

import { safeStorage } from '../lib/safeStorage';

export default function StudentDashboard({
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
  marks,
  setMarks,
  fees,
  setFees,
  assignments,
  setAssignments,
  onLogout,
  installPromptEvent,
  onInstallApp
}: StudentDashboardProps) {
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
  const studentsRef = useRef(students);
  const classesRef = useRef(classes);
  const timetableRef = useRef(timetable);
  const attendanceRef = useRef(attendance);
  const marksRef = useRef(marks);
  const assignmentsRef = useRef(assignments);
  useEffect(() => { studentsRef.current = students; }, [students]);
  useEffect(() => { classesRef.current = classes; }, [classes]);
  useEffect(() => { timetableRef.current = timetable; }, [timetable]);
  useEffect(() => { attendanceRef.current = attendance; }, [attendance]);
  useEffect(() => { marksRef.current = marks; }, [marks]);
  useEffect(() => { assignmentsRef.current = assignments; }, [assignments]);

  // Real-time Supabase listener — WebSocket push; doosri devices ki changes turant apply
  useEffect(() => {
    const applyReload = async () => {
      try {
        const [studentsData, classesData, timetableData, attendanceData, marksData, assignmentsData] = await Promise.all([
          loadCollectionFromSupabase('students'),
          loadCollectionFromSupabase('classes'),
          loadCollectionFromSupabase('timetable'),
          loadCollectionFromSupabase('attendance'),
          loadCollectionFromSupabase('marks'),
          loadCollectionFromSupabase('assignments'),
        ]);
        let changed = false;
        if (studentsData && listChanged(studentsRef.current, studentsData)) {
          studentsRef.current = studentsData;
          setStudents(studentsData);
          changed = true;
        }
        if (classesData && listChanged(classesRef.current, classesData)) {
          classesRef.current = classesData;
          setClasses(classesData);
          changed = true;
        }
        if (timetableData && listChanged(timetableRef.current, timetableData)) {
          timetableRef.current = timetableData;
          setTimetable(timetableData);
          changed = true;
        }
        if (attendanceData && listChanged(attendanceRef.current, attendanceData)) {
          attendanceRef.current = attendanceData;
          setAttendance(attendanceData);
          changed = true;
        }
        if (marksData && listChanged(marksRef.current, marksData)) {
          marksRef.current = marksData;
          setMarks(marksData);
          changed = true;
        }
        if (assignmentsData && listChanged(assignmentsRef.current, assignmentsData)) {
          assignmentsRef.current = assignmentsData;
          setAssignments(assignmentsData);
          changed = true;
        }
        if (changed) console.log('[Sync:RT] StudentDashboard reloaded from Supabase');
      } catch (e: any) {
        console.warn('[Sync:RT] StudentDashboard reload failed:', e?.message);
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
  
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const [feeStudents, setFeeStudents] = useState<StudentFeeData[]>(() => loadFromLocalStorage());

  // Find student's personal profile card
  const studentProfile = students.find(s => s.id === userSession.id);
  const studentId = studentProfile?.id || '';
  const currentClassId = studentProfile?.classId || '';

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

  // Real-time period checking for students
  useEffect(() => {
    const checkActivePeriodsForStudent = () => {
      // Find today's lectures for this student's class
      const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const systemDayName = systemDays[new Date().getDay()];
      
      const myTodayLectures = timetable.filter(tt => tt.classId === currentClassId && tt.day === systemDayName);
      if (myTodayLectures.length === 0) return;

      myTodayLectures.forEach(lecture => {
        try {
          const status = getPeriodStatus(lecture.time);
          if (status === 'current') {
            // Check if we already notified during this session
            if (!notifiedPeriodsRef.current.includes(lecture.id)) {
              notifiedPeriodsRef.current.push(lecture.id);
              
              const teacherObj = teachers.find(t => t.id === lecture.teacherId);
              const instStr = teacherObj ? teacherObj.name : 'Faculty';
              
              // Trigger Toast Notification
              toast.success(`🔔 Class Bell: ${lecture.period} has started!`, {
                description: `Subject "${lecture.subject}" has commenced with ${instStr}.`,
                duration: 8000
              });

              // Add notification to cache
              addNotification({
                type: 'period_bell',
                title: `${lecture.period} Active ⏰`,
                message: `Your school bell is ringing! Period lecture for "${lecture.subject}" under instructor ${instStr} has now commenced. Prepare your textbooks!`,
                teacherId: lecture.teacherId,
                classId: currentClassId,
                role: 'student'
              });
            }
          }
        } catch (e) {}
      });
    };

    const interval = currentClassId ? setInterval(checkActivePeriodsForStudent, 11000) : null;
    checkActivePeriodsForStudent();

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timetable, currentClassId, teachers]);

  const handleMarkAllRead = () => {
    const updated = notifications.map(n => ({ ...n, isUnread: false }));
    saveNotifications(updated);
    setNotifications(updated);
    toast.success("All messages marked as read.");
  };

  const handleClearNotifications = () => {
    saveNotifications([]);
    setNotifications([]);
    toast.success("Notification history cleared.");
  };

  // Get classroom properties
  const assignedClass = classes.find(c => c.id === currentClassId);
  const classTeacherId = assignedClass?.classTeacherId || '';
  const classTeacherObj = teachers.find(t => t.id === classTeacherId);

  // FILTERED STUDENT METRICS
  const myAttendance = attendance.filter(a => a.studentId === studentId);
  const totalDays = myAttendance.length;
  const presentDays = myAttendance.filter(a => a.status === 'present').length;
  const attendancePercent = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 100;

  const myMarks = marks.filter(m => m.studentId === studentId);

  const myAssignments = React.useMemo(
    () => assignments
      .filter(a => a.classId === currentClassId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [assignments, currentClassId]
  );

  // Performance trends data formatting for Recharts Line Chart
  const examOrder = ['Unit Test', 'Half Yearly', 'Final'];
  const uniqueSubjects = Array.from(new Set(myMarks.map(m => m.subject)));
  const SUBJECT_COLORS: Record<string, string> = {
    Maths: '#6366f1',     // Indigo
    Mathematics: '#6366f1',
    Science: '#0d9488',   // Emerald
    English: '#f59e0b',   // Amber
    History: '#ef4444',   // Red
    Urdu: '#8b5cf6',      // Purple
    Geography: '#06b6d4', // Cyan
    Civics: '#ec4899',    // Pink
    Islamiat: '#14b8a6',  // Teal
    Computer: '#3b82f6',  // Blue
  };
  const PALETTE = ['#6366f1', '#0d9488', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#3b82f6', '#f97316'];
  const getSubjectColor = (sub: string, index: number) => SUBJECT_COLORS[sub] || PALETTE[index % PALETTE.length];

  const trendChartData = examOrder.map(exam => {
    const entry: Record<string, any> = { name: exam };
    let hasValue = false;
    uniqueSubjects.forEach(sub => {
      const match = myMarks.find(m => m.examType === exam && m.subject === sub);
      if (match) {
        entry[sub] = Math.round((match.marksObtained / Math.max(1, match.maxMarks)) * 100);
        hasValue = true;
      } else {
        entry[sub] = null;
      }
    });
    return { entry, hasValue };
  })
  .filter(item => item.hasValue)
  .map(item => item.entry);

  // FEE PORTAL LOCAL STATES
  const [selectedPayFee, setSelectedPayFee] = useState<FeeRecord | null>(null);
  const [payMethod, setPayMethod] = useState<string>('Credit Card');
  const [swipeSuccess, setSwipeSuccess] = useState<boolean>(false);
  const [isAttendanceOverlayOpen, setIsAttendanceOverlayOpen] = useState(false);
  const [feeChallanPrint, setFeeChallanPrint] = useState<FeeRecord | null>(null);

  const handleUpdateIDCard = async (theme: string, color: string) => {
    if (!studentProfile) return;
    
    const updatedStudent: Student = {
      ...studentProfile,
      idCardTheme: theme,
      idCardColor: color
    };
    
    setStudents(prev => prev.map(s => s.id === studentProfile.id ? updatedStudent : s));
    
    // Also save to database (Supabase)
    try {
      sbQueueWrite('students', String(studentProfile.id), updatedStudent);
      await flushSupabase();
      toast.success("ID Card design saved permanently!");
    } catch (err) {
      console.error(err);
      toast.error("Saved locally, but failed to sync with cloud.");
    }
  };

  const handleCompletePayment = () => {
    if (!selectedPayFee) return;
    
    // update parent fees state
    setFees(prev => prev.map(f => {
      if (f.id === selectedPayFee.id) {
        return {
          ...f,
          status: 'paid',
          paidDate: new Date().toISOString().split('T')[0],
          paymentMethod: payMethod
        };
      }
      return f;
    }));

    setSwipeSuccess(true);
    setTimeout(() => {
      setSwipeSuccess(false);
      setSelectedPayFee(null);
    }, 2500);
  };

  // Get teacher's name helper
  const getTeacherName = (tId: string) => {
    const t = teachers.find(item => item.id === tId);
    return t ? t.name : 'Unknown Faculty';
  };

  // Convert scores into letter grade categories
  const calculateGrade = (obtained: number, max: number): { letter: string; color: string } => {
    const pct = (obtained / max) * 100;
    if (pct >= 90) return { letter: 'A+', color: 'text-amber-700 bg-amber-50 border-amber-200' };
    if (pct >= 80) return { letter: 'A', color: 'text-amber-600 bg-amber-50 border-amber-100' };
    if (pct >= 70) return { letter: 'B', color: 'text-teal-600 bg-teal-50 border-teal-100' };
    if (pct >= 60) return { letter: 'C', color: 'text-yellow-700 bg-yellow-50 border-yellow-200' };
    if (pct >= 50) return { letter: 'D', color: 'text-orange-700 bg-orange-50 border-orange-200' };
    return { letter: 'F', color: 'text-red-700 bg-red-50 border-red-200' };
  };

  // Group Timetable elements neatly
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  
  const getPeriodsList = () => {
    const defaultPeriods = ['Period 1', 'Period 2', 'Period 3', 'Period 4', 'Period 5'];
    try {
      const saved = safeStorage.getItem('acadamis_extra_periods');
      const deletedSaved = safeStorage.getItem('acadamis_deleted_periods');
      const deleted = deletedSaved ? JSON.parse(deletedSaved) : {};
      const classDeleted = (currentClassId ? (deleted[currentClassId] || []) : []) as string[];

      let baseList = [...defaultPeriods];
      if (saved) {
        const extra = JSON.parse(saved);
        // Load extra periods for student's class, or fall back to any extra periods across all classes if class-specific not set
        const classExtras = (currentClassId ? (extra[currentClassId] || []) : Object.values(extra).flat()) as string[];
        baseList = [...baseList, ...classExtras];
      }

      const unique = Array.from(new Set(baseList)).filter(p => !classDeleted.includes(p));
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

  return (
    <div id="student-dashboard-root" className="min-h-screen bg-gray-50 flex flex-col md:flex-row pb-16 md:pb-0 relative">
      
      <AttendanceSwipeOverlay isOpen={isAttendanceOverlayOpen} onClose={() => setIsAttendanceOverlayOpen(false)}>
        {/* Simplified Attendance view inside the overlay */}
         <div className="space-y-4">
            <div className="text-center">
                <span className="text-4xl font-black text-teal-600">{attendancePercent}%</span>
                <p className="text-sm font-bold text-gray-500">Attendance Rate</p>
            </div>
            <div className="border-t pt-4">
                <p className="text-xs font-bold uppercase text-gray-400">Log Summary</p>
                <div className="mt-2 text-sm text-gray-700">
                    <p>Total Days: {totalDays}</p>
                    <p className="text-amber-600">Present Days: {presentDays}</p>
                    <p className="text-rose-600">Absent Days: {totalDays - presentDays}</p>
                </div>
            </div>
         </div>
      </AttendanceSwipeOverlay>

      {/* Mobile Top Navigation Indicator */}
      <div id="student-mobile-bar" className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="NSB1 Logo" className="w-20 h-20 object-contain" referrerPolicy="no-referrer" />
          <h1 className="font-black text-gray-900 tracking-tight uppercase tracking-[0.1em] text-xl sm:text-2xl">NSB1 School</h1>
        </div>
        <div className="flex items-center gap-2 relative">
          {/* Mobile Bell Button */}
          <button 
            type="button"
            onClick={() => setShowNotifDropdown(!showNotifDropdown)}
            className="p-1.5 text-slate-500 hover:text-slate-900 transition-colors relative"
            title="Notifications"
          >
            <Bell size={18} />
            {notifications.filter(n => n.isUnread).length > 0 && (
              <span className="absolute -top-1 -right-1 bg-teal-600 text-white font-black text-[10px] w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
                {notifications.filter(n => n.isUnread).length}
              </span>
            )}
          </button>

          <button 
            id="student-sidebar-toggle" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Dropdown sidebar cover overlay */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)} 
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
        />
      )}

      {/* Student Nav Drawer */}
      <div 
        id="sidebar-student" 
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
        {/* Institutional Branding */}
        <div className="p-4 border-b border-slate-50 flex flex-col items-center gap-2">
          <div className="flex items-center justify-between w-full">
            <img 
              src="/logo.png" 
              alt="NSB 1 ACADEMY" 
              className="h-16 w-auto object-contain animate-bounce-slow"
              referrerPolicy="no-referrer"
            />
            <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="md:hidden flex items-center justify-center px-2 h-9 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="text-center w-full">
            <h1 className="text-slate-900 font-black text-sm tracking-widest uppercase leading-none">NSB1 Academy</h1>
            <p className="text-slate-400 font-bold text-[10px] tracking-[0.3em] uppercase mt-1">Student Portal</p>
          </div>
        </div>

        {/* Minimalist Navigation */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-1 mt-2">
            {[
              { id: 'dashboard', label: 'Campus', icon: Sparkles },
              { id: 'attendance', label: 'Presence', icon: CheckSquare },
              { id: 'marks', label: 'Grades', icon: Award },
              { id: 'assignments', label: 'Diary', icon: ClipboardList },
              { id: 'timetable', label: 'Classes', icon: Calendar },
              { id: 'fees', label: 'Payments', icon: CreditCard },
              { id: 'id_card', label: 'ID Card', icon: Award }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => { 
                  handleTabChange(item.id as TabType); 
                  setSidebarOpen(false); 
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-xs font-black uppercase tracking-widest text-left transition-all ${
                  activeTab === item.id 
                    ? 'bg-teal-600 text-white shadow-md' 
                    : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <item.icon size={14} className={activeTab === item.id ? 'text-white' : 'text-slate-300'} />
                {item.label}
              </button>
            ))}

            {/* Install Button in Student Sidebar */}
            <button
              onClick={onInstallApp}
              className="w-full flex items-center gap-3 px-4 py-3 text-xs font-black uppercase tracking-widest text-left transition-all bg-teal-50 text-teal-700 hover:bg-teal-100 mt-2 border border-teal-100"
            >
              <Download size={14} className="text-teal-600" />
              Install App
            </button>
          </nav>

        {/* Minimalist Account Section */}
        <div className="p-6 border-t border-slate-50">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center text-white font-black text-xs ">
              <User size={14} />
            </div>
            <div className="truncate">
              <p className="text-slate-900 text-xs font-black uppercase tracking-tight truncate">{userSession.name.split(' ').slice(0, 1).join(' ') || userSession.name}</p>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-widest truncate">Roll #{studentProfile?.rollNumber}</p>
            </div>
          </div>
          
          <button
            onClick={onLogout}
            className="w-full py-4 bg-rose-600 text-white hover:bg-rose-700 transition-all text-xs font-black uppercase tracking-widest text-center cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-rose-100"
          >
            <LogOut size={16} />
            EXIT CAMPUS PORTAL
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <main className="flex-1 min-h-screen flex flex-col p-4 md:p-8 lg:p-10 max-w-7xl mx-auto w-full text-slate-800 font-sans">
        
        {/* Global Desktop Top Bar with Real-time Period Alert & Notification Bell */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-6 z-30 relative font-sans">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="NSB1 Logo" className="h-20 w-auto object-contain sm:block hidden" referrerPolicy="no-referrer" />
              <h2 className="text-3xl font-black text-slate-900 tracking-tight sm:block hidden select-none">NSB1 Academy Student portal</h2>
            </div>
            
            {/* Real-time active period locator */}
            {(() => {
              // Find today's current lecture based on clock time & selected day
              const currentPeriodObj = timetable.find(tt => {
                if (tt.classId !== currentClassId) return false;
                const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const systName = systemDays[new Date().getDay()];
                if (tt.day !== systName) return false;
                
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
                  No Active Class Right Now
                </div>
              );

              const teacherObj = teachers.find(t => t.id === currentPeriodObj.teacherId);

              return (
                <div className="flex items-center gap-2 px-3 py-1 bg-teal-50 border border-teal-100 text-teal-700 rounded-full text-xs font-extrabold uppercase tracking-widest animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-ping"></span>
                  CURRENT PERIOD: {currentPeriodObj.period} — {currentPeriodObj.subject} (Prof. {teacherObj?.name || 'Faculty'})
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-3">
            {/* Quick Dark Mode Toggler */}
            <button
              type="button"
              onClick={handleToggleTheme}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl transition-all flex items-center justify-center text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900"
              title="Toggle Dark/Light Mode"
            >
              {darkTheme ? <Sun size={15} className="text-amber-500 animate-pulse" /> : <Moon size={15} />}
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
                        <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest">Campus Broadcaster</span>
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
        
        {/* ========== STUDENT DASHBOARD HOME ========== */}
        {activeTab === 'dashboard' && (
          <div id="panel-student-home" className="space-y-8 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            {/* Greeting Header */}
            <div className="bg-white rounded-xl p-6 md:p-8 border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-t-4 border-t-teal-600">
              <div>
                <span className="text-xs font-extrabold text-teal-600 uppercase tracking-widest block mb-1">STUDENT ADVISORY</span>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight font-display uppercase">Hello, {userSession.name.split(' ').slice(0, 1).join(' ') || userSession.name}!</h1>
                <p className="text-sm text-slate-500 mt-1">
                  Enrolled in <strong className="text-teal-800 font-bold">{assignedClass ? `${assignedClass.className} - ${assignedClass.section}` : 'N/A Class'}</strong>.
                  {classTeacherObj && (
                    <span> Advisory Teacher: <strong className="text-slate-800">{classTeacherObj.name}</strong>.</span>
                  )}
                </p>
              </div>

              <div className="flex gap-2.5">
                <div className="p-4 bg-teal-50 rounded-xl border border-teal-100/60 text-center">
                  <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider">Attendance Rate</h4>
                  <p className="text-xl font-bold text-teal-900 mt-1">{attendancePercent}%</p>
                </div>

                <div className="p-4 bg-amber-50 rounded-xl border border-amber-100/60 text-center">
                  <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">Marks Logged</h4>
                  <p className="text-xl font-bold text-amber-900 mt-1">{myMarks.length} elements</p>
                </div>
              </div>
            </div>

            {/* Widgets Section Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Attendance Card widget - Geometric style */}
              <motion.div 
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                onDragEnd={(_, info) => {
                  if (info.offset.x > 100 || info.offset.x < -100) {
                    setIsAttendanceOverlayOpen(true);
                  }
                }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                className="bg-white p-6 border-b-4 border-teal-500 shadow-sm rounded-xl hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div onClick={() => handleTabChange('attendance')}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide font-display flex items-center gap-1.5">
                      <CheckCircle2 className="text-teal-600" size={18} />
                      My Attendance Gauge
                      <span className="text-xs text-gray-400 font-normal ">(Swipe to open)</span>
                    </h3>
                    <span className="text-xs font-mono font-bold text-teal-100 bg-teal-700 px-1.5 py-0.5">{presentDays}/{totalDays} Days</span>
                  </div>

                  {/* Attendance visual bar */}
                  <div className="my-5">
                    <div className="h-3 w-full bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
                      <div 
                        className={`h-full rounded-xl transition-all duration-500 ${
                          attendancePercent >= 75 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${attendancePercent}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {attendancePercent >= 75 
                        ? 'Good Job! Your attendance is matching the required collegiate percentage index.' 
                        : 'Warning: Your attendance is below standard requirements (75%). please attend regular lectures.'}
                    </p>
                  </div>
                </div>

                <span className="text-xs font-bold text-teal-600 mt-4 flex items-center gap-1 hover:underline">
                  Inspect Attendance Logs →
                </span>
              </motion.div>

              {/* Marks Quick Peek Widget - Geometric style */}
              <div 
                onClick={() => handleTabChange('marks')}
                className="bg-white p-6 border-b-4 border-amber-500 shadow-sm rounded-xl hover:shadow-md transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide font-display flex items-center gap-1.5 mb-3">
                    <Award className="text-amber-500" size={18} />
                    Report Card Highlights
                  </h3>
                  
                  {myMarks.length > 0 ? (
                    <div className="space-y-2 py-1">
                      {myMarks.slice(0, 3).map((item) => {
                        const grade = calculateGrade(item.marksObtained, item.maxMarks);
                        return (
                          <div key={item.id} className="flex justify-between items-center text-xs">
                            <div>
                              <span className="font-semibold text-slate-900">{item.subject}</span>
                              <span className="text-slate-400 font-medium ml-1.5">({item.examType})</span>
                            </div>
                            <span className={`font-mono font-bold px-1.5 py-0.5 rounded-xl text-xs border-l-2 bg-slate-50 ${grade.color}`}>
                              Grade {grade.letter} ({item.marksObtained}/{item.maxMarks})
                            </span>
                          </div>
                        );
                      })}
                      {myMarks.length > 3 && (
                        <p className="text-xs text-teal-600 text-right font-medium ">+{myMarks.length - 3} more entries recorded...</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 py-4  font-sans text-center bg-slate-50/50 border border-slate-100">No academic grades has been entered by instructors yet.</p>
                  )}
                </div>

                <span className="text-xs font-bold text-teal-600 mt-4 flex items-center gap-1 hover:underline">
                  Launch View Academic marks →
                </span>
              </div>

            </div>

            {/* ========== ACADEMIC SUBJECT PROGRESS SUMMARY ========== */}
            <div id="academic-progress-summary-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm border-t-4 border-t-amber-500 rounded-xl animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide font-display flex items-center gap-2">
                    <BookOpen className="text-amber-500" size={18} />
                    Academic Mastery & Subject Progress
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Analyzing cumulative score percentages across all logged examinations and curriculum blocks.
                  </p>
                </div>
                <div className="text-xs uppercase font-mono font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-850 border border-slate-150 dark:border-slate-800 px-2.5 py-1">
                  Overall Academic Weightage
                </div>
              </div>

              {uniqueSubjects.length === 0 ? (
                <div className="py-12 text-center text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-850  text-xs font-medium">
                  📚 No subject-wise statistics can be generated yet because your teachers have not uploaded any exam marks.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                  {uniqueSubjects.map(subject => {
                    const subjectMarks = myMarks.filter(m => m.subject === subject);
                    const totalObtained = subjectMarks.reduce((sum, m) => sum + m.marksObtained, 0);
                    const totalMax = subjectMarks.reduce((sum, m) => sum + m.maxMarks, 0);
                    const percentage = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;
                    
                    // Progress bar color based on score tier
                    let barColor = 'bg-rose-500';
                    let textColor = 'text-rose-600 dark:text-rose-400';
                    let bgColor = 'bg-rose-50 dark:bg-rose-950/20';
                    let label = 'Needs Focus ⚠️';
                    
                    if (percentage >= 85) {
                      barColor = 'bg-amber-500';
                      textColor = 'text-amber-600 dark:text-amber-400';
                      bgColor = 'bg-amber-50 dark:bg-amber-600/20';
                      label = 'Excellent 🌟';
                    } else if (percentage >= 70) {
                      barColor = 'bg-teal-500';
                      textColor = 'text-teal-600 dark:text-teal-400';
                      bgColor = 'bg-teal-50 dark:bg-teal-900/20';
                      label = 'Capable 👍';
                    } else if (percentage >= 50) {
                      barColor = 'bg-amber-500';
                      textColor = 'text-amber-600 dark:text-amber-400';
                      bgColor = 'bg-amber-50 dark:bg-amber-950/20';
                      label = 'Average 📈';
                    }

                    return (
                      <div key={subject} className="space-y-2 border-b border-slate-100 dark:border-slate-850 pb-4 last:border-0 last:pb-0">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-extrabold text-slate-950 dark:text-white uppercase tracking-wider">{subject}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-xl font-mono ${bgColor} ${textColor}`}>
                              {label}
                            </span>
                            <span className="font-mono font-black text-slate-900 dark:text-slate-100">{percentage}%</span>
                          </div>
                        </div>

                        {/* Progress Bar Container */}
                        <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                          <motion.div 
                            className={`h-full rounded-xl ${barColor}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 1, ease: 'easeOut' }}
                          />
                        </div>

                        {/* Micro exam data logs inside progress breakdown */}
                        <div className="flex flex-wrap gap-1.5 mt-1 text-xs text-slate-400 font-medium">
                          {subjectMarks.map((m) => (
                            <span key={m.id} className="bg-slate-50 dark:bg-slate-950/45 px-1.5 py-0.5 border border-slate-100 dark:border-slate-850/50">
                              {m.examType}: <strong className="text-slate-700 dark:text-slate-300 font-bold">{m.marksObtained}/{m.maxMarks}</strong>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ========== ACADEMIC PERFORMANCE TREND CHART ========== */}
            <div id="academic-performance-trend-block" className="bg-white border border-slate-200 p-6 shadow-sm border-t-4 border-t-teal-600">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide font-display flex items-center gap-2">
                    <TrendingUp className="text-teal-600" size={18} />
                    Academic Performance Trends
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Visualizing normalized percentage scores scored across sequential evaluation cycles.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-bold uppercase font-mono">
                  <span className="bg-slate-100 text-slate-600 px-2 py-1">Normalized to %</span>
                  {uniqueSubjects.length > 0 && (
                    <span className="bg-teal-50 text-teal-700 px-2 py-1 border border-teal-100">
                      {uniqueSubjects.length} Subjects Tracked
                    </span>
                  )}
                </div>
              </div>

              {trendChartData.length === 0 ? (
                <div className="py-12 text-center text-slate-400 bg-slate-50 border border-slate-100  text-xs font-medium">
                  📈 Academic trend graphs will automatically generate once scorecard details are populated by teachers.
                </div>
              ) : (
                <div className="w-full h-[320px] -ml-4 pr-2 select-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#64748b" 
                        fontSize={10} 
                        fontWeight={700}
                        tickLine={false}
                        axisLine={false}
                        dy={8}
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={10} 
                        fontWeight={700}
                        domain={[0, 100]} 
                        unit="%" 
                        tickLine={false}
                        axisLine={false}
                        dx={-8}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px' }}
                        labelStyle={{ fontWeight: 'black', color: '#38bdf8', marginBottom: '4px', textTransform: 'uppercase' }}
                        itemStyle={{ padding: '2px 0' }}
                      />
                      <Legend 
                        verticalAlign="top" 
                        height={40} 
                        iconType="circle" 
                        iconSize={8}
                        wrapperStyle={{ fontSize: '11px', fontWeight: 650, textTransform: 'uppercase' }}
                      />
                      {uniqueSubjects.map((sub, idx) => (
                        <Line
                          key={sub}
                          type="monotone"
                          dataKey={sub}
                          stroke={getSubjectColor(sub, idx)}
                          strokeWidth={3}
                          activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                          dot={{ r: 4, strokeWidth: 2 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Sandbox details */}
            <div className="bg-white text-slate-600 rounded-2xl p-5 border border-slate-200 shadow-sm flex items-start gap-3 shadow-xs">
              <Info size={18} className="text-teal-600 shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-bold text-teal-600 uppercase tracking-widest">Dynamic Sandbox Update :</span>
                <p className="text-xs text-slate-300 mt-1 font-sans">
                  You can test this portal's response: Log out, log in as principal/teacher, edit attendance logs or enter new exam scores for "Jane Doe", then re-login as student student@school.com to see instant student view synchronization.
                </p>
              </div>
            </div>

          </div>
        )}

        {/* ========== ATTENDANCE LOG BOOK ========== */}
        {activeTab === 'attendance' && (
          <div id="panel-student-attendance" className="space-y-6 animate-fade-in bg-rose-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-rose-100 shadow-inner">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Attendance Log History</h1>
              <p className="text-xs text-gray-500 mt-0.5">Evaluate cumulative presence, date stamps, and verify teacher registers.</p>
            </div>

            {/* Attendance Gauge Bar chart summary */}
            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
              <div className="text-center md:border-r border-gray-100 py-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Classes Conducted</span>
                <h3 className="text-4xl font-black text-gray-900 mt-2">{totalDays} Sessions</h3>
              </div>

              <div className="text-center md:border-r border-gray-100 py-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total days Attended</span>
                <h3 className="text-4xl font-black text-amber-600 mt-2">{presentDays} Present</h3>
                <p className="text-xs text-gray-400 mt-0.5">{totalDays - presentDays} absent logs</p>
              </div>

              <div className="text-center py-2">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Overall Ratio</span>
                <h3 className={`text-4xl font-black mt-2 ${attendancePercent >= 75 ? 'text-teal-600' : 'text-rose-600'}`}>
                  {attendancePercent}%
                </h3>
              </div>
            </div>

            {/* Attendance Days list table */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="p-4 bg-gray-50/50 border-b border-gray-100">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">Attendance Log Journal</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-sm font-bold text-gray-500 uppercase tracking-widest bg-gray-50">
                      <th className="px-6 py-3.5">Log Date</th>
                      <th className="px-6 py-3.5">Academic Calendar Period</th>
                      <th className="px-6 py-3.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {myAttendance.length > 0 ? (
                      myAttendance.map(log => (
                        <tr key={log.id} className="hover:bg-gray-55/20 transition-colors">
                          <td className="px-6 py-4 font-bold text-slate-800">{log.date}</td>
                          <td className="px-6 py-4 text-sm font-semibold text-gray-500">General Academic Session</td>
                          <td className="px-6 py-4">
                            <div className="flex justify-center text-center">
                              <span className={`inline-flex px-3 py-1 text-sm font-extrabold rounded-full ${
                                log.status === "present" ? "bg-amber-600 text-white font-black shadow-xs" : log.status === "absent" ? "bg-rose-600 text-white font-black shadow-xs animate-pulse" : log.status === "late" ? "bg-amber-500 text-white font-black shadow-xs" : "bg-teal-600 text-white font-black shadow-xs"
                              }`}>
                                {log.status.toUpperCase()}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center text-gray-400  text-sm font-medium">
                          No attendance records have been registered for your ID.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ========== REPORT CARD MARKS VIEW ========== */}
        {activeTab === 'marks' && (
          <div id="panel-student-marks" className="space-y-6 animate-fade-in bg-teal-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-teal-100 shadow-inner">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Academic Score Sheets</h1>
              <p className="text-xs text-gray-500 mt-0.5">Review scores, max markings, automated letter grades, and subject distributions.</p>
            </div>

            {/* ========== ACADEMIC PERFORMANCE TREND CHART ========== */}
            {trendChartData.length > 0 && (
              <div id="academic-marks-trend-graph" className="bg-white border border-slate-200 p-6 shadow-sm border-t-4 border-t-amber-500">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 uppercase tracking-wide font-display flex items-center gap-2">
                      <TrendingUp className="text-amber-500" size={18} />
                      Academic Performance Trends
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Progress tracking of subject scores across unit and summative tests.
                    </p>
                  </div>
                  <div className="bg-amber-50 text-amber-900 border border-amber-150 px-2.5 py-1 text-xs font-bold uppercase font-mono">
                    Scores Shown in % Scale
                  </div>
                </div>

                <div className="w-full h-[280px] -ml-4 pr-2 select-none">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#64748b" 
                        fontSize={10} 
                        fontWeight={700}
                        tickLine={false}
                        axisLine={false}
                        dy={8}
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={10} 
                        fontWeight={700}
                        domain={[0, 100]} 
                        unit="%" 
                        tickLine={false}
                        axisLine={false}
                        dx={-8}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px' }}
                        labelStyle={{ fontWeight: 'black', color: '#f59e0b', marginBottom: '4px', textTransform: 'uppercase' }}
                        itemStyle={{ padding: '2px 0' }}
                      />
                      <Legend 
                        verticalAlign="top" 
                        height={40} 
                        iconType="circle" 
                        iconSize={8}
                        wrapperStyle={{ fontSize: '11px', fontWeight: 650, textTransform: 'uppercase' }}
                      />
                      {uniqueSubjects.map((sub, idx) => (
                        <Line
                          key={sub}
                          type="monotone"
                          dataKey={sub}
                          stroke={getSubjectColor(sub, idx)}
                          strokeWidth={3}
                          activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                          dot={{ r: 4, strokeWidth: 2 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* List marks entries grouped by Exam Cycles */}
            {['Unit Test', 'Half Yearly', 'Final'].map(exam => {
              const examMarks = myMarks.filter(m => m.examType === exam);
              if (examMarks.length === 0) return null;

              return (
                <div key={exam} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
                  <div className="p-4 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
                      {exam} Assessment marks
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-50/20">
                          <th className="px-6 py-3">Subject Name</th>
                          <th className="px-6 py-3">Marking Scored</th>
                          <th className="px-6 py-3">Percentage Scored</th>
                          <th className="px-6 py-3 text-center">Letter Grade</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 text-sm">
                        {examMarks.map(item => {
                          const grade = calculateGrade(item.marksObtained, item.maxMarks);
                          const pct = Math.round((item.marksObtained / Math.max(1, item.maxMarks)) * 100);
                          return (
                            <tr key={item.id} className="hover:bg-gray-55/20">
                              <td className="px-6 py-4 font-bold text-slate-900">{item.subject}</td>
                              <td className="px-6 py-4 font-mono font-semibold text-gray-700">
                                {item.marksObtained} / {item.maxMarks}
                              </td>
                              <td className="px-6 py-4 text-xs font-semibold text-gray-500">{pct}%</td>
                              <td className="px-6 py-4">
                                <div className="flex justify-center">
                                  <span className={`inline-flex px-3 py-1 font-extrabold text-xs rounded-xl border ${grade.color}`}>
                                    Grade {grade.letter}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {myMarks.length === 0 && (
              <div className="py-12 text-center text-gray-400 bg-white border border-dashed border-gray-200 rounded-xl">
                No score records have been logged into your student register yet.
              </div>
            )}
          </div>
        )}

        {/* ========== STUDENT DIARY / ASSIGNMENTS ========== */}
        {activeTab === 'assignments' && (
          <div id="panel-student-assignments" className="space-y-6 animate-fade-in bg-amber-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-amber-100 shadow-inner pb-20">
            <div className="bg-gradient-to-r from-amber-600 to-teal-700 p-6 sm:p-8 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-8 shadow-lg border-b border-amber-700/50 rounded-b-2xl text-white">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl sm:text-2xl font-black tracking-tight font-display uppercase leading-none flex items-center gap-3">
                    <ClipboardList size={24} className="text-amber-200 shrink-0" />
                    Homework Diary
                  </h2>
                  <p className="text-xs text-amber-100 font-bold mt-2 uppercase tracking-widest">
                    Assignments posted by your teachers — check deadlines and complete on time.
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-amber-900/40 backdrop-blur-sm px-4 py-2 rounded-xl border border-amber-400/20 text-xs font-bold">
                  <span className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
                  <span>{myAssignments.length} Pending</span>
                </div>
              </div>
            </div>

            {(() => {
              const sorted = myAssignments;
              if (sorted.length === 0) {
                return (
                  <div className="py-16 text-center border-2 border-dashed border-amber-200 rounded-2xl bg-white/70">
                    <ClipboardList size={36} className="mx-auto text-amber-400 mb-4 opacity-30" />
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">No assignments yet</p>
                    <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mt-1">Your teacher has not posted any homework for this class.</p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sorted.map(assn => {
                    const isOverdue = assn.dueDate && assn.dueDate < new Date().toISOString().split('T')[0];
                    const dueSoon = !isOverdue && assn.dueDate && assn.dueDate <= new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
                    return (
                      <div key={assn.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[9px] font-black uppercase tracking-widest">
                              {assn.subject}
                            </span>
                            <span className="px-2.5 py-1 bg-slate-50 text-slate-500 border border-slate-200 rounded-full text-[9px] font-black uppercase tracking-widest">
                              {assn.assignedByName}
                            </span>
                            {isOverdue && (
                              <span className="px-2.5 py-1 bg-rose-50 text-rose-600 border border-rose-200 rounded-full text-[9px] font-black uppercase tracking-widest">
                                Overdue
                              </span>
                            )}
                            {dueSoon && (
                              <span className="px-2.5 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-full text-[9px] font-black uppercase tracking-widest">
                                Due Soon
                              </span>
                            )}
                          </div>
                          <h4 className="text-base font-black text-slate-900 uppercase tracking-tight leading-snug">{assn.title}</h4>
                          {assn.description && (
                            <p className="text-xs text-slate-500 font-medium leading-relaxed break-words whitespace-pre-wrap">
                              {assn.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                          <div className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${isOverdue ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-teal-50 text-teal-600 border border-teal-100'}`}>
                            <Calendar size={11} className="inline-block mr-1 -mt-0.5" />
                            {isOverdue ? 'Deadline Passed' : `Due: ${assn.dueDate}`}
                          </div>
                          <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">
                            {assn.createdAt ? new Date(assn.createdAt).toLocaleDateString() : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* ========== STUDENT PORTAL TIMETABLE GRID ========== */}
        {activeTab === 'timetable' && (
          <div id="panel-student-timetable" className="space-y-6 animate-fade-in bg-amber-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-amber-100 shadow-inner">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Weekly Subject Schedule</h1>
              <p className="text-xs text-gray-500 mt-0.5">Inspect weekly blocks, periods, assigned subject sessions, and faculty teachers.</p>
            </div>

            {/* Grid display */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] border-collapse text-left">
                  <thead>
                    <tr className="bg-gray-100/60 border-b border-gray-200">
                      <th className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-widest w-28">
                        Weekday
                      </th>
                      {PERIODS.map(p => (
                        <th key={p} className="px-4 py-3.5 text-xs font-bold text-gray-500 uppercase tracking-wider text-center border-l border-gray-100">
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
                          const entry = timetable.find(
                            tt => tt.classId === currentClassId && 
                                 tt.day === day && 
                                 tt.period === p
                          );

                          return (
                            <td key={p} className="px-3 py-3 text-center border-l border-gray-200 align-top min-w-36">
                              {(() => {
                                if (!entry) return (
                                  <span className="text-xs text-gray-300 font-medium  block py-4 select-none">
                                    Free Period
                                  </span>
                                );
                                
                                let col = '#6366f1'; // default indigo
                                try {
                                  const savedColors = safeStorage.getItem('acadamis_period_colors');
                                  if (savedColors) {
                                    const parsedColors = JSON.parse(savedColors);
                                    col = parsedColors[`${entry.classId}_${p}`] || '#6366f1';
                                  }
                                } catch (e) {}
                                
                                const systemDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                const systName = systemDays[new Date().getDay()];
                                const isLive = day === systName && getPeriodStatus(entry.time) === 'current';

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
                                      👤 {getTeacherName(entry.teacherId)}
                                    </div>
                                    <div className="text-xs font-mono text-slate-500 mt-1">
                                      {entry.time}
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
          </div>
        )}

        {/* ========== TUITION FEES DESK ========== */}
        {activeTab === 'fees' && (() => {
          const fStudent = feeStudents.find(
            s => String(s.id) === String(studentId) || 
                 s.name.toLowerCase() === studentProfile?.name?.toLowerCase() 
          ) || {
            id: studentId || `stu_${Date.now()}`,
            name: studentProfile?.name || userSession.name,
            class: assignedClass ? `${assignedClass.className}-${assignedClass.section}` : 'N/A',
            monthlyFee: studentProfile?.baseFee || 1500,
            payments: [],
            otherFunds: [],
            dues: []
          };

          const account = getStudentFullAccount(fStudent, 2026);

          return (
            <div id="panel-student-fees" className={`space-y-8 animate-fade-in font-sans font-medium bg-amber-50/50 p-4 sm:p-6 -mx-4 sm:-mx-6 rounded-2xl border border-amber-100 shadow-inner ${darkTheme ? 'text-slate-100 bg-amber-600/20 border-amber-900' : 'text-slate-800'}`}>
              <div>
                <span className={`text-xs px-2 py-0.5 font-black uppercase tracking-widest font-mono ${darkTheme ? 'bg-teal-900 text-teal-400 border border-teal-900' : 'bg-teal-50 text-teal-600 border border-teal-100'}`}>
                  Academic Fee Passbook
                </span>
                <h1 className={`text-2xl font-black uppercase font-display tracking-tight mt-1 flex items-center gap-2 ${darkTheme ? 'text-white' : 'text-slate-900'}`}>
                  <CreditCard size={24} className="text-teal-500" />
                  Your Account Ledger (2026)
                </h1>
                <p className={`text-xs mt-1 leading-relaxed ${darkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                  Real-time ledger entries displaying school tuition, other funds, fine accruals, and transaction receipts.
                </p>
              </div>

              {/* KPI CARDS */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className={`p-4 border shadow-sm rounded-2xl flex flex-col justify-between ${darkTheme ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                  <p className="text-xs font-black uppercase tracking-widest text-slate-400">Total Billed</p>
                  <p className={`text-xl font-black mt-1 ${darkTheme ? 'text-white' : 'text-slate-900'}`}>{account.totalDue.toLocaleString()}</p>
                  <p className="text-xs text-slate-400 font-mono mt-2">12 Months Core Tuition</p>
                </div>
                <div className={`p-4 border shadow-sm rounded-2xl flex flex-col justify-between ${darkTheme ? 'bg-amber-600/20 border-amber-900' : 'bg-amber-50 border-amber-100'}`}>
                  <p className="text-xs font-black uppercase tracking-widest text-amber-600">Total Settled</p>
                  <p className="text-xl font-black text-amber-600 mt-1">{account.totalPaid.toLocaleString()}</p>
                  <p className="text-xs text-amber-500 font-mono mt-2">Paid ledger transactions</p>
                </div>
                <div className={`p-4 border shadow-sm rounded-2xl flex flex-col justify-between ${darkTheme ? 'bg-rose-950/20 border-rose-900' : 'bg-rose-50 border-rose-100'}`}>
                  <p className="text-xs font-black uppercase tracking-widest text-rose-600">Pending Tuition</p>
                  <p className="text-xl font-black text-rose-600 mt-1">{account.totalPending.toLocaleString()}</p>
                  <p className="text-xs text-rose-500 font-mono mt-2">Pending installments</p>
                </div>
                <div className={`p-4 border shadow-sm rounded-2xl flex flex-col justify-between ${
                  account.grandTotalPending === 0
                    ? (darkTheme ? 'bg-amber-600/20 border-amber-900' : 'bg-amber-50 border-amber-100')
                    : (darkTheme ? 'bg-amber-950/20 border-amber-900' : 'bg-amber-50 border-amber-100')
                }`}>
                  <p className={`text-xs font-black uppercase tracking-widest ${account.grandTotalPending === 0 ? 'text-amber-600' : 'text-amber-600'}`}>Grand Payable</p>
                  <p className={`text-xl font-black mt-1 ${account.grandTotalPending === 0 ? 'text-amber-600' : 'text-amber-600'}`}>{account.grandTotalPending.toLocaleString()}</p>
                  <span className={`text-xs font-bold uppercase mt-2 block ${account.grandTotalPending === 0 ? 'text-amber-500' : 'text-amber-500'}`}>
                    {account.grandTotalPending === 0 ? '✓ perfect standing' : '⚠️ Settle soon'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* Monthly Ledger breakdown list */}
                <div className="lg:col-span-8 space-y-4">
                  <div className={`p-6 border shadow-sm rounded-3xl overflow-hidden ${darkTheme ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                    <h3 className={`text-xs font-black uppercase tracking-widest mb-4 border-b pb-2 ${darkTheme ? 'text-slate-200 border-slate-800' : 'text-slate-900 border-slate-100'}`}>
                      Monthly Tuition Installments
                    </h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {account.yearlyBreakdown.map(m => (
                        <div key={m.month} className={`p-4 border rounded-2xl group transition-all duration-200 ${
                          darkTheme 
                            ? 'bg-slate-950/50 border-slate-800 hover:border-teal-900 hover:bg-slate-900' 
                            : 'bg-slate-50 border-slate-150 hover:border-teal-100 hover:bg-white'
                        }`}>
                          <div className="flex justify-between items-center mb-2">
                            <span className={`text-xs font-black uppercase ${darkTheme ? 'text-white' : 'text-slate-800'}`}>{m.month} 2026</span>
                            {m.isComplete ? (
                              <span className="bg-amber-500 text-white rounded-full p-0.5"><CheckCircle2 size={10} /></span>
                            ) : (
                              <span className="bg-rose-500 text-white rounded-full p-0.5 animate-pulse"><AlertCircle size={10} /></span>
                            )}
                          </div>
                          
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between font-bold text-slate-400">
                              <span>Due installment:</span>
                              <span className={darkTheme ? 'text-slate-200' : 'text-slate-700'}>{m.due}</span>
                            </div>
                            <div className="flex justify-between font-bold">
                              <span className="text-slate-400">Paid:</span>
                              <span className="text-amber-500 font-bold">{m.paid}</span>
                            </div>
                            <div className="flex justify-between font-black">
                              <span className="text-slate-400 font-bold">Pending Balance:</span>
                              <span className={m.pending > 0 ? "text-rose-500" : "text-slate-400"}>{m.pending}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Other Funds & Bank/Cash Instructions */}
                <div className="lg:col-span-4 space-y-6">
                  {/* Other Funds list */}
                  <div className={`p-6 border shadow-sm rounded-3xl ${darkTheme ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                    <h3 className={`text-xs font-black uppercase tracking-widest mb-4 border-b pb-2 ${darkTheme ? 'text-slate-200 border-slate-800' : 'text-slate-900 border-slate-100'}`}>
                      Other Funds & Fines
                    </h3>

                    <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
                      {account.otherFunds.length > 0 ? (
                        account.otherFunds.map((fund, index) => (
                          <div key={index} className={`p-3 border rounded-xl flex justify-between items-center ${
                            darkTheme ? 'bg-slate-950 border-slate-850' : 'bg-slate-50 border-slate-150'
                          }`}>
                            <div className="text-left">
                              <p className={`text-xs font-black uppercase ${darkTheme ? 'text-white' : 'text-slate-800'}`}>{fund.desc}</p>
                              <p className="text-xs text-slate-400 font-mono mt-0.5">{fund.date}</p>
                            </div>
                            <span className="text-xs font-black text-rose-500 font-mono">{fund.amount}</span>
                          </div>
                        ))
                      ) : (
                        <div className="py-8 text-center text-xs text-slate-400 uppercase tracking-widest  font-bold">
                          No extra fines or class funds recorded
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Payment Instructions / Help */}
                  <div className={`p-6 border shadow-sm rounded-3xl mt-4 ${darkTheme ? 'bg-teal-900/20 border-teal-900/60' : 'bg-teal-50/50 border-teal-100'}`}>
                    <h4 className="text-xs font-black uppercase text-teal-600 tracking-wider flex items-center gap-1.5 mb-2">
                      <Info size={14} /> Settlement Protocol
                    </h4>
                    <p className={`text-xs leading-relaxed ${darkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
                      Please deposit outstanding cash dues directly into the **Academy Accountant Registry Office** or the official **Bank Chalan**. Keep your deposit transaction slip and bring it to the coordinator desk to record payments instantly.
                    </p>
                  </div>
                </div>

              </div>
            </div>
          );
        })()}

        {activeTab === 'id_card' && (
          <div className="space-y-8 animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <span className={`text-xs px-2 py-0.5 font-black uppercase tracking-widest font-mono ${darkTheme ? 'bg-amber-950 text-amber-400 border border-amber-900' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                  Student Identity Designer
                </span>
                <h1 className={`text-2xl font-black uppercase font-display tracking-tight mt-1 flex items-center gap-2 ${darkTheme ? 'text-white' : 'text-slate-900'}`}>
                  <Award size={24} className="text-amber-500" />
                  Design Your ID Card
                </h1>
                <p className={`text-xs mt-1 leading-relaxed ${darkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                  Customize your academic identity card with themes and colors.
                </p>
              </div>
              <button 
                onClick={() => window.print()}
                className="flex items-center justify-center gap-2 bg-teal-600 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
              >
                <Download size={14} />
                Download / Print Card
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Preview Section */}
              <div className="flex flex-col items-center justify-center space-y-6">
                <h3 className={`text-xs font-black uppercase tracking-[0.2em] ${darkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Card Preview</h3>
                
                {/* THE CARD */}
                <div 
                  id="printable-id-card"
                  className={`w-full max-w-[320px] aspect-[1.6/1] rounded-3xl shadow-2xl relative overflow-hidden transition-all duration-500 p-6 border-4 ${
                    studentProfile?.idCardTheme === 'dark' 
                      ? 'bg-slate-900 text-white border-slate-800' 
                      : studentProfile?.idCardTheme === 'vibrant'
                      ? 'bg-teal-600 text-white border-teal-500'
                      : 'bg-white text-slate-900 border-slate-100'
                  }`}
                  style={{ borderColor: studentProfile?.idCardColor || undefined }}
                >
                  {/* Decorative blobs */}
                  <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/5 rounded-full blur-2xl" />
                  <div className="absolute -bottom-10 -left-10 w-24 h-24 bg-white/5 rounded-full blur-xl" />

                  <div className="flex justify-between items-start h-full relative z-10">
                    <div className="flex flex-col justify-between h-full">
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <img
                            src="/logo.png"
                            alt="NSB1 Logo"
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-lg object-contain bg-white p-0.5 shadow-sm"
                          />
                          <div>
                            <span className="text-xs font-black tracking-widest uppercase block leading-none">NSB1 Academy</span>
                            <span className="text-[8px] font-bold tracking-widest uppercase opacity-60 block mt-0.5">Saddar Campus</span>
                          </div>
                        </div>
                        <h2 className="text-xl font-black uppercase tracking-tight leading-none truncate max-w-[180px]">
                          {studentProfile?.name || 'Name Placeholder'}
                        </h2>
                        <p className="text-xs font-bold opacity-70 uppercase tracking-widest mt-1">
                          Roll: {studentProfile?.rollNumber}
                        </p>
                        <p className="text-xs font-bold opacity-70 uppercase tracking-widest mt-0.5">
                          Class: {(() => {
                            const cls = classes.find(c => c.id === studentProfile?.classId);
                            return cls ? `${cls.className} - ${cls.section}` : 'N/A';
                          })()}
                        </p>
                      </div>

                      <div className="mt-auto">
                        <p className="text-xs font-black uppercase tracking-[0.2em] opacity-50">Student Identity</p>
                        <p className="text-xs font-mono font-bold mt-0.5">#{studentProfile?.id.substring(2, 10).toUpperCase()}</p>
                        <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mt-0.5">
                          {studentProfile?.parentPhone || ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-center">
                      <div className="w-24 h-24 rounded-2xl border-2 border-white/20 overflow-hidden bg-slate-100 shadow-xl">
                        {studentProfile?.photo ? (
                          <img src={studentProfile.photo} alt="Student" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-50">
                            <User size={40} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-400 font-medium ">Note: Card displays your official WebP profile photo for data efficiency.</p>
              </div>

              {/* Controls Section */}
              <div className={`p-6 rounded-3xl border ${darkTheme ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                <h3 className={`text-xs font-black uppercase tracking-widest mb-6 border-b pb-2 ${darkTheme ? 'text-slate-200 border-slate-800' : 'text-slate-900 border-slate-100'}`}>
                  Design Controls
                </h3>

                <div className="space-y-6">
                  {/* Theme Selection */}
                  <div className="space-y-3">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Select Theme</label>
                    <div className="grid grid-cols-3 gap-3">
                      {['classic', 'dark', 'vibrant'].map((theme) => (
                        <button
                          key={theme}
                          onClick={() => handleUpdateIDCard(theme, studentProfile?.idCardColor || '')}
                          className={`px-3 py-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-2 ${
                            studentProfile?.idCardTheme === theme 
                              ? 'border-teal-500 bg-teal-50/50 text-teal-700' 
                              : 'border-slate-100 text-slate-500 hover:border-slate-200'
                          }`}
                        >
                          <div className={`w-8 h-4 rounded-sm ${theme === 'dark' ? 'bg-slate-900' : theme === 'vibrant' ? 'bg-teal-600' : 'bg-slate-200 border border-slate-300'}`} />
                          <span className="text-xs font-black uppercase tracking-widest">{theme}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Accent Color Selection */}
                  <div className="space-y-3">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Accent Color</label>
                    <div className="flex flex-wrap gap-3">
                      {['#0d9488', '#0d9488', '#f59e0b', '#ef4444', '#0ea5e9', '#d946ef', '#f97316'].map((color) => (
                        <button
                          key={color}
                          onClick={() => handleUpdateIDCard(studentProfile?.idCardTheme || 'classic', color)}
                          className={`w-8 h-8 rounded-full border-2 transition-all ${
                            studentProfile?.idCardColor === color ? 'border-slate-900 scale-110 shadow-lg' : 'border-transparent hover:scale-105'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 mt-4">
                    <p className="text-xs text-amber-700 leading-relaxed font-medium">
                      <strong className="block mb-1">💡 Professional Tip:</strong>
                      Dark themes look best with vibrant accent colors (Cyan, Pink). Classic theme works perfectly with Indigo or Emerald for a corporate academic feel.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ========== MOBILE RESPONSIVE BOTTOM FOOTER NAVIGATION ========== */}
      <div id="student-mobile-footer-nav" className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 text-white z-50 shadow-2xl px-2 pb-safe select-none">
        <div className="flex justify-around items-center h-16 relative">
          {[
            { id: 'dashboard', label: 'Campus', icon: Sparkles, color: 'teal' },
            { id: 'attendance', label: 'Attd', icon: CheckSquare, color: 'amber' },
            { id: 'marks', label: 'Marks', icon: Award, color: 'rose' },
            { id: 'id_card', label: 'ID', icon: Fingerprint, color: 'rose' },
          ].map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            
            return (
              <div key={item.id} className={`flex-1 flex justify-center transition-all duration-300 ${isActive ? '-translate-y-4' : 'translate-y-0'}`}>
                <button
                  onClick={() => { handleTabChange(item.id as any); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className={`flex flex-col items-center justify-center transition-all duration-300 ${
                    isActive 
                      ? `rounded-full p-2.5 shadow-2xl border-4 border-slate-900 scale-110 bg-${item.color}-600 text-white` 
                      : 'text-slate-400 hover:text-white p-2'
                  }`}
                  style={isActive ? { minHeight: '52px', minWidth: '52px' } : {}}
                >
                  <Icon size={isActive ? 20 : 18} />
                  <span className={`text-[10px] uppercase tracking-widest mt-0.5 ${isActive ? 'font-black' : 'font-bold'}`}>
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
              className="flex flex-col items-center justify-center py-1 transition-all text-center text-slate-400 hover:text-teal-400 focus:outline-none"
            >
              <Menu size={18} />
              <span className="text-[10px] mt-0.5 font-bold uppercase tracking-wider">Menu</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
