import { useState, useEffect, useRef, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import { Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db } from './firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, writeBatch, getDoc, arrayUnion, onSnapshot } from 'firebase/firestore';
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
import { sanitizeForFirestore } from './lib/firestoreUtils';
import { neonQueueWrite, neonQueueDelete, neonHeartbeat, loadAllFromNeon, loadCollectionFromNeon, ensureNeonSchema, flushNeon } from './lib/neonSync';

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
  // REF for pullRemoteData — avoids stale closure in heartbeat poll
  const pullRemoteRef = useRef<((reason: string) => Promise<void>) | null>(null);

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

  // --- DEBOUNCED BATCHED FIRESTORE WRITER ---
  // Collects writes/deletes and flushes them in a single writeBatch after
  // a short debounce window. This dramatically cuts network round-trips
  // during rapid typing/editing instead of firing one setDoc per item.
  const [syncPaused, setSyncPaused] = useState(false);
  const syncPausedUntil = useRef(0);
  const pendingBatch = useRef<{ set: { ref: any; data: any }[]; del: any[] }>({
    set: [],
    del: []
  });
  const batchTimer = useRef<any>(null);
  const batchRetryCount = useRef<number>(0);

  const queueBatchWrite = (col: string, id: string, data: any) => {
    pendingBatch.current.set.push({
      ref: doc(db, col, id),
      data: sanitizeForFirestore(data)
    });
    // NEON MIRROR — har write Neon Postgres mein bhi jata hai (backup/fallback)
    neonQueueWrite(col, id, data);
    // NEON HEARTBEAT — doosri devices ko pata chale (Firebase quota fail par bhi sync ho)
    neonHeartbeat(deviceIdRef.current);
    flushBatchDebounced();
  };

  const queueBatchDelete = (col: string, id: string) => {
    pendingBatch.current.del.push(doc(db, col, id));
    // NEON MIRROR — delete Neon se bhi
    neonQueueDelete(col, id);
    // NEON HEARTBEAT — delete bhi doosri devices tak pahunche
    neonHeartbeat(deviceIdRef.current);
    flushBatchDebounced();
  };

  // --- SYNC HEARTBEAT (cross-device fallback) ---
  // onSnapshot listeners kabhi-kabhi (WebChannel block, PWA cache, IndexedDB lock)
  // remote updates nahi late — is liye har device push ke baad ek chhota 'sync_meta/global'
  // heartbeat doc update karti hai. Baqi devices sirf YEH ek doc poll karti hain (20s, quota-safe)
  // aur jab heartbeat badla ho to poora data Firestore se pull kar leti hain.
  const deviceIdRef = useRef(Math.random().toString(36).slice(2) + Date.now().toString(36));
  const lastRemoteMeta = useRef(0);   // aakhri heartbeat timestamp jo is device ne dekha
  const lastOwnPush = useRef(0);      // is device ki aakhri push ka timestamp (self-echo skip)
  const lastNeonMetaTs = useRef(0);   // aakhri NEON heartbeat updatedAt jo is device ne process kiya
  const lastNeonFullSync = useRef(0); // aakhri NEON full-pull ka timestamp

  const bumpSyncMeta = async (cols: string[]) => {
    try {
      const ts = Date.now();
      lastOwnPush.current = ts;
      lastRemoteMeta.current = ts;
      await setDoc(doc(db, 'sync_meta', 'global'), {
        updatedAt: ts,
        byDevice: deviceIdRef.current,
        collections: arrayUnion(...cols),
      }, { merge: true });
    } catch (e: any) {
      console.warn('[Sync] heartbeat bump failed:', e?.message);
    }
  };

  const flushBatch = async () => {
    if (pendingBatch.current.set.length === 0 && pendingBatch.current.del.length === 0) return;

    // QUOTA-AWARE: agar pause mein hai to skip — local mein rakho, baad mein retry
    if (Date.now() < syncPausedUntil.current) {
      console.log('[Sync] paused (quota) — writes queued locally, will resume after', new Date(syncPausedUntil.current).toLocaleTimeString());
      return;
    }

    // CRITICAL FIX: Snapshot current ops into local arrays, then clear pending queue
    const setOps = [...pendingBatch.current.set];
    const delOps = [...pendingBatch.current.del];
    pendingBatch.current = { set: [], del: [] };
    // Collection names extract karo
    const colNames = Array.from(new Set([
      ...setOps.map(o => String((o?.ref as any)?.parent?.id || '').replace(/^\//, '').split('/')[0] || ''),
      ...delOps.map(d => String((d as any)?.parent?.id || '').replace(/^\//, '').split('/')[0] || ''),
    ].filter(Boolean)));
    let idx = 0;
    try {
      // Firestore writeBatch limit is 500 operations per commit.
      while (idx < setOps.length || delOps.length > 0) {
        const batch = writeBatch(db);
        let count = 0;
        while (idx < setOps.length && count < 450) {
          const op = setOps[idx++];
          if (op) { batch.set(op.ref, op.data, { merge: true }); count++; }
        }
        while (delOps.length > 0 && count < 500) {
          const d = delOps.shift();
          if (d) { batch.delete(d); count++; }
        }
        await batch.commit();
      }
      // Success — reset retry counter and clear any sync error banner.
      batchRetryCount.current = 0;
      setSyncError(null);
      setSyncPaused(false);
      // HEARTBEAT — doosri devices ko batao ke data badal gaya
      if (colNames.length > 0) {
        bumpSyncMeta(colNames);
        console.log('[Sync] batch pushed + heartbeat bumped:', colNames.join(', '));
      }
    } catch (e: any) {
      console.warn("Firestore batch write failed:", e?.message);
      // RESOURCE_EXHAUSTED → pause writes for 45 seconds (quota bachao)
      const isQuota = e?.code === 'resource-exhausted' || String(e?.message || '').includes('RESOURCE_EXHAUSTED');
      if (isQuota) {
        syncPausedUntil.current = Date.now() + 45000;
        setSyncPaused(true);
        toast.warning('Cloud sync paused 45s (write quota reached). Changes saved locally & will auto-resume.', { duration: 6000 });
      }
      // Re-queue ALL failed ops (remaining setOps + all delOps) so NO data is lost
      const remainingSet = setOps.slice(idx);
      pendingBatch.current.set.unshift(...remainingSet);
      pendingBatch.current.del.unshift(...delOps);
      // Retry with backoff (sirf quota nahi hai to)
      batchRetryCount.current += 1;
      setSyncError(isQuota ? 'Quota exceeded — paused 45s' : (e?.message || 'Cloud sync failed — retrying'));
      if (batchRetryCount.current <= 3 && !isQuota) {
        setTimeout(() => { flushBatch(); }, 5000);
      } else if (!isQuota) {
        batchRetryCount.current = 0;
        toast.error('Cloud sync failing: ' + (e?.message || 'unknown error') + '. Changes saved locally — will retry.');
      }
    }
  };

  // AGGRESSIVE DEBOUNCE: 3 seconds (quota bachane ke liye writes kam karo)
  const flushBatchDebounced = () => {
    if (batchTimer.current) clearTimeout(batchTimer.current);
    batchTimer.current = setTimeout(() => {
      flushBatch();
    }, 3000);
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

  // --- REMOTE PULL (polling fallback) ---
  // Poora data Firestore se fetch karke state + prev-refs update karta hai.
  // prev-refs isliye update hote hain ke differential push effects yeh data
  // dobara cloud par na likhein (loop na bane).
  // NOTE: No state deps — uses only stable Firestore calls to avoid stale closure
  const pullRemoteData = useCallback(async (reason: string) => {
    try {
      const [tS, cS, sS, ttS, aS, mS, fS, coS, fdS, asgS] = await Promise.all([
        getDocs(collection(db, 'teachers')),
        getDocs(collection(db, 'classes')),
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'timetable')),
        getDocs(collection(db, 'attendance')),
        getDocs(collection(db, 'marks')),
        getDocs(collection(db, 'fees')),
        getDocs(collection(db, 'coordinators')),
        getDocs(collection(db, 'fee_data')),
        getDocs(collection(db, 'assignments')),
      ]);
      const arr = (snap: any) => { const out: any[] = []; snap.forEach((d: any) => out.push(d.data())); return out; };
      const rTeachers = arr(tS) as Teacher[];
      const rClasses = arr(cS) as Class[];
      const rStudents = arr(sS) as Student[];
      const rTimetable = arr(ttS) as TimetableEntry[];
      const rAttendance = arr(aS) as Attendance[];
      const rMarks = arr(mS) as Mark[];
      const rFees = arr(fS) as FeeRecord[];
      const rCoordinators = arr(coS) as Coordinator[];
      const rFeeStudents = arr(fdS) as StudentFeeData[];
      const rAssignments = arr(asgS) as Assignment[];

      if (rTeachers.length > 0) setTeachers(rTeachers);
      if (rClasses.length > 0) setClasses(rClasses);
      if (rStudents.length > 0) setStudents(rStudents);
      setTimetable(rTimetable);
      setAttendance(rAttendance);
      if (rMarks.length > 0) setMarks(rMarks);
      if (rFees.length > 0) setFees(rFees);
      if (rCoordinators.length > 0) setCoordinators(rCoordinators);
      if (rFeeStudents.length > 0) setFeeStudents(rFeeStudents);
      if (rAssignments.length > 0) setAssignments(rAssignments);

      // Update prev-refs to exactly what we pulled (prevents re-push loop)
      prevTeachers.current = JSON.stringify(rTeachers);
      prevClasses.current = JSON.stringify(rClasses);
      prevStudents.current = JSON.stringify(rStudents);
      prevTimetable.current = JSON.stringify(rTimetable);
      prevAttendance.current = JSON.stringify(rAttendance);
      prevMarks.current = JSON.stringify(rMarks);
      prevFees.current = JSON.stringify(rFees);
      prevCoordinators.current = JSON.stringify(rCoordinators);
      prevFeeStudents.current = JSON.stringify(rFeeStudents);
      prevAssignments.current = JSON.stringify(rAssignments);

      // localStorage cache bhi refresh karo
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

      console.log(`[Sync] Remote data pulled (${reason}) — students: ${rStudents.length}, fees: ${rFees.length}, fee_data: ${rFeeStudents.length}`);
    } catch (e: any) {
      console.warn('[Sync] remote pull failed:', e?.message);
    }
  }, []); // No state deps — uses only stable Firestore calls
// --- NEON FULL PULL — poori state Neon Postgres se update karo (Firebase quota fail par cross-device sync) ---
  // Har collection ko prevRef se compare karke hi update karte hain — loop nahi banta.
  const pullFromNeonFull = useCallback(async (reason: string) => {
    try {
      const neonData = await loadAllFromNeon();
      const applyList = <T extends { id: any }>(
        list: any[] | undefined,
        prevRef: React.MutableRefObject<string>,
        setter: (v: T[]) => void,
        storeKey: string
      ) => {
        if (!list || list.length === 0) return;
        const str = JSON.stringify(list);
        if (str !== prevRef.current) {
          setter(list as T[]);
          prevRef.current = str;
          safeStorage.setItem(storeKey, str);
        }
      };
      applyList(neonData['students'], prevStudents, setStudents, 'acadamis_students');
      applyList(neonData['teachers'], prevTeachers, setTeachers, 'acadamis_teachers');
      applyList(neonData['classes'], prevClasses, setClasses, 'acadamis_classes');
      applyList(neonData['timetable'], prevTimetable, setTimetable, 'acadamis_timetable');
      applyList(neonData['attendance'], prevAttendance, setAttendance, 'acadamis_attendance');
      applyList(neonData['marks'], prevMarks, setMarks, 'acadamis_marks');
      applyList(neonData['fees'], prevFees, setFees, 'acadamis_fees');
      applyList(neonData['coordinators'], prevCoordinators, setCoordinators, 'acadamis_coordinators');
      applyList(neonData['fee_data'], prevFeeStudents, setFeeStudents, 'school_fee_data');
      applyList(neonData['assignments'], prevAssignments, setAssignments, 'acadamis_assignments');
      const settingsArr = neonData['app_settings'] || [];
      if (settingsArr.length > 0) {
        const s = settingsArr[0] as AppSettings;
        const sStr = JSON.stringify(s);
        if (sStr !== prevAppSettings.current) {
          setAppSettings(s);
          prevAppSettings.current = sStr;
          safeStorage.setItem('acadamis_app_settings', sStr);
        }
      }
      console.log(`[Sync:Neon] full pull applied (${reason})`);
    } catch (e: any) {
      console.warn('[Sync:Neon] full pull failed:', e?.message);
    }
  }, []); // No state deps — only loads from Neon and sets state

  // Keep ref in sync so heartbeat poll always uses latest version
  useEffect(() => { pullRemoteRef.current = pullRemoteData; }, [pullRemoteData]);

  // Keep ref in sync so heartbeat poll always uses latest version
  useEffect(() => { pullRemoteRef.current = pullRemoteData; }, [pullRemoteData]);

  // --- HEARTBEAT POLL — har 20s sirf sync_meta doc check (1 read), focus par bhi ---
  // + 60s periodic full-sync fallback (agar onSnapshot/heartbeat dono fail hon tab bhi sync ho)
  useEffect(() => {
    if (!userSession) return;
    let stopped = false;
    let lastFullSync = Date.now();
    const checkRemote = async () => {
      if (stopped || !isSyncComplete.current) return;
      // Local writes pending hain to pehle woh flush hon — pull is tick skip
      if (pendingBatch.current.set.length > 0 || pendingBatch.current.del.length > 0) return;
      try {
        const snap = await getDoc(doc(db, 'sync_meta', 'global'));
        if (!snap.exists()) return;
        const ts = Number((snap.data() as any)?.updatedAt) || 0;
        if (ts <= 0) return;
        if (ts !== lastRemoteMeta.current && ts !== lastOwnPush.current) {
          // KISI DOOSRI device ne data badla hai — full pull karo
          lastRemoteMeta.current = ts;
          lastFullSync = Date.now();
          await pullRemoteData('heartbeat');
        } else {
          lastRemoteMeta.current = ts;
        }
        // PERIODIC FULL-SYNC FALLBACK: har 60s bhi pull karo (heartbeat miss hone par bhi sync ho)
        const now = Date.now();
        if (now - lastFullSync >= 60000) {
          lastFullSync = now;
          await pullRemoteData('periodic-60s');
        }
      } catch (e: any) {
        console.warn('[Sync] heartbeat poll failed:', e?.message);
      }

      // ===== NEON CROSS-DEVICE CHECK =====
      // Firebase write quota fail hone par bhi doosri devices ki changes Neon se mil jayen.
      try {
        // 1) Neon heartbeat check — doosri device ne data likha?
        const metaList = await loadCollectionFromNeon('sync_meta');
        const meta = (metaList || [])[0] as any;
        const nu = Number(meta?.updatedAt) || 0;
        const nd = String(meta?.byDevice || '');
        if (nu > 0 && nu !== lastNeonMetaTs.current && nd !== deviceIdRef.current) {
          lastNeonMetaTs.current = nu;
          lastNeonFullSync.current = Date.now();
          console.log('[Sync:Neon] remote heartbeat detected — pulling full data from Neon');
          await pullFromNeonFull('neon-heartbeat');
        } else if (nu > lastNeonMetaTs.current) {
          lastNeonMetaTs.current = nu;
        }
        // 2) PERIODIC NEON FULL-SYNC — har 60s (Firestore periodic miss ho to bhi sync ho)
        const nNow = Date.now();
        if (nNow - lastNeonFullSync.current >= 60000) {
          lastNeonFullSync.current = nNow;
          await pullFromNeonFull('neon-periodic-60s');
        }
      } catch (e: any) {
        console.warn('[Sync] Neon poll failed, will retry next tick:', e?.message);
      }
    };
    const iv = setInterval(checkRemote, 20000);
    const onVis = () => { if (document.visibilityState === 'visible') checkRemote(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    // Session shuru hote hi ek baar check — purana pending remote data turant mil jaye
    const boot = setTimeout(checkRemote, 3000);
    return () => {
      stopped = true;
      clearInterval(iv);
      clearTimeout(boot);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [userSession]);




  // --- REALTIME LISTENERS — onSnapshot se live sync (doosri device ki changes turant) ---
  // Yeh effect initial sync complete hone par sab collections par real-time listener lagata hai.
  // Har snapshot mein data current prevRef se compare hota hai — agar farq ho to state +
  // prevRef + localStorage + Neon backup update hote hain. Apni hi writes skip hoti hain
  // (prevRef pehle se updated hoti hai) — echo loop nahi banta.
  useEffect(() => {
    if (!userSession || !syncReady) return;

    const applyRemote = <T extends { id: any }>(
      snap: any,
      prevRef: React.MutableRefObject<string>,
      setter: (v: T[]) => void,
      key: string,
      storeKey: string,
      neonCol: string
    ) => {
      try {
        const data: T[] = [];
        snap.forEach((d: any) => {
          const v = d.data();
          if (v && d.id !== undefined) {
            // Firestore doc id field mein reflect karo
            data.push({ ...v, id: v.id !== undefined ? v.id : d.id } as T);
          }
        });
        const str = JSON.stringify(data);
        if (str === prevRef.current || str === '[]') {
          // Same data ya khali — kuch nahi karna
          return;
        }
        // Remote change mila — apply karo
        setter(data);
        prevRef.current = str;
        safeStorage.setItem(storeKey, str);
        data.forEach(item => neonQueueWrite(neonCol, String(item.id), item));
        console.log(`[Sync:RT] ${key} remote update — ${data.length} records`);
      } catch (e: any) {
        console.warn(`[Sync:RT] ${key} apply failed:`, e?.message);
      }
    };

    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(collection(db, 'teachers'), (s) => applyRemote(s, prevTeachers, setTeachers, 'teachers', 'acadamis_teachers', 'teachers')));
    unsubs.push(onSnapshot(collection(db, 'classes'), (s) => applyRemote(s, prevClasses, setClasses, 'classes', 'acadamis_classes', 'classes')));
    unsubs.push(onSnapshot(collection(db, 'students'), (s) => applyRemote(s, prevStudents, setStudents, 'students', 'acadamis_students', 'students')));
    unsubs.push(onSnapshot(collection(db, 'timetable'), (s) => applyRemote(s, prevTimetable, setTimetable, 'timetable', 'acadamis_timetable', 'timetable')));
    unsubs.push(onSnapshot(collection(db, 'attendance'), (s) => applyRemote(s, prevAttendance, setAttendance, 'attendance', 'acadamis_attendance', 'attendance')));
    unsubs.push(onSnapshot(collection(db, 'marks'), (s) => applyRemote(s, prevMarks, setMarks, 'marks', 'acadamis_marks', 'marks')));
    unsubs.push(onSnapshot(collection(db, 'fees'), (s) => applyRemote(s, prevFees, setFees, 'fees', 'acadamis_fees', 'fees')));
    unsubs.push(onSnapshot(collection(db, 'coordinators'), (s) => applyRemote(s, prevCoordinators, setCoordinators, 'coordinators', 'acadamis_coordinators', 'coordinators')));
    unsubs.push(onSnapshot(collection(db, 'fee_data'), (s) => applyRemote(s, prevFeeStudents, setFeeStudents, 'fee_data', 'school_fee_data', 'fee_data')));
    unsubs.push(onSnapshot(collection(db, 'assignments'), (s) => applyRemote(s, prevAssignments, setAssignments, 'assignments', 'acadamis_assignments', 'assignments')));

    console.log('[Sync:RT] Real-time listeners active — 10 collections');
    return () => {
      unsubs.forEach(u => u());
      console.log('[Sync:RT] Real-time listeners cleaned up');
    };
  }, [userSession, syncReady]);


  useEffect(() => {
    async function initFirebaseAndSync() {
      try {
        console.log("Checking Firestore connectivity...");

        // NEON bootstrap — schema ensure karo (background, non-blocking)
        ensureNeonSchema().catch(() => {});

        // Timeout to ensure offline fallback if network fails
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Firestore connection timeout")), 15000)
        );

        // Attempt to fetch one small document to warm up the connection and verify access
        await Promise.race([
          getDocs(collection(db, "app_settings")),
          timeoutPromise
        ]);

        console.log("Connection reached. Fetching full datasets...");

        // Fetch remaining collections concurrently
        const [
          teachersSnapshot,
          classesSnapshot,
          studentsSnapshot,
          timetableSnapshot,
          attendanceSnapshot,
          marksSnapshot,
          feesSnapshot,
          coordinatorsSnapshot,
          feeDataSnapshot,
          assignmentsSnapshot
        ] = await Promise.all([
          getDocs(collection(db, "teachers")),
          getDocs(collection(db, "classes")),
          getDocs(collection(db, "students")),
          getDocs(collection(db, "timetable")),
          getDocs(collection(db, "attendance")),
          getDocs(collection(db, "marks")),
          getDocs(collection(db, "fees")),
          getDocs(collection(db, "coordinators")),
          getDocs(collection(db, "fee_data")),
          getDocs(collection(db, "assignments"))
        ]);
        
        // Check if collections exist in Cloud Firestore
        const isDbEmpty = teachersSnapshot.empty &&
                          classesSnapshot.empty &&
                          studentsSnapshot.empty;

        if (isDbEmpty) {
          // ===== NEON FALLBACK — Firestore khali hai to pehle Neon Postgres se load karo =====
          const neonData = await loadAllFromNeon();
          const nStudents = neonData['students'] || [];
          if (nStudents.length > 0) {
            console.log("Firestore empty — loading data from Neon Postgres fallback...");
            const nTeachers = neonData['teachers'] || [];
            const nClasses = neonData['classes'] || [];
            const nTimetable = neonData['timetable'] || [];
            const nAttendance = neonData['attendance'] || [];
            const nMarks = neonData['marks'] || [];
            const nFees = neonData['fees'] || [];
            const nCoordinators = neonData['coordinators'] || [];
            const nFeeStudents = neonData['fee_data'] || [];
            const nAssignments = neonData['assignments'] || [];
            const nSettings = (neonData['app_settings'] || [])[0];

            if (nTeachers.length > 0) setTeachers(nTeachers); else setTeachers(INITIAL_TEACHERS);
            if (nClasses.length > 0) setClasses(nClasses); else setClasses(INITIAL_CLASSES);
            setStudents(nStudents);
            if (nTimetable.length > 0) setTimetable(nTimetable); else setTimetable(INITIAL_TIMETABLE);
            if (nAttendance.length > 0) setAttendance(nAttendance); else setAttendance(INITIAL_ATTENDANCE);
            if (nMarks.length > 0) setMarks(nMarks); else setMarks(INITIAL_MARKS);
            if (nFees.length > 0) setFees(nFees); else setFees(INITIAL_FEES);
            if (nCoordinators.length > 0) setCoordinators(nCoordinators);
            if (nFeeStudents.length > 0) setFeeStudents(nFeeStudents);
            if (nAssignments.length > 0) setAssignments(nAssignments);
            if (nSettings) setAppSettings(nSettings);

            prevTeachers.current = JSON.stringify(nTeachers.length > 0 ? nTeachers : INITIAL_TEACHERS);
            prevClasses.current = JSON.stringify(nClasses.length > 0 ? nClasses : INITIAL_CLASSES);
            prevStudents.current = JSON.stringify(nStudents);
            prevTimetable.current = JSON.stringify(nTimetable.length > 0 ? nTimetable : INITIAL_TIMETABLE);
            prevAttendance.current = JSON.stringify(nAttendance.length > 0 ? nAttendance : INITIAL_ATTENDANCE);
            prevMarks.current = JSON.stringify(nMarks.length > 0 ? nMarks : INITIAL_MARKS);
            prevFees.current = JSON.stringify(nFees.length > 0 ? nFees : INITIAL_FEES);
            prevCoordinators.current = JSON.stringify(nCoordinators);
            prevFeeStudents.current = JSON.stringify(nFeeStudents);
            prevAssignments.current = JSON.stringify(nAssignments);
            if (nSettings) prevAppSettings.current = JSON.stringify(nSettings);

            isSyncComplete.current = true;
            setSyncReady(true);
            toast.success('Firebase khali tha — data Neon Postgres se load ho gaya ✓');
            return;
          }

          console.log("Firestore database is empty. Seeding initial datasets into Cloud Firestore...");
          
          try {
            await Promise.all([
              ...INITIAL_TEACHERS.map(t => setDoc(doc(db, "teachers", t.id), sanitizeForFirestore(t))),
              ...INITIAL_CLASSES.map(c => setDoc(doc(db, "classes", c.id), sanitizeForFirestore(c))),
              ...INITIAL_STUDENTS.map(s => setDoc(doc(db, "students", s.id), sanitizeForFirestore(s))),
              ...INITIAL_TIMETABLE.map(tm => setDoc(doc(db, "timetable", tm.id), sanitizeForFirestore(tm))),
              ...INITIAL_ATTENDANCE.map(a => setDoc(doc(db, "attendance", a.id), sanitizeForFirestore(a))),
              ...INITIAL_MARKS.map(m => setDoc(doc(db, "marks", m.id), sanitizeForFirestore(m))),
              ...INITIAL_FEES.map(f => setDoc(doc(db, "fees", f.id), sanitizeForFirestore(f)))
            ]);
            console.log("Seeding to Firestore completed successfully.");
          } catch (seedErr) {
            console.warn("Seeding to Firestore encountered warning:", seedErr);
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
          console.log("Loading datasets from active Cloud Firestore...");
          
          const loadedTeachers: Teacher[] = [];
          teachersSnapshot.forEach(docSnap => loadedTeachers.push(docSnap.data() as Teacher));

          const loadedClasses: Class[] = [];
          classesSnapshot.forEach(docSnap => loadedClasses.push(docSnap.data() as Class));

          const loadedStudents: Student[] = [];
          studentsSnapshot.forEach(docSnap => loadedStudents.push(docSnap.data() as Student));

          const loadedTimetable: TimetableEntry[] = [];
          timetableSnapshot.forEach(docSnap => loadedTimetable.push(docSnap.data() as TimetableEntry));

          const loadedAttendance: Attendance[] = [];
          attendanceSnapshot.forEach(docSnap => loadedAttendance.push(docSnap.data() as Attendance));

          const loadedMarks: Mark[] = [];
          marksSnapshot.forEach(docSnap => loadedMarks.push(docSnap.data() as Mark));

          const loadedFees: FeeRecord[] = [];
          feesSnapshot.forEach(docSnap => loadedFees.push(docSnap.data() as FeeRecord));

          const loadedCoordinators: Coordinator[] = [];
          coordinatorsSnapshot.forEach(docSnap => loadedCoordinators.push(docSnap.data() as Coordinator));

          const loadedFeeStudents: StudentFeeData[] = [];
          feeDataSnapshot.forEach(docSnap => loadedFeeStudents.push(docSnap.data() as StudentFeeData));

          const loadedAssignments: Assignment[] = [];
          assignmentsSnapshot.forEach(docSnap => loadedAssignments.push(docSnap.data() as Assignment));

          // Load App Settings
          const settingsSnap = await getDoc(doc(db, "app_settings", "global"));
          let loadedSettings: AppSettings | null = null;
          if (settingsSnap.exists()) {
            loadedSettings = settingsSnap.data() as AppSettings;
          }

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
          let effectiveFeeStudents: StudentFeeData[] = loadedFeeStudents;
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
            effectiveFeeStudents = defaultFeeStudents;
          }
          if (loadedSettings) setAppSettings(loadedSettings);

          // Background auto-seed if any collection was empty in Firestore
          if (loadedStudents.length === 0) {
            INITIAL_STUDENTS.forEach(s => setDoc(doc(db, "students", s.id), sanitizeForFirestore(s)).catch(() => {}));
          }
          if (loadedClasses.length === 0) {
            INITIAL_CLASSES.forEach(c => setDoc(doc(db, "classes", c.id), sanitizeForFirestore(c)).catch(() => {}));
          }
          if (loadedTeachers.length === 0) {
            INITIAL_TEACHERS.forEach(t => setDoc(doc(db, "teachers", t.id), sanitizeForFirestore(t)).catch(() => {}));
          }
          if (loadedAttendance.length === 0) {
            INITIAL_ATTENDANCE.forEach(a => setDoc(doc(db, "attendance", a.id), sanitizeForFirestore(a)).catch(() => {}));
          }
          if (loadedFees.length === 0) {
            INITIAL_FEES.forEach(f => setDoc(doc(db, "fees", f.id), sanitizeForFirestore(f)).catch(() => {}));
          }

          prevTeachers.current = JSON.stringify(finalTeachers);
          prevClasses.current = JSON.stringify(finalClasses);
          prevStudents.current = JSON.stringify(finalStudents);
          prevTimetable.current = JSON.stringify(finalTimetable);
          prevAttendance.current = JSON.stringify(finalAttendance);
          prevMarks.current = JSON.stringify(finalMarks);
          prevFees.current = JSON.stringify(finalFees);
          prevCoordinators.current = JSON.stringify(loadedCoordinators);
          prevFeeStudents.current = JSON.stringify(loadedFeeStudents.length > 0 ? loadedFeeStudents : []);
          prevAssignments.current = JSON.stringify(loadedAssignments.length > 0 ? loadedAssignments : []);
          if (loadedSettings) prevAppSettings.current = JSON.stringify(loadedSettings);

          // ===== NEON BOOTSTRAP MIRROR — Firestore se load hua poora data Neon Postgres backup mein bhi =====
          // Yeh fire-and-forget hai; Neon fail ho to app normally chalti rahegi.
          (async () => {
            try {
              if (!(await ensureNeonSchema())) return;
              const mirrorLists: [string, any[]][] = [
                ['teachers', finalTeachers],
                ['classes', finalClasses],
                ['students', finalStudents],
                ['timetable', finalTimetable],
                ['attendance', finalAttendance],
                ['marks', finalMarks],
                ['fees', finalFees],
                ['coordinators', loadedCoordinators],
                ['fee_data', effectiveFeeStudents],
                ['assignments', loadedAssignments]
              ];
              let total = 0;
              mirrorLists.forEach(([col, arr]) => {
                (arr || []).forEach(item => {
                  if (item?.id !== undefined && item?.id !== null) {
                    neonQueueWrite(col, String(item.id), item);
                    total++;
                  }
                });
              });
              if (loadedSettings) {
                neonQueueWrite('app_settings', 'global', loadedSettings);
              }
              await flushNeon();
              console.log(`[Neon] Bootstrap mirror complete — ${total} records backed up.`);
            } catch (e: any) {
              console.warn('[Neon] bootstrap mirror failed:', e?.message);
            }
          })();
        }
        isSyncComplete.current = true;
        setSyncReady(true);
      } catch (err: any) {
        console.warn("Firestore sync running in background/offline fallback mode:", err?.message);
        setSyncError(err?.message || "Offline fallback");

        // ===== NEON FALLBACK — Firebase fail to Neon Postgres se data load karo =====
        try {
          const neonData = await loadAllFromNeon();
          const nStudents = neonData['students'] || [];
          if (nStudents.length > 0) {
            console.log("Firebase unavailable — loading from Neon Postgres fallback...");
            const nTeachers = neonData['teachers'] || [];
            const nClasses = neonData['classes'] || [];
            const nTimetable = neonData['timetable'] || [];
            const nAttendance = neonData['attendance'] || [];
            const nMarks = neonData['marks'] || [];
            const nFees = neonData['fees'] || [];
            const nCoordinators = neonData['coordinators'] || [];
            const nFeeStudents = neonData['fee_data'] || [];
            const nAssignments = neonData['assignments'] || [];
            const nSettings = (neonData['app_settings'] || [])[0];

            if (nTeachers.length > 0) setTeachers(nTeachers);
            if (nClasses.length > 0) setClasses(nClasses);
            setStudents(nStudents);
            if (nTimetable.length > 0) setTimetable(nTimetable);
            if (nAttendance.length > 0) setAttendance(nAttendance);
            if (nMarks.length > 0) setMarks(nMarks);
            if (nFees.length > 0) setFees(nFees);
            if (nCoordinators.length > 0) setCoordinators(nCoordinators);
            if (nFeeStudents.length > 0) setFeeStudents(nFeeStudents);
            if (nAssignments.length > 0) setAssignments(nAssignments);
            if (nSettings) setAppSettings(nSettings);

            prevTeachers.current = JSON.stringify(nTeachers);
            prevClasses.current = JSON.stringify(nClasses);
            prevStudents.current = JSON.stringify(nStudents);
            prevTimetable.current = JSON.stringify(nTimetable);
            prevAttendance.current = JSON.stringify(nAttendance);
            prevMarks.current = JSON.stringify(nMarks);
            prevFees.current = JSON.stringify(nFees);
            prevCoordinators.current = JSON.stringify(nCoordinators);
            prevFeeStudents.current = JSON.stringify(nFeeStudents);
            prevAssignments.current = JSON.stringify(nAssignments);
            if (nSettings) prevAppSettings.current = JSON.stringify(nSettings);

            isSyncComplete.current = true;
            setSyncReady(true);
            toast.success('Firebase unavailable — data Neon Postgres se load ho gaya ✓');
            return;
          }
        } catch (neonErr: any) {
          console.warn("Neon fallback load failed:", neonErr?.message);
        }

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

    initFirebaseAndSync();
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
  // sanitizeForFirestore is imported from './lib/firestoreUtils' — it removes
  // 'undefined' values, which Firestore rejects in documents.

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
        await setDoc(doc(db, "app_settings", "global"), sanitizeForFirestore(appSettings));
        // NEON MIRROR — settings Neon mein bhi (collection 'app_settings', id 'global')
        neonQueueWrite("app_settings", "global", appSettings);
        prevAppSettings.current = currentStr;
        safeStorage.setItem('acadamis_app_settings', currentStr);
        bumpSyncMeta(['app_settings']);
      } catch (e) {
        console.error("Firestore Settings Sync Error:", e);
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

  // --- PERIODIC FIRESTORE SYNC — REMOVED (quota fix) ---
  // The old 30s full-pull (~750 reads every 30s) and 60s full-push (~750 writes
  // every 60s) exhausted the Firebase free-tier quota (RESOURCE_EXHAUSTED), after
  // which ALL new saves failed. Real-time updates are already handled by the
  // onSnapshot listeners in each dashboard (near-zero quota cost), and local
  // changes are pushed by the differential batch writer below, which only
  // writes documents that actually changed. pushLocalToCloud() is kept for the
  // manual "Force Sync to Cloud" button only.


  // NOTE: The automatic 60-second full push was removed (quota fix) — it rewrote
  // every document (~750 writes/minute) and exhausted the free-tier write quota,
  // which made ALL saves fail with RESOURCE_EXHAUSTED. Changed documents are
  // pushed in real time by the differential batch writer, and "Force Sync to
  // Cloud" (this function) remains available as a manual full backup.
  const pushLocalToCloud = useCallback(async () => {
    if (!userSession) return;
    
    try {
      console.log("Pushing local data to Firestore...");
      
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
              // sanitizeForFirestore strips 'undefined' values Firestore rejects —
              // without it a single optional field (email, photo, paidDate...)
              // failed the ENTIRE push.
              await setDoc(doc(db, item.col, String(listItem.id)), sanitizeForFirestore(listItem));
              // NEON MIRROR — full backup mein Neon Postgres mein bhi
              neonQueueWrite(item.col, String(listItem.id), listItem);
            }
          }
        } else if (item.type === 'object' && item.docId) {
          await setDoc(doc(db, item.col, item.docId), sanitizeForFirestore(item.data));
          // NEON MIRROR — settings bhi
          neonQueueWrite(item.col, item.docId, item.data);
        }
      }
      // Neon queue ko foran flush karo (Force Sync = immediate backup)
      await flushNeon();
      
      console.log("Push to Firestore complete (+ Neon mirror)");
      // Heartbeat bump — doosri devices (jinke onSnapshot fail hon) 20s ke poll se
      // yeh change foran pick kar lengi
      try { await bumpSyncMeta(['teachers','classes','students','timetable','attendance','marks','fees','coordinators','fee_data','assignments']); } catch { /* non-fatal */ }
    } catch (err) {
      console.warn("Push to Firestore failed:", err);
      // Rethrow so callers (e.g. the Force Sync button) can surface the failure
      // instead of showing a false "synced" success message.
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
