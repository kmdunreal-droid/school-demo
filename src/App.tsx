import { useState, useEffect, useRef, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import { Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { sbQueueWrite, sbQueueDelete, flushSupabase, loadAllFromSupabase, subscribeRecords } from './lib/supabaseSync';
import { Teacher, Student, Coordinator, Class, TimetableEntry, Attendance, Mark, UserSession, FeeRecord, AppSettings, StudentFeeData, Assignment } from './types';
import { 
  INITIAL_TEACHERS, 
  INITIAL_CLASSES, 
  INITIAL_STUDENTS, 
  INITIAL_TIMETABLE, 
  INITIAL_ATTENDANCE, 
  INITIAL_MARKS,
  INITIAL_FEES
} from './initialData';
import LandingPage from './components/LandingPage';
import Login from './components/Login';
import PrincipalDashboard from './components/PrincipalDashboard';
import TeacherDashboard from './components/TeacherDashboard';
import StudentDashboard from './components/StudentDashboard';

import { safeStorage } from './lib/safeStorage';


function safeParse<T>(key: string, fallback: T): T {
  try {
    const saved = safeStorage.getItem(key);
    if (!saved || saved === 'undefined' || saved === 'null') return fallback;
    const parsed = JSON.parse(saved);
    if (Array.isArray(fallback)) {
      if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    }
    return parsed ?? fallback;
  } catch (err) {
    console.warn(`Error parsing localStorage key "${key}":`, err);
    return fallback;
  }
}

export default function App() {
  // Navigation level for landing vs portal
  const [viewPortal, setViewPortal] = useState<boolean>(() => {
    const saved = safeStorage.getItem('acadamis_session');
    return Boolean(saved && saved !== 'undefined' && saved !== 'null');
  });

  // Theme support
  const [darkTheme, setDarkTheme] = useState<boolean>(() => {
    return safeStorage.getItem('acadamis_dark_theme') === 'true';
  });

  useEffect(() => {
    if (darkTheme) {
      document.documentElement.classList.add('dark');
      safeStorage.setItem('acadamis_dark_theme', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      safeStorage.setItem('acadamis_dark_theme', 'false');
    }
  }, [darkTheme]);

  useEffect(() => {
    const handleThemeToggle = () => {
      setDarkTheme(safeStorage.getItem('acadamis_dark_theme') === 'true');
    };
    window.addEventListener('acadamis_toggle_theme', handleThemeToggle);
    return () => window.removeEventListener('acadamis_toggle_theme', handleThemeToggle);
  }, []);

  // --- STATE DEFAULTS & INITIALIZATION ---
  const [teachers, setTeachers] = useState<Teacher[]>(() => 
    safeParse('acadamis_teachers', INITIAL_TEACHERS)
  );

  const [classes, setClasses] = useState<Class[]>(() => 
    safeParse('acadamis_classes', INITIAL_CLASSES)
  );

  const [students, setStudents] = useState<Student[]>(() => 
    safeParse('acadamis_students', INITIAL_STUDENTS)
  );

  const [timetable, setTimetable] = useState<TimetableEntry[]>(() => 
    safeParse('acadamis_timetable', INITIAL_TIMETABLE)
  );

  const [attendance, setAttendance] = useState<Attendance[]>(() => 
    safeParse('acadamis_attendance', INITIAL_ATTENDANCE)
  );

  const [marks, setMarks] = useState<Mark[]>(() => 
    safeParse('acadamis_marks', INITIAL_MARKS)
  );

  const [fees, setFees] = useState<FeeRecord[]>(() => 
    safeParse('acadamis_fees', INITIAL_FEES)
  );

  const [coordinators, setCoordinators] = useState<Coordinator[]>(() => 
    safeParse('acadamis_coordinators', [])
  );

  const [assignments, setAssignments] = useState<Assignment[]>(() => 
    safeParse('acadamis_assignments', [])
  );

  const [feeStudents, setFeeStudents] = useState<StudentFeeData[]>(() => {
    const saved = safeParse('school_fee_data', []);
    if (saved && saved.length > 0) return saved;
    return INITIAL_STUDENTS.map(s => ({
      id: s.id,
      name: s.name,
      class: s.classId === 'c1' ? 'Grade 10 A' : 'Grade 11 B',
      monthlyFee: 2500,
      payments: [],
      otherFunds: []
    }));
  });

  const [appSettings, setAppSettings] = useState<AppSettings>(() => 
    safeParse('acadamis_app_settings', {
      absentTemplate: "Greetings, Respected Parent! We noticed that your child {student_name} (Roll: {roll_number}) has been marked ABSENT on date {date}. Kindly clarify the reason or contact the school office. Principal.",
      feeTemplate: "Dear parent, your child {name}'s fee for {month} is {amount} which is due on {date}. NSB 1 Academy.",
      resultTemplate: "Greetings, Respected Parent! Result of {student_name} (Roll: {roll_number}, {class_name}) for {exam_name}:\n{subjects}\nTotal: {total_obtained}/{total_max} ({percentage}%). Status: {status}.\n- NSB 1 Academy.",
      whatsAppAutoFee: true,
      whatsAppAutoAbsence: true,
      whatsAppAutoResult: false,
      autoWhatsAppRedirect: true,
      extraPeriods: {},
      deletedPeriods: {},
      periodColors: {}
    })
  );

  // --- PWA INSTALL PROMPT LOGIC ---
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);

  useEffect(() => {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then(reg => console.log('SW Registered', reg))
          .catch(err => console.log('SW Error', err));
      });
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setInstallPromptEvent(e);
      
      // Show modal after a small delay
      setTimeout(() => {
        setShowInstallModal(true);
      }, 1500);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = () => {
    if (installPromptEvent) {
      installPromptEvent.prompt();
      installPromptEvent.userChoice.then((choiceResult: { outcome: string }) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
        }
        setInstallPromptEvent(null);
        setShowInstallModal(false);
      });
    } else {
      toast.info(
        "To install NSB 1 ACADEMY, click the install icon (desktop) in your browser's address bar or select 'Add to Home Screen' from the browser menu (e.g., Safari iOS Share menu).",
        { duration: 6000 }
      );
    }
  };

  // User session state
  const [userSession, setUserSession] = useState<UserSession | null>(() => {
    const saved = safeStorage.getItem('acadamis_session');
    if (!saved || saved === 'undefined' || saved === 'null') return null;
    try {
      const parsed = JSON.parse(saved);
      return parsed && parsed.role ? parsed : null;
    } catch {
      return null;
    }
  });

  // --- FIRESTORE SYNCHRONIZATION SYSTEM ---
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // Real-time listeners tab hi setup hon jab initial sync complete ho
  const [syncReady, setSyncReady] = useState(false);
  const isSyncComplete = useRef<boolean>(false);
  

  const prevTeachers = useRef<string>('');
  const prevClasses = useRef<string>('');
  const prevStudents = useRef<string>('');
  const prevTimetable = useRef<string>('');
  const prevAttendance = useRef<string>('');
  const prevMarks = useRef<string>('');
  const prevFees = useRef<string>('');
  const prevCoordinators = useRef<string>('');
  const prevFeeStudents = useRef<string>('');
  const prevAppSettings = useRef<string>('');
  const prevAssignments = useRef<string>('');

  // --- QUEUED SUPABASE WRITER ---
  // Har write/delete Supabase queue mein jata hai aur debounce ke baad batched
  // upsert se flush hota hai. Supabase par koi write quota nahi hai.
  const [syncPaused, setSyncPaused] = useState(false);
  const syncPausedUntil = useRef(0);
  const batchTimer = useRef<any>(null);

  const queueBatchWrite = (col: string, id: string, data: any) => {
    sbQueueWrite(col, id, data);
    flushBatchDebounced();
  };

  const queueBatchDelete = (col: string, id: string) => {
    sbQueueDelete(col, id);
    flushBatchDebounced();
  };

  const flushBatch = async () => {
    const ok = await flushSupabase();
    if (ok) {
      setSyncError(null);
      setSyncPaused(false);
    } else {
      setSyncError('Cloud sync failed — changes saved locally, retrying');
    }
  };

  // Debounce network round-trips (koi quota nahi, sirf efficiency).
  const flushBatchDebounced = () => {
    if (batchTimer.current) clearTimeout(batchTimer.current);
    batchTimer.current = setTimeout(() => {
      flushBatch();
    }, 1200);
  };

  // Flush any remaining writes before the tab is closed/navigated away.
  useEffect(() => {
    const flush = () => flushBatch();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', flush);
      if (batchTimer.current) clearTimeout(batchTimer.current);
    };
  }, []);

  


  




  // --- REALTIME LISTENER — Supabase WebSocket push se live cross-device sync ---
  // Ek hi channel `records` table par; koi bhi INSERT/UPDATE/DELETE → debounce
  // ke baad poori state refresh. Prev-ref comparison se echo loop nahi banta.
  useEffect(() => {
    if (!userSession || !syncReady) return;

    let rtTimer: any = null;

    const applyData = async (reason: string) => {
      const data = await loadAllFromSupabase();
      if (!data) return;

      const applyList = <T extends { id: any }>(
        list: any[] | undefined,
        prevRef: React.MutableRefObject<string>,
        setter: (v: T[]) => void,
        storeKey: string
      ) => {
        if (!list) return;
        const str = JSON.stringify(list);
        if (str === prevRef.current) return;
        setter(list as T[]);
        prevRef.current = str;
        safeStorage.setItem(storeKey, str);
      };

      applyList(data['teachers'], prevTeachers, setTeachers, 'acadamis_teachers');
      applyList(data['classes'], prevClasses, setClasses, 'acadamis_classes');
      applyList(data['students'], prevStudents, setStudents, 'acadamis_students');
      applyList(data['timetable'], prevTimetable, setTimetable, 'acadamis_timetable');
      applyList(data['attendance'], prevAttendance, setAttendance, 'acadamis_attendance');
      applyList(data['marks'], prevMarks, setMarks, 'acadamis_marks');
      applyList(data['fees'], prevFees, setFees, 'acadamis_fees');
      applyList(data['coordinators'], prevCoordinators, setCoordinators, 'acadamis_coordinators');
      applyList(data['fee_data'], prevFeeStudents, setFeeStudents, 'school_fee_data');
      applyList(data['assignments'], prevAssignments, setAssignments, 'acadamis_assignments');
      const settingsArr = data['app_settings'] || [];
      if (settingsArr.length > 0) {
        const s = settingsArr[0] as AppSettings;
        const sStr = JSON.stringify(s);
        if (sStr !== prevAppSettings.current) {
          setAppSettings(s);
          prevAppSettings.current = sStr;
          safeStorage.setItem('acadamis_app_settings', sStr);
        }
      }
      console.log(`[Sync:RT] Supabase update applied (${reason})`);
    };

    const unsub = subscribeRecords(() => {
      if (!isSyncComplete.current) return;
      if (rtTimer) clearTimeout(rtTimer);
      rtTimer = setTimeout(() => { applyData('realtime'); }, 400);
    });

    console.log('[Sync:RT] Supabase realtime listener active');
    return () => {
      unsub();
      if (rtTimer) clearTimeout(rtTimer);
    };
  }, [userSession, syncReady]);


  useEffect(() => {
    async function initBackendAndSync() {
      try {
        console.log("Checking Supabase connectivity...");

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Supabase connection timeout")), 15000)
        );

        const data = await Promise.race([loadAllFromSupabase(), timeoutPromise]);
        const loadedTeachers = data['teachers'] || [];
        const loadedClasses = data['classes'] || [];
        const loadedStudents = data['students'] || [];
        const loadedTimetable = data['timetable'] || [];
        const loadedAttendance = data['attendance'] || [];
        const loadedMarks = data['marks'] || [];
        const loadedFees = data['fees'] || [];
        const loadedCoordinators = data['coordinators'] || [];
        const loadedFeeStudents = data['fee_data'] || [];
        const loadedAssignments = data['assignments'] || [];
        const loadedSettings = (data['app_settings'] || [])[0] as AppSettings | null;

        if (loadedStudents.length === 0) {
          // ===== SEED — Supabase khali hai to initial datasets likho =====
          console.log("Supabase records khali — initial datasets seed kar rahe hain...");
          try {
            const seedItems: [string, any[]][] = [
              ['teachers', INITIAL_TEACHERS],
              ['classes', INITIAL_CLASSES],
              ['students', INITIAL_STUDENTS],
              ['timetable', INITIAL_TIMETABLE],
              ['attendance', INITIAL_ATTENDANCE],
              ['marks', INITIAL_MARKS],
              ['fees', INITIAL_FEES],
            ];
            seedItems.forEach(([col, arr]) => {
              (arr || []).forEach(item => {
                if (item?.id !== undefined && item?.id !== null) sbQueueWrite(col, String(item.id), item);
              });
            });
            await flushSupabase();
            console.log("Seeding to Supabase completed successfully.");
          } catch (seedErr) {
            console.warn("Seeding to Supabase warning:", seedErr);
          }

          setTeachers(INITIAL_TEACHERS);
          setClasses(INITIAL_CLASSES);
          setStudents(INITIAL_STUDENTS);
          setTimetable(INITIAL_TIMETABLE);
          setAttendance(INITIAL_ATTENDANCE);
          setMarks(INITIAL_MARKS);
          setFees(INITIAL_FEES);

          prevTeachers.current = JSON.stringify(INITIAL_TEACHERS);
          prevClasses.current = JSON.stringify(INITIAL_CLASSES);
          prevStudents.current = JSON.stringify(INITIAL_STUDENTS);
          prevTimetable.current = JSON.stringify(INITIAL_TIMETABLE);
          prevAttendance.current = JSON.stringify(INITIAL_ATTENDANCE);
          prevMarks.current = JSON.stringify(INITIAL_MARKS);
          prevFees.current = JSON.stringify(INITIAL_FEES);
          prevCoordinators.current = JSON.stringify([]);
          prevFeeStudents.current = JSON.stringify([]);
          prevAssignments.current = JSON.stringify([]);
        } else {
          // ===== LOAD — Supabase se active data =====
          console.log("Loading datasets from Supabase...");

            const finalTeachers = loadedTeachers.length > 0 ? loadedTeachers : INITIAL_TEACHERS;
          const finalClasses = loadedClasses.length > 0 ? loadedClasses : INITIAL_CLASSES;
          const finalStudents = loadedStudents.length > 0 ? loadedStudents : INITIAL_STUDENTS;
          const finalTimetable = loadedTimetable.length > 0 ? loadedTimetable : INITIAL_TIMETABLE;
          const finalAttendance = loadedAttendance.length > 0 ? loadedAttendance : INITIAL_ATTENDANCE;
          const finalMarks = loadedMarks.length > 0 ? loadedMarks : INITIAL_MARKS;
          const finalFees = loadedFees.length > 0 ? loadedFees : INITIAL_FEES;

          setTeachers(finalTeachers);
          setClasses(finalClasses);
          setStudents(finalStudents);
          setTimetable(finalTimetable);
          setAttendance(finalAttendance);
          setMarks(finalMarks);
          setFees(finalFees);

          if (loadedCoordinators.length > 0) setCoordinators(loadedCoordinators);
          if (loadedAssignments.length > 0) setAssignments(loadedAssignments);
          if (loadedFeeStudents.length > 0) {
            setFeeStudents(loadedFeeStudents);
          } else {
            const defaultFeeStudents = finalStudents.map(s => ({
              id: s.id,
              name: s.name,
              class: s.classId === 'c1' ? 'Grade 10 A' : 'Grade 11 B',
              monthlyFee: 2500,
              payments: [],
              otherFunds: [],
              dues: []
            }));
            setFeeStudents(defaultFeeStudents);
          }
          if (loadedSettings) setAppSettings(loadedSettings);

          // Background auto-seed if any collection was empty in Supabase
          if (loadedStudents.length === 0) {
            INITIAL_STUDENTS.forEach(s => sbQueueWrite("students", String(s.id), s));
          }
          if (loadedClasses.length === 0) {
            INITIAL_CLASSES.forEach(c => sbQueueWrite("classes", String(c.id), c));
          }
          if (loadedTeachers.length === 0) {
            INITIAL_TEACHERS.forEach(t => sbQueueWrite("teachers", String(t.id), t));
          }
          if (loadedAttendance.length === 0) {
            INITIAL_ATTENDANCE.forEach(a => sbQueueWrite("attendance", String(a.id), a));
          }
          if (loadedFees.length === 0) {
            INITIAL_FEES.forEach(f => sbQueueWrite("fees", String(f.id), f));
          }
          flushSupabase().catch(() => {});

          prevTeachers.current = JSON.stringify(finalTeachers);
          prevClasses.current = JSON.stringify(finalClasses);
          prevStudents.current = JSON.stringify(finalStudents);
          prevTimetable.current = JSON.stringify(finalTimetable);
          prevAttendance.current = JSON.stringify(finalAttendance);
          prevMarks.current = JSON.stringify(finalMarks);
          prevFees.current = JSON.stringify(finalFees);
          prevCoordinators.current = JSON.stringify(loadedCoordinators.length > 0 ? loadedCoordinators : []);
          prevFeeStudents.current = JSON.stringify(loadedFeeStudents.length > 0 ? loadedFeeStudents : []);
          prevAssignments.current = JSON.stringify(loadedAssignments.length > 0 ? loadedAssignments : []);
          if (loadedSettings) prevAppSettings.current = JSON.stringify(loadedSettings);

          // localStorage cache bhi refresh
          safeStorage.setItem('acadamis_teachers', prevTeachers.current);
          safeStorage.setItem('acadamis_classes', prevClasses.current);
          safeStorage.setItem('acadamis_students', prevStudents.current);
          safeStorage.setItem('acadamis_timetable', prevTimetable.current);
          safeStorage.setItem('acadamis_attendance', prevAttendance.current);
          safeStorage.setItem('acadamis_marks', prevMarks.current);
          safeStorage.setItem('acadamis_fees', prevFees.current);
          safeStorage.setItem('acadamis_coordinators', prevCoordinators.current);
          safeStorage.setItem('school_fee_data', prevFeeStudents.current);
          safeStorage.setItem('acadamis_assignments', prevAssignments.current);
        }
        isSyncComplete.current = true;
        setSyncReady(true);
      } catch (err: any) {
        console.warn("Supabase sync running in background/offline fallback mode:", err?.message);
        setSyncError(err?.message || "Offline fallback");

        setTeachers(prev => prev.length > 0 ? prev : INITIAL_TEACHERS);
        setClasses(prev => prev.length > 0 ? prev : INITIAL_CLASSES);
        setStudents(prev => prev.length > 0 ? prev : INITIAL_STUDENTS);
        setTimetable(prev => prev.length > 0 ? prev : INITIAL_TIMETABLE);
        setAttendance(prev => prev.length > 0 ? prev : INITIAL_ATTENDANCE);
        setMarks(prev => prev.length > 0 ? prev : INITIAL_MARKS);
        setFees(prev => prev.length > 0 ? prev : INITIAL_FEES);
        // IMPORTANT: Set sync complete even on failure so local changes can still push
        isSyncComplete.current = true;
        setSyncReady(true);
      }
    }

    initBackendAndSync();
  }, []);

  // --- REALTIME DIFFERENTIAL SYNC ACTIONS ---
  
  // Teachers Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(teachers);
    if (currentStr === prevTeachers.current) return;

    const current = teachers;
    const prevArr: Teacher[] = prevTeachers.current ? JSON.parse(prevTeachers.current) : [];

    current.forEach((t) => {
      const matched = prevArr.find(v => v.id === t.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(t)) {
        queueBatchWrite("teachers", t.id, t);
      }
    });

    prevArr.forEach((t) => {
      if (!current.some(item => item.id === t.id)) {
        queueBatchDelete("teachers", t.id);
      }
    });

    prevTeachers.current = currentStr;
  }, [teachers]);

  // Coordinators Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(coordinators);
    if (currentStr === prevCoordinators.current) return;

    const current = coordinators;
    const prevArr: Coordinator[] = prevCoordinators.current ? JSON.parse(prevCoordinators.current) : [];

    current.forEach((c) => {
      const matched = prevArr.find(v => v.id === c.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(c)) {
        queueBatchWrite("coordinators", c.id, c);
      }
    });

    prevArr.forEach((c) => {
      if (!current.some(item => item.id === c.id)) {
        queueBatchDelete("coordinators", c.id);
      }
    });

    prevCoordinators.current = currentStr;
    safeStorage.setItem('acadamis_coordinators', currentStr);
  }, [coordinators]);

  // Assignments Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(assignments);
    if (currentStr === prevAssignments.current) return;

    const current = assignments;
    const prevArr: Assignment[] = prevAssignments.current ? JSON.parse(prevAssignments.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("assignments", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("assignments", item.id);
      }
    });

    prevAssignments.current = currentStr;
    safeStorage.setItem('acadamis_assignments', currentStr);
  }, [assignments]);

  // --- UTILS ---

  // Classes Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(classes);
    if (currentStr === prevClasses.current) return;

    const current = classes;
    const prevArr: Class[] = prevClasses.current ? JSON.parse(prevClasses.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("classes", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("classes", item.id);
      }
    });

    prevClasses.current = currentStr;
  }, [classes]);

  // Students Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(students);
    if (currentStr === prevStudents.current) return;

    const current = students;
    const prevArr: Student[] = prevStudents.current ? JSON.parse(prevStudents.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("students", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("students", item.id);
      }
    });

    prevStudents.current = currentStr;
  }, [students]);

  // Timetable Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(timetable);
    if (currentStr === prevTimetable.current) return;

    const current = timetable;
    const prevArr: TimetableEntry[] = prevTimetable.current ? JSON.parse(prevTimetable.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("timetable", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("timetable", item.id);
      }
    });

    prevTimetable.current = currentStr;
  }, [timetable]);

  // Attendance Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(attendance);
    if (currentStr === prevAttendance.current) return;

    const current = attendance;
    const prevArr: Attendance[] = prevAttendance.current ? JSON.parse(prevAttendance.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("attendance", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("attendance", item.id);
      }
    });

    prevAttendance.current = currentStr;
  }, [attendance]);

  // Marks Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(marks);
    if (currentStr === prevMarks.current) return;

    const current = marks;
    const prevArr: Mark[] = prevMarks.current ? JSON.parse(prevMarks.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("marks", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("marks", item.id);
      }
    });

    prevMarks.current = currentStr;
  }, [marks]);

  // Fees Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(fees);
    if (currentStr === prevFees.current) return;

    const current = fees;
    const prevArr: FeeRecord[] = prevFees.current ? JSON.parse(prevFees.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("fees", item.id, item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("fees", item.id);
      }
    });

    prevFees.current = currentStr;
    safeStorage.setItem('acadamis_fees', currentStr);
  }, [fees]);

  // Student Fee Data Sync (New Engine)
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(feeStudents);
    if (currentStr === prevFeeStudents.current) return;

    const current = feeStudents;
    const prevArr: StudentFeeData[] = prevFeeStudents.current ? JSON.parse(prevFeeStudents.current) : [];

    current.forEach((item) => {
      const matched = prevArr.find(v => v.id === item.id);
      if (!matched || JSON.stringify(matched) !== JSON.stringify(item)) {
        queueBatchWrite("fee_data", String(item.id), item);
      }
    });

    prevArr.forEach((item) => {
      if (!current.some(p => p.id === item.id)) {
        queueBatchDelete("fee_data", String(item.id));
      }
    });

    prevFeeStudents.current = currentStr;
    safeStorage.setItem('school_fee_data', currentStr);
  }, [feeStudents]);

  // Ensure students list stays synced into feeStudents data
  useEffect(() => {
    if (!students || students.length === 0) return;
    setFeeStudents(prevFee => {
      let changed = false;
      const updated = [...prevFee];
      
      students.forEach(s => {
        const cls = classes.find(c => c.id === s.classId);
        const classNameStr = cls ? `${cls.className} ${cls.section}`.trim() : (s.classId || 'Class 10');
        const existingIdx = updated.findIndex(f => String(f.id) === String(s.id));
        if (existingIdx === -1) {
          updated.push({
            id: s.id,
            name: s.name,
            class: classNameStr,
            monthlyFee: 2500,
            payments: [],
            otherFunds: [],
            dues: []
          });
          changed = true;
        } else if (updated[existingIdx].name !== s.name || updated[existingIdx].class !== classNameStr) {
          updated[existingIdx] = {
            ...updated[existingIdx],
            name: s.name,
            class: classNameStr
          };
          changed = true;
        }
      });

      return changed ? updated : prevFee;
    });
  }, [students, classes]);

  // App Settings Sync
  useEffect(() => {
    if (!isSyncComplete.current) return;
    const currentStr = JSON.stringify(appSettings);
    if (currentStr === prevAppSettings.current) return;

    const sync = async () => {
      try {
        sbQueueWrite("app_settings", "global", appSettings);
        await flushSupabase();
        prevAppSettings.current = currentStr;
        safeStorage.setItem('acadamis_app_settings', currentStr);
      } catch (e) {
        console.error("Supabase Settings Sync Error:", e);
      }
    };

    sync();
  }, [appSettings]);

  // Auto-sync students to feeStudents collection
  useEffect(() => {
    if (!isSyncComplete.current) return;
    
    let changed = false;
    const updatedFeeStudents = students.map(s => {
      const match = feeStudents.find(fs => String(fs.id) === String(s.id));
      if (match) {
        // Just update metadata if needed
        const className = classes.find(c => c.id === s.classId)?.className || match.class;
        if (match.name !== s.name || match.class !== className || match.enrollmentMonth !== s.enrollmentMonth || match.monthlyFee !== (s.baseFee || 0)) {
          changed = true;
          return { ...match, name: s.name, class: className, enrollmentMonth: s.enrollmentMonth, monthlyFee: s.baseFee || 0 };
        }
        return match;
      } else {
        changed = true;
        return {
          id: s.id,
          name: s.name,
          class: classes.find(c => c.id === s.classId)?.className || 'Default',
          monthlyFee: s.baseFee || 0,
          enrollmentMonth: s.enrollmentMonth || 'January',
          payments: [],
          otherFunds: [],
          dues: []
        };
      }
    });

    // Remove fee data for students who are no longer in the system
    const finalFeeStudents = updatedFeeStudents.filter(fs => students.some(s => String(s.id) === String(fs.id)));
    if (finalFeeStudents.length !== updatedFeeStudents.length) changed = true;

    if (changed) {
      setFeeStudents(finalFeeStudents);
    }
  }, [students, classes, isSyncComplete.current]);

  // --- LOCALSTORAGE CACHING (DEBOUNCED) ---
  // Writes are deferred 400ms so rapid typing/editing doesn't block the UI
  // with synchronous localStorage writes on every keystroke.
  const cacheTimer = useRef<any>(null);

  useEffect(() => {
    if (cacheTimer.current) clearTimeout(cacheTimer.current);
    cacheTimer.current = setTimeout(() => {
      safeStorage.setItem('acadamis_teachers', JSON.stringify(teachers));
      safeStorage.setItem('acadamis_classes', JSON.stringify(classes));
      safeStorage.setItem('acadamis_students', JSON.stringify(students));
      safeStorage.setItem('acadamis_timetable', JSON.stringify(timetable));
      safeStorage.setItem('acadamis_attendance', JSON.stringify(attendance));
      safeStorage.setItem('acadamis_marks', JSON.stringify(marks));
      safeStorage.setItem('acadamis_fees', JSON.stringify(fees));
    }, 400);

    return () => {
      if (cacheTimer.current) clearTimeout(cacheTimer.current);
    };
  }, [teachers, classes, students, timetable, attendance, marks, fees]);

  useEffect(() => {
    if (userSession) {
      safeStorage.setItem('acadamis_session', JSON.stringify(userSession));
    } else {
      safeStorage.removeItem('acadamis_session');
    }
  }, [userSession]);

  // --- FORCE SYNC — manual full upload to Supabase ---
  const pushLocalToCloud = useCallback(async () => {
    if (!userSession) return;

    try {
      console.log("Pushing local data to Supabase...");

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
      const ok = await flushSupabase();
      if (!ok) throw new Error("Supabase flush failed");

      console.log("Push to Supabase complete");
    } catch (err) {
      console.warn("Push to Supabase failed:", err);
      // Rethrow so callers (e.g. the Force Sync button) can surface the failure
      throw err;
    }
  }, [userSession, teachers, classes, students, timetable, attendance, marks, fees, coordinators, feeStudents, appSettings]);

  // Push interval removed — see note above pushLocalToCloud (quota fix).


  // --- ACTIONS ---
  const handleLogin = (session: UserSession) => {
    setUserSession(session);
    setViewPortal(true);
  };

  const handleLogout = () => {
    setUserSession(null);
  };

  // --- RENDER ROUTING ENGINE ---
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 text-gray-900 dark:text-slate-100 font-sans antialiased selection:bg-blue-500 selection:text-white transition-colors duration-200">
      <Toaster position="top-right" richColors />

      {/* Cloud sync health banner */}
      {syncError && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[10000] bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-full shadow-lg print:hidden max-w-[90vw] truncate flex items-center gap-2">
          Cloud sync issue: {syncError} — data saved locally
          {syncPaused && (
            <button
              onClick={() => { syncPausedUntil.current = 0; setSyncPaused(false); flushBatch(); }}
              className="px-2 py-0.5 bg-white text-amber-700 rounded-full text-[9px] font-black uppercase hover:bg-amber-100 transition-colors cursor-pointer shrink-0"
            >
              Retry Now
            </button>
          )}
        </div>
      )}

      {/* PWA Install Modal Popup */}
      <AnimatePresence>
        {showInstallModal && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-200"
            >
              <div className="p-8 text-center space-y-6">
                <div className="w-20 h-20 bg-indigo-600 text-white rounded-3xl mx-auto flex items-center justify-center shadow-xl shadow-indigo-500/20 rotate-6">
                  <Download size={40} strokeWidth={2.5} />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight ">Install Portal</h3>
                  <p className="text-xs font-bold text-slate-500 leading-relaxed uppercase tracking-wide">
                    Add to your home screen for quick access and a better mobile experience.
                  </p>
                </div>

                <div className="flex flex-col gap-3 pt-4">
                  <button 
                    onClick={handleInstallClick}
                    className="w-full py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-95"
                  >
                    Install Now
                  </button>
                  <button 
                    onClick={() => setShowInstallModal(false)}
                    className="w-full py-4 bg-white border border-slate-200 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all active:scale-95"
                  >
                    Maybe Later
                  </button>
                </div>
              </div>
              <div className="bg-slate-50 p-4 text-center border-t border-slate-100">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em]">NSB1 School Management System</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {!userSession ? (
        !viewPortal ? (
          <LandingPage
            teachers={teachers}
            students={students}
            classes={classes}
            onEnterPortal={() => setViewPortal(true)}
          />
        ) : (
          <Login 
            teachers={teachers} 
            students={students} 
            coordinators={coordinators}
            onLogin={handleLogin} 
            onBackToLanding={() => setViewPortal(false)}
          />
        )
      ) : (userSession.role === 'principal' || userSession.role === 'coordinator' || userSession.role === 'developer') ? (
        <PrincipalDashboard
          userSession={userSession}
          teachers={teachers}
          setTeachers={setTeachers}
          students={students}
          setStudents={setStudents}
          attendance={attendance}
          setAttendance={setAttendance}
          coordinators={coordinators}
          setCoordinators={setCoordinators}
          classes={classes}
          setClasses={setClasses}
          timetable={timetable}
          setTimetable={setTimetable}
          fees={fees}
          setFees={setFees}
          marks={marks}
          setMarks={setMarks}
          feeStudents={feeStudents}
          setFeeStudents={setFeeStudents}
          appSettings={appSettings}
          setAppSettings={setAppSettings}
          assignments={assignments}
          setAssignments={setAssignments}
          onLogout={handleLogout}
          installPromptEvent={installPromptEvent}
          onInstallApp={handleInstallClick}
          pushLocalToCloud={pushLocalToCloud}
        />
      ) : userSession.role === 'teacher' ? (
        <TeacherDashboard
          userSession={userSession}
          teachers={teachers}
          setTeachers={setTeachers}
          students={students}
          setStudents={setStudents}
          classes={classes}
          setClasses={setClasses}
          timetable={timetable}
          setTimetable={setTimetable}
          attendance={attendance}
          setAttendance={setAttendance}
          marks={marks}
          setMarks={setMarks}
          fees={fees}
          setFees={setFees}
          assignments={assignments}
          setAssignments={setAssignments}
          onLogout={handleLogout}
          installPromptEvent={installPromptEvent}
          onInstallApp={handleInstallClick}
        />
      ) : userSession.role === 'student' ? (
        <StudentDashboard
          userSession={userSession}
          teachers={teachers}
          setTeachers={setTeachers}
          students={students}
          setStudents={setStudents}
          classes={classes}
          setClasses={setClasses}
          timetable={timetable}
          setTimetable={setTimetable}
          attendance={attendance}
          setAttendance={setAttendance}
          marks={marks}
          setMarks={setMarks}
          fees={fees}
          setFees={setFees}
          assignments={assignments}
          setAssignments={setAssignments}
          onLogout={handleLogout}
          installPromptEvent={installPromptEvent}
          onInstallApp={handleInstallClick}
        />
      ) : (
        <Login 
          teachers={teachers} 
          students={students} 
          coordinators={coordinators}
          onLogin={handleLogin} 
          onBackToLanding={() => setViewPortal(false)}
        />
      )}
    </div>
  );
}
