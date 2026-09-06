# NSB1 School Management System - Technical Documentation

## Overview
A comprehensive school management PWA built with React 19, TypeScript, Vite, Supabase (PostgreSQL), and Tailwind CSS. Features role-based portals for Principal, Coordinator, Teacher, and Student with real-time cross-device synchronization.

---

## Architecture

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite 6
- **Styling**: Tailwind CSS 4 + Lucide React icons
- **State**: React hooks (useState, useEffect, useMemo, useCallback, useRef)
- **Database**: Supabase PostgreSQL `records` table (with localStorage fallback)
- **Auth**: Custom email/password (Supabase Auth ready)
- **PWA**: Workbox service worker + Web App Manifest
- **Charts**: Recharts
- **Animations**: Motion (framer-motion)
- **Notifications**: Sonner toast
- **Date/Time**: Native JS Date API

### Project Structure
```
src/
├── App.tsx                 # Root: auth, routing, Supabase sync orchestration
├── supabase.ts             # Supabase client init (Data + Realtime)
├── types.ts                # All TypeScript interfaces
├── initialData.ts          # Seed data (25 students, 6 teachers, 4 classes)
├── lib/
│   ├── supabaseSync.ts     # Queue/flush/load + realtime (postgres_changes) helpers
├── lib/
│   ├── feeEngine.ts        # Core fee/dues logic (payments, otherFunds, dues)
│   ├── safeStorage.ts      # localStorage wrapper (SSR-safe)
│   ├── periodUtils.ts      # Timetable period status (past/current/future)
│   ├── notificationUtils.ts# In-app notification system
│   └── longPress.ts        # Long-press gesture hook
├── components/
│   ├── LandingPage.tsx     # Public landing page
│   ├── Login.tsx           # Unified login (all roles)
│   ├── PrincipalDashboard.tsx  # Principal/Coordinator portal (full access)
│   ├── TeacherDashboard.tsx    # Teacher portal (limited access)
│   ├── StudentDashboard.tsx    # Student portal (read-only + ID card)
│   ├── PrintableReport.tsx     # PDF-ready student report
│   ├── AttendanceSwipeOverlay.tsx
│   └── HoldActionWrapper.tsx   # Long-press edit/delete wrapper
└── assets/                 # Images, logos
```

---

## Role-Based Access Control

| Feature | Principal | Coordinator | Teacher | Student |
|---------|-----------|-------------|---------|---------|
| **Dashboard** | Full metrics | Full metrics | Class metrics | Personal metrics |
| **Students** | CRUD all | View all | View own class | View self only |
| **Teachers** | CRUD all | View all | View self | View assigned |
| **Classes** | CRUD all | View all | View assigned | View own |
| **Timetable** | CRUD all | View all | View assigned | View own class |
| **Attendance** | Mark all classes | Mark all classes | Mark own classes | View self |
| **Marks/Grades** | CRUD all | CRUD all | CRUD own subjects | View self |
| **Fees/Collection** | Full CRUD + dues | View + collect | View only | View self ledger |
| **Fee Dues (extra)** | Full CRUD | View + add | No | View self |
| **WhatsApp Alerts** | Fee + Attendance | Fee + Attendance | No | No |
| **Reports/Print** | All students | All students | Own class | Self only |
| **Settings/Cloud** | Full sync control | View only | Profile only | Profile only |
| **Assignments** | CRUD all | CRUD all | CRUD own | View assigned |
| **ID Card Design** | No | No | No | Full designer |

### Role Definitions
- **Principal** (`principal`): Super admin, full system access, cloud sync control
- **Coordinator** (`coordinator`): Academic coordinator, similar to principal but no cloud delete
- **Teacher** (`teacher`): Class/subject teacher, marks attendance & grades for assigned classes
- **Student** (`student`): Views own data, attendance, marks, fees, designs ID card

---

## Data Flow & Synchronization

### Firestore Collections
| Collection | Description | Auto-Sync |
|------------|-------------|-----------|
| `teachers` | Teacher profiles | ✅ Real-time + 60s push |
| `students` | Student profiles | ✅ Real-time + 60s push |
| `classes` | Class definitions + teacher mapping | ✅ Real-time + 60s push |
| `timetable` | Period schedules | ✅ Real-time + 60s push |
| `attendance` | Daily attendance records | ✅ Real-time + 60s push |
| `marks` | Exam/test scores | ✅ Real-time + 60s push |
| `fees` | Payment transaction records | ✅ Real-time + 60s push |
| `fee_data` | Student fee ledger (payments, otherFunds, dues) | ✅ Real-time + 60s push |
| `coordinators` | Coordinator profiles | ✅ Real-time + 60s push |
| `assignments` | Homework/assignments | ✅ Real-time + 60s push |
| `app_settings` | Global templates (WhatsApp, fee, absent) | ✅ Real-time + 60s push |

### Sync Strategy (App.tsx)
```typescript
// 1. INITIAL LOAD (mount)
- Fetch all collections from Firestore
- If empty → seed from initialData.ts
- If error → use localStorage/initialData, still enable writes

// 2. REAL-TIME LISTENERS (onSnapshot in each dashboard)
- Principal/Teacher/Student dashboards listen to relevant collections
- Instant cross-device updates when any portal makes changes

// 3. DIFFERENTIAL PUSH (debounced 400ms)
- On state change → queueBatchWrite() → writeBatch.commit()
- Only changed documents written (diff via JSON.stringify comparison)

// 4. PERIODIC PULL (every 30s)
- getDocs() all collections → merge if server has newer data

// 5. PERIODIC PUSH (every 60s) - NEW
- pushLocalToCloud() → full upload of all local state to Firestore
- Ensures offline changes eventually reach cloud

// 6. MANUAL FORCE SYNC
- Principal Dashboard → Settings → "Force Sync to Cloud" button
- Immediate full upload for critical changes
```

### Offline-First Design
- All reads from local React state (populated from localStorage on mount)
- Writes update local state immediately → UI responsive
- Background sync to Firestore (non-blocking)
- localStorage cache updated every 400ms (debounced)
- On reload: localStorage → state → Firestore sync in background

---

## Fee Engine (lib/feeEngine.ts)

### Core Concepts
- **Monthly Fee (Tuition/School Fee)**: Recurring per month, based on `enrollmentMonth`
- **Other Funds**: One-time charges (Paper Fund, Summer Pack, Miscellaneous)
- **Dues**: Separate ledger for fines/extra charges with status (pending/paid/waived)

### Data Model
```typescript
interface StudentFeeData {
  id: string | number;
  name: string;
  class: string;
  monthlyFee: number;
  enrollmentMonth?: string;  // e.g., "April"
  payments: Payment[];       // Monthly fee payments
  otherFunds: OtherFund[];   // One-time charges
  dues: DueEntry[];          // Fines/extra charges with status
}
```

### Key Functions
| Function | Purpose |
|----------|---------|
| `getMonthlySummary(student, month, year)` | `{due, paid, pending, isFutureMonth}` |
| `getYearlySummary(student, year)` | 12-month array with status |
| `getTotalPending(student)` | Sum of all unpaid months + otherFunds + dues |
| `getTotalDues(student)` | Sum of pending dues only |
| `addPayment()` | Record fee payment (auto-allocates to oldest pending) |
| `addOtherFund()` | Add Paper Fund, Summer Pack, etc. |
| `addDue()` | Add fine/extra charge with month/year |
| `payDue()` | Mark due as paid |
| `getStudentFullAccount(student, year)` | Complete ledger for dashboard |
| `getGlobalStats(students[])` | School-wide totals |

### Enrollment Month Logic
- Student only owes fees **from enrollment month onward**
- Months before enrollment → `due = 0`, `isFutureMonth = false`, `isBeforeEnrollment = true`
- Future months → `due = 0`, `isFutureMonth = true`

---

## WhatsApp Integration

### Templates (App Settings)
```typescript
interface AppSettings {
  absentTemplate: string;      // {student_name}, {roll_number}, {date}, {class_name}
  feeTemplate: string;         // {name}, {month}, {amount}, {date}
  resultTemplate: string;      // {student_name}, {roll_number}, {class_name}, {exam_name}, {subjects}, {total_obtained}, {total_max}, {percentage}, {status}
  whatsAppAutoFee: boolean;    // Auto-open WhatsApp on fee collection
  whatsAppAutoAbsence: boolean;// Auto-open WhatsApp on absent marking
  whatsAppAutoResult: boolean; // Auto-open WhatsApp on result publish
  autoWhatsAppRedirect: boolean; // Direct open vs preview modal
}
```

### Triggers
| Event | Auto-Send | Manual Button |
|-------|-----------|---------------|
| Fee collected | `whatsAppAutoFee` | "Send Receipt" in fee history |
| Student marked absent | `whatsAppAutoAbsence` | Per-student 📱 button in attendance |
| Bulk absent students | - | "WhatsApp All" in attendance register |
| Result published | `whatsAppAutoResult` | "Send" per student in results register |

### Phone Number Formatting
- Input: `+92-300-1234567` or `03001234567` or `3001234567`
- Output: `923001234567` (WhatsApp `wa.me/` format)
- Validates: must have parentPhone or studentPhone

---

## Duplicate Code Issues & Refactoring Opportunities

### Identified Duplicates
| Area | Files | Solution |
|------|-------|----------|
| **Fee month parsing** | PrincipalDashboard (parseMonthKey, MONTH_ALIAS), FeeMonthGrid | Extract to `lib/feeUtils.ts` |
| **WhatsApp phone formatting** | PrincipalDashboard (3x), TeacherDashboard | Extract to `lib/whatsappUtils.ts` |
| **Attendance roster logic** | PrincipalDashboard (attendanceRosterRows, attendanceDisplayRows) | Extract hook `useAttendanceRoster()` |
| **Student/Class/Teacher maps** | All 3 dashboards (useMemo maps) | Centralize in App.tsx context |
| **Real-time listeners** | All 3 dashboards (onSnapshot boilerplate) | Custom hook `useFirestoreSync(collections[])` |
| **Modal form patterns** | PrincipalDashboard (5+ modals) | Reusable `<EntityModal />` component |
| **Table/Card responsive patterns** | All dashboards (mobile cards + desktop tables) | `<ResponsiveTable />` component |
| **Fee summary cards** | PrincipalDashboard, StudentDashboard, TeacherDashboard | `<FeeSummaryCards />` component |

### Recommended Refactors
1. **Create `lib/feeUtils.ts`** - Centralize month parsing, fee type detection
2. **Create `hooks/useFirestoreSync.ts`** - Single source for onSnapshot listeners
3. **Create `components/common/ResponsiveTable.tsx`** - Eliminate mobile/desktop duplication
4. **Create `components/common/EntityModal.tsx`** - Generic CRUD modal
5. **Move `pushLocalToCloud` to `lib/firestoreSync.ts`** - Share across dashboards
6. **Add React Context for global state** - Replace prop drilling in App.tsx

---

## Deployment & Operations

### Build Commands
```bash
npm run dev       # Dev server (port 3000/3001)
npm run build     # Production build → dist/
npm run preview   # Preview production build
npm run lint      # TypeScript check (tsc --noEmit)
npx tsx seed-firestore.ts  # One-time Firestore seeding
```

### Firebase Setup Checklist
- [ ] Firestore Database created (Native mode)
- [ ] Security Rules: Test mode (`allow read, write: if true;`)
- [ ] Authentication → Email/Password enabled
- [ ] Project ID matches `firebase-applet-config.json`
- [ ] Named database ID matches (or use `(default)`)

### PWA Installation
- Runs on HTTPS or localhost
- Shows install prompt after 1.5s
- Service worker caches all static assets
- Works offline (reads from localStorage/cache)

---

## Known Limitations & TODOs

### High Priority
- [ ] Add Firebase Security Rules for production
- [ ] Implement proper auth (Firebase Auth + custom claims for roles)
- [ ] Add data validation/sanitization on write
- [ ] Implement conflict resolution for concurrent edits
- [ ] Add audit log collection for all changes

### Medium Priority
- [ ] Extract duplicate code (see table above)
- [ ] Add unit tests for feeEngine.ts
- [ ] Add E2E tests (Playwright)
- [ ] Implement data export/import with validation
- [ ] Add dark mode persistence across devices

### Low Priority
- [ ] Migrate to React Query / SWR for server state
- [ ] Add IndexedDB for larger offline cache
- [ ] Implement push notifications (FCM)
- [ ] Add multi-school/tenant support
- [ ] Create admin CLI for bulk operations

---

## Quick Reference: Key Files to Modify

| Change | File(s) |
|--------|---------|
| Add new fee type | `types.ts`, `feeEngine.ts`, `PrincipalDashboard.tsx` |
| Modify WhatsApp template | `App.tsx` (appSettings default), `PrincipalDashboard.tsx` (settings tab) |
| Add new role | `types.ts` (Role), `Login.tsx`, `App.tsx` (routing), dashboards |
| Change sync interval | `App.tsx` (30s pull, 60s push) |
| Modify attendance statuses | `types.ts` (Attendance.status), dashboards |
| Add new notification type | `lib/notificationUtils.ts`, `types.ts` |
| Seed more initial data | `initialData.ts`, `seed-firestore.ts` |

---

## Support & Debugging

### Debug Console Commands
```javascript
// Check sync status
console.log('Sync complete:', window.__SYNC_COMPLETE__);

// Force sync from any dashboard
pushLocalToCloud();

// View localStorage keys
Object.keys(localStorage).filter(k => k.startsWith('acadamis'));

// Test Firebase connection
testFirebaseConnection().then(console.log);
```

### Common Issues
| Symptom | Cause | Fix |
|---------|-------|-----|
| Data not on other device | Initial sync failed, push not running | Click "Force Sync to Cloud" or wait 60s |
| Fee shows wrong months | enrollmentMonth not set | Edit student → set enrollmentMonth |
| WhatsApp not opening | Phone format / popup blocked | Check parentPhone, allow popups |
| Build fails | TypeScript errors | Run `npm run lint` for details |
| PWA not installing | Not HTTPS / localhost | Use `npm run preview` or deploy |

---

*Generated for NSB1 School Management System v1.0*
*Last Updated: 2026*