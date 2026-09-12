// patch-app-remainder.cjs — wires notices / events / quizzes / quiz_attempts
// into App.tsx realtime applyData, subscriber callback, and seeder.
// Uses LF-normalized matching so CRLF files still patch correctly.
'use strict';
const fs = require('fs');
const appPath = 'd:/app/school app demo/src/App.tsx';
let src = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');
let changed = false;

function replaceOnce(needle, replacement) {
  const idx = src.indexOf(needle);
  if (idx === -1) {
    console.log('NOT_FOUND:', JSON.stringify(needle.slice(0, 90)));
    return false;
  }
  src = src.slice(0, idx) + replacement + src.slice(idx + needle.length);
  return true;
}

// ---- 1) Realtime applyData: apply new collections from Supabase ----
const applyNeedle =
`      applyList(data['assignments'], prevAssignments, setAssignments, 'acadamis_assignments');
      const settingsArr = data['app_settings'] || [];`;
const applyReplacement =
`      applyList(data['assignments'], prevAssignments, setAssignments, 'acadamis_assignments');
      applyList(data['notices'], prevNotices, setNotices, 'acadamis_notices');
      applyList(data['school_events'], prevEvents, setEvents, 'acadamis_events');
      applyList(data['quizzes'], prevQuizzes, setQuizzes, 'acadamis_quizzes');
      applyList(data['quiz_attempts'], prevQuizAttempts, setQuizAttempts, 'acadamis_quiz_attempts');
      const settingsArr = data['app_settings'] || [];`;
if (replaceOnce(applyNeedle, applyReplacement)) changed = true;

// ---- 2) Realtime subscriber callback: merge new collections into local state ----
const subNeedle =
`          applyList(data['assignments'], prevAssignments, setAssignments, 'acadamis_assignments');
          if (loadedSettings) setAppSettings(loadedSettings);`;
const subReplacement =
`          applyList(data['assignments'], prevAssignments, setAssignments, 'acadamis_assignments');
          applyList(data['notices'], prevNotices, setNotices, 'acadamis_notices');
          applyList(data['school_events'], prevEvents, setEvents, 'acadamis_events');
          applyList(data['quizzes'], prevQuizzes, setQuizzes, 'acadamis_quizzes');
          applyList(data['quiz_attempts'], prevQuizAttempts, setQuizAttempts, 'acadamis_quiz_attempts');
          if (loadedSettings) setAppSettings(loadedSettings);`;
if (replaceOnce(subNeedle, subReplacement)) changed = true;

// ---- 3) Seeder (Supabase empty): queue new-collection seeds ----
const seedNeedle =
`            loadedData['assignments'].forEach((a: Assignment) => {
              if (a?.id !== undefined) sbQueueWrite('assignments', String(a.id), a);
            });`;
const seedReplacement =
`            loadedData['assignments'].forEach((a: Assignment) => {
              if (a?.id !== undefined) sbQueueWrite('assignments', String(a.id), a);
            });
            loadedData['notices'].forEach((n: Notice) => {
              if (n?.id !== undefined) sbQueueWrite('notices', String(n.id), n);
            });
            loadedData['school_events'].forEach((e: SchoolEvent) => {
              if (e?.id !== undefined) sbQueueWrite('school_events', String(e.id), e);
            });
            loadedData['quizzes'].forEach((q: Quiz) => {
              if (q?.id !== undefined) sbQueueWrite('quizzes', String(q.id), q);
            });
            loadedData['quiz_attempts'].forEach((q: QuizAttempt) => {
              if (q?.id !== undefined) sbQueueWrite('quiz_attempts', String(q.id), q);
            });`;
if (replaceOnce(seedNeedle, seedReplacement)) changed = true;

// Restore original line endings
const orig = fs.readFileSync(appPath, 'utf8');
const hasCRLF = orig.includes('\r\n');
fs.writeFileSync(appPath, hasCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
console.log('patch-app-remainder: changes=' + changed);
