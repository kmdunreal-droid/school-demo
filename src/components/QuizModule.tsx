/**
 * QUIZ MODULE — Online MCQ exams with auto-grading.
 *  - Teacher/Coordinator/Principal: quiz builder (manual + AI MCQs), publish, results
 *  - Student: attempt with timer, instant score
 * Demo/local store: 'acadamis_quizzes' + 'acadamis_quiz_attempts' (portalStore pattern).
 */
import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  ClipboardList, Plus, Trash2, Play, Clock,
  Sparkles, Loader2, Trophy, Send, ChevronLeft, ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';
import type { Quiz, QuizQuestion, QuizAttempt, UserSession, Student, Class } from '../types';
import { usePortalCollection, newId, PORTAL_TABLES } from '../lib/portalStore';
import { aiGenerateMcqs, isAiEnabled, type PaperSource } from '../lib/gemini';

interface QuizModuleProps {
  userSession: UserSession;
  students: Student[];
  classes: Class[];
}

export default function QuizModule({ userSession, students, classes }: QuizModuleProps) {
  const isStudent = userSession.role === 'student';
  const canManage = userSession.role !== 'student';
  return isStudent
    ? <StudentQuizView userSession={userSession} students={students} />
    : canManage
      ? <ManagerQuizView userSession={userSession} students={students} classes={classes} />
      : <p className="text-xs font-bold text-slate-400 uppercase tracking-widest p-6">Access restricted</p>;
}

// ============================================================
// STUDENT VIEW — attempt + results
// ============================================================
function StudentQuizView({ userSession, students }: { userSession: UserSession; students: Student[] }) {
  const { items: quizzes } = usePortalCollection<Quiz>('acadamis_quizzes', PORTAL_TABLES.quizzes);
  const { items: attempts, upsert: upsertAttempt } = usePortalCollection<QuizAttempt>('acadamis_quiz_attempts', PORTAL_TABLES.quizAttempts);

  const me = students.find(s => String(s.id) === String(userSession.id));
  const myClassId = me?.classId || '';

  const visibleQuizzes = useMemo(
    () => quizzes
      .filter(q => q.status === 'published' && (!q.classId || q.classId === 'all' || q.classId === myClassId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [quizzes, myClassId]
  );

  const attemptOf = useCallback(
    (quizId: string) => attempts.find(a => a.quizId === quizId && String(a.studentId) === String(userSession.id)),
    [attempts, userSession.id]
  );

  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);

  if (activeQuiz) {
    return (
      <QuizRunner
        quiz={activeQuiz}
        student={me}
        onFinish={(answers, score) => {
          upsertAttempt({
            id: newId('attempt'),
            quizId: activeQuiz.id,
            quizTitle: activeQuiz.title,
            studentId: String(userSession.id),
            studentName: me?.name || userSession.name || 'Student',
            answers,
            score,
            totalMarks: activeQuiz.totalMarks,
            submittedAt: new Date().toISOString(),
          });
          setActiveQuiz(null);
        }}
        onCancel={() => setActiveQuiz(null)}
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
          <ClipboardList size={22} className="text-teal-600" /> My Quizzes
        </h1>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Online tests — turant result ke sath</p>
      </div>

      <div className="space-y-3">
        {visibleQuizzes.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
            Abhi koi quiz nahi aya 📚
          </div>
        )}
        {visibleQuizzes.map(q => {
          const att = attemptOf(q.id);
          const pct = att ? Math.round((att.score / Math.max(1, att.totalMarks)) * 100) : 0;
          return (
            <motion.div key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`bg-white border rounded-2xl p-4 shadow-sm ${att ? (pct >= 40 ? 'border-teal-200' : 'border-rose-200') : 'border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center"><ClipboardList size={18} /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-black text-slate-900 text-sm truncate">{q.title}</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {q.subject} · {q.questions.length} Qs · {q.totalMarks} marks · {q.timeLimitMin} min
                    {q.dueDate ? ` · Due ${q.dueDate}` : ''}
                  </p>
                </div>
                {att ? (
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-black leading-none ${pct >= 40 ? 'text-teal-600' : 'text-rose-600'}`}>{pct}%</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{att.score}/{att.totalMarks}</p>
                  </div>
                ) : (
                  <button
                    onClick={() => setActiveQuiz(q)}
                    className="shrink-0 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
                  >
                    <Play size={12} /> Start
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// QUIZ RUNNER — timer + one question at a time + auto-grade
// ============================================================
function QuizRunner({
  quiz, student, onFinish, onCancel,
}: {
  quiz: Quiz;
  student?: Student;
  onFinish: (answers: Record<string, number>, score: number) => void;
  onCancel: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(quiz.timeLimitMin * 60);
  const [submitted, setSubmitted] = useState(false);

  const finish = useCallback((finalAnswers: Record<string, number>) => {
    if (submitted) return;
    setSubmitted(true);
    const score = quiz.questions.reduce((sum, q) => (finalAnswers[q.id] === q.correctIndex ? sum + q.marks : sum), 0);
    onFinish(finalAnswers, score);
  }, [quiz, onFinish, submitted]);

  useEffect(() => {
    if (submitted) return;
    const t = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(t);
          finish(answers);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [submitted, answers, finish]);

  const q = quiz.questions[idx];
  const answered = Object.keys(answers).length;
  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0');
  const ss = String(timeLeft % 60).padStart(2, '0');

  const pick = (optionIdx: number) => setAnswers(prev => ({ ...prev, [q.id]: optionIdx }));

  return (
    <div className="space-y-5 animate-fade-in max-w-2xl mx-auto">
      <div className="bg-gradient-to-br from-slate-900 via-teal-900 to-slate-900 rounded-2xl p-5 flex items-center justify-between shadow-xl">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-teal-300">{quiz.subject} · Quiz</p>
          <h2 className="text-lg font-black text-white uppercase tracking-tight">{quiz.title}</h2>
          <p className="text-[10px] text-teal-200 font-bold uppercase tracking-widest mt-0.5">{student?.name || 'Student'}</p>
        </div>
        <div className={`text-right px-4 py-2 rounded-xl ${timeLeft < 60 ? 'bg-rose-500/20' : 'bg-white/10'}`}>
          <p className="text-[9px] font-black uppercase tracking-widest text-teal-200 flex items-center gap-1 justify-end"><Clock size={11} /> Time</p>
          <p className={`text-xl font-black tabular-nums ${timeLeft < 60 ? 'text-rose-300' : 'text-white'}`}>{mm}:{ss}</p>
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${((idx + 1) / quiz.questions.length) * 100}%` }} />
        </div>
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{idx + 1}/{quiz.questions.length} · {answered} answered</span>
      </div>

      {/* Question */}
      <motion.div key={q.id} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 leading-relaxed">{q.question}</h3>
          <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black">{q.marks} mk</span>
        </div>
        <div className="space-y-2.5 mt-4">
          {q.options.map((opt, oi) => {
            const selected = answers[q.id] === oi;
            return (
              <button
                key={oi}
                onClick={() => pick(oi)}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                  selected ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-sm' : 'border-slate-200 hover:border-teal-300 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <span className={`inline-flex w-6 h-6 rounded-full items-center justify-center text-[10px] font-black mr-2 ${selected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  {['A', 'B', 'C', 'D'][oi]}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Nav */}
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 flex items-center gap-1.5">
          <ChevronLeft size={14} /> Prev
        </button>
        {idx < quiz.questions.length - 1 ? (
          <button onClick={() => setIdx(i => Math.min(quiz.questions.length - 1, i + 1))} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5">
            Next <ChevronRight size={14} />
          </button>
        ) : (
          <button
            onClick={() => finish(answers)}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5 shadow-lg shadow-teal-200"
          >
            <Send size={13} /> Submit Quiz
          </button>
        )}
      </div>
      <button onClick={() => { if (window.confirm('Quiz cancel karna hai? Progress save nahi hoga.')) onCancel(); }} className="w-full text-center text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-500 transition-colors">
        Cancel & Exit
      </button>
    </div>
  );
}

// ============================================================
// MANAGER VIEW — builder + list + results (teacher/principal)
// ============================================================
function ManagerQuizView({ userSession, students, classes }: QuizModuleProps) {
  const { items: quizzes, upsert, remove } = usePortalCollection<Quiz>('acadamis_quizzes', PORTAL_TABLES.quizzes);
  const { items: attempts, remove: removeAttempt } = usePortalCollection<QuizAttempt>('acadamis_quiz_attempts', PORTAL_TABLES.quizAttempts);

  const [showBuilder, setShowBuilder] = useState(false);
  const [resultsQuizId, setResultsQuizId] = useState<string | null>(null);

  const myQuizzes = useMemo(() => {
    const list = userSession.role === 'teacher'
      ? quizzes.filter(q => String(q.teacherId) === String(userSession.id))
      : quizzes;
    return list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [quizzes, userSession]);

  const quizResults = useMemo(() => {
    if (!resultsQuizId) return null;
    const quiz = quizzes.find(q => q.id === resultsQuizId) || null;
    const list = attempts
      .filter(a => a.quizId === resultsQuizId)
      .sort((a, b) => (b.score / Math.max(1, b.totalMarks)) - (a.score / Math.max(1, a.totalMarks)));
    return { quiz, list };
  }, [resultsQuizId, quizzes, attempts]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <ClipboardList size={22} className="text-teal-600" /> Online Quizzes
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">MCQ tests banayein · AI se generate karein · auto-grading</p>
        </div>
        <button onClick={() => setShowBuilder(v => !v)} className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-teal-200 transition-all flex items-center gap-2">
          <Plus size={15} /> New Quiz
        </button>
      </div>

      {showBuilder && (
        <QuizBuilder
          userSession={userSession}
          classes={classes}
          onSave={(quiz, publish) => {
            upsert({ ...quiz, status: publish ? 'published' : 'draft' });
            setShowBuilder(false);
            toast.success(publish ? 'Quiz publish ho gaya — students ko dikhega! 🚀' : 'Quiz draft save ho gaya');
          }}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {/* Results panel */}
      {resultsQuizId && quizResults?.quiz && (
        <QuizResultsPanel quiz={quizResults.quiz} list={quizResults.list} onClose={() => setResultsQuizId(null)} />
      )}

      {/* Quizzes list */}
      <div className="space-y-3">
        {myQuizzes.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
            Koi quiz nahi — "New Quiz" se shuru karein
          </div>
        )}
        {myQuizzes.map(q => {
          const qAttempts = attempts.filter(a => a.quizId === q.id);
          const avg = qAttempts.length > 0 ? Math.round(qAttempts.reduce((s, a) => s + (a.score / Math.max(1, a.totalMarks)) * 100, 0) / qAttempts.length) : null;
          return (
            <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center gap-3">
              <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${q.status === 'published' ? 'bg-teal-50 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>
                <ClipboardList size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-slate-900 text-sm truncate">{q.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${q.status === 'published' ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                    {q.status}
                  </span>
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  {q.subject} · {q.questions.length} Qs · {q.totalMarks} mk · {q.className || 'All Classes'} · {qAttempts.length} attempts{avg !== null ? ` · avg ${avg}%` : ''}
                </p>
              </div>
              <button onClick={() => setResultsQuizId(q.id)} className="shrink-0 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest">
                Results
              </button>
              <button
                onClick={() => {
                  const next = q.status === 'published' ? 'draft' : 'published';
                  upsert({ ...q, status: next });
                  toast.success(next === 'published' ? 'Quiz publish ho gaya 🚀' : 'Quiz draft mein wapas');
                }}
                className="shrink-0 px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest"
              >
                {q.status === 'published' ? 'Unpublish' : 'Publish'}
              </button>
              <button
                onClick={() => {
                  if (!window.confirm(`"${q.title}" delete karna hai? Iske attempts bhi delete honge.`)) return;
                  remove(q.id);
                  attempts.filter(a => a.quizId === q.id).forEach(a => removeAttempt(a.id));
                  if (resultsQuizId === q.id) setResultsQuizId(null);
                  toast.success('Quiz delete ho gaya');
                }}
                className="shrink-0 p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// QUIZ BUILDER — manual questions + AI MCQ generation
// ============================================================
function QuizBuilder({
  userSession, classes, onSave, onCancel,
}: {
  userSession: UserSession;
  classes: Class[];
  onSave: (quiz: Quiz, publish: boolean) => void;
  onCancel: () => void;
}) {
  const teacher = userSession.role === 'teacher';
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [classId, setClassId] = useState('all');
  const [timeLimitMin, setTimeLimitMin] = useState(10);
  const [dueDate, setDueDate] = useState('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);

  // AI generation inputs
  const [aiSource, setAiSource] = useState('');
  const [aiCount, setAiCount] = useState(5);
  const [aiMarks, setAiMarks] = useState(1);
  const [aiDifficulty, setAiDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [aiLoading, setAiLoading] = useState(false);
  const aiOn = isAiEnabled();

  const totalMarks = questions.reduce((a, q) => a + q.marks, 0);

  const addBlank = () => {
    setQuestions(prev => [...prev, { id: newId('q'), question: '', options: ['', '', '', ''], correctIndex: 0, marks: 1 }]);
  };

  const updateQ = (id: string, patch: Partial<QuizQuestion>) => {
    setQuestions(prev => prev.map(q => (q.id === id ? { ...q, ...patch } : q)));
  };

  const handleAiGenerate = async () => {
    if (!aiSource.trim()) {
      toast.error('Pehle chapter/lesson ka text paste karein');
      return;
    }
    setAiLoading(true);
    try {
      const source: PaperSource = { text: aiSource };
      const gen = await aiGenerateMcqs(source, subject || 'General', aiCount, aiMarks, aiDifficulty);
      const mapped: QuizQuestion[] = gen.map(g => ({
        id: newId('q'),
        question: g.question,
        options: g.options || [],
        correctIndex: g.correctIndex ?? 0,
        marks: g.marks,
      }));
      setQuestions(prev => [...prev, ...mapped]);
      toast.success(`${mapped.length} AI MCQs add ho gaye! 🤖`);
    } catch (e: any) {
      toast.error(e?.message || 'AI generation fail hui');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = (publish: boolean) => {
    if (!title.trim()) { toast.error('Quiz ka title likhein'); return; }
    const valid = questions.filter(q => q.question.trim() && q.options.filter(o => o.trim()).length >= 2);
    if (valid.length === 0) { toast.error('Kam az kam 1 complete question (question + 2 options) chahiye'); return; }
    const cls = classes.find(c => c.id === classId);
    onSave({
      id: newId('quiz'),
      title: title.trim(),
      subject: subject.trim() || 'General',
      classId,
      className: cls ? `${cls.className} ${cls.section}` : undefined,
      teacherId: String(userSession.id),
      teacherName: userSession.name || 'Teacher',
      timeLimitMin: Math.max(1, Number(timeLimitMin) || 10),
      totalMarks: valid.reduce((a, q) => a + q.marks, 0),
      questions: valid,
      status: 'draft',
      dueDate: dueDate || undefined,
      createdAt: new Date().toISOString(),
    }, publish);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-white border-2 border-teal-200 rounded-2xl p-5 shadow-lg space-y-4">
      <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Create Quiz</h3>

      {/* Meta */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Quiz title" className="col-span-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-teal-500" />
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder={teacher ? 'Subject' : 'Subject (e.g. Math)'} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" />
        <select value={classId} onChange={e => setClassId(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
          <option value="all">All Classes</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.className} {c.section}</option>)}
        </select>
        <div className="flex gap-2">
          <input type="number" min={1} value={timeLimitMin} onChange={e => setTimeLimitMin(Number(e.target.value))} placeholder="Min" className="w-1/2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" title="Time limit (minutes)" />
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-1/2 px-2 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-bold" title="Due date (optional)" />
        </div>
      </div>

      {/* AI MCQ Generator */}
      <div className="bg-gradient-to-r from-indigo-50 to-teal-50 border border-indigo-100 rounded-xl p-4 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles size={14} className="text-indigo-600" />
          <h4 className="text-[11px] font-black uppercase tracking-widest text-indigo-700">AI se MCQs generate karo</h4>
          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${aiOn ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-500'}`}>
            {aiOn ? 'AI Ready' : 'AI Off (API key nahi)'}
          </span>
        </div>
        <textarea
          value={aiSource}
          onChange={e => setAiSource(e.target.value)}
          placeholder="Book chapter / lesson ka text paste karein — AI isi se MCQs banayega..."
          rows={2}
          disabled={!aiOn}
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-400 disabled:opacity-50"
        />
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Count:</label>
          <input type="number" min={1} max={15} value={aiCount} onChange={e => setAiCount(Math.max(1, Math.min(15, Number(e.target.value))))} disabled={!aiOn} className="w-16 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold" />
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Marks/Q:</label>
          <input type="number" min={1} value={aiMarks} onChange={e => setAiMarks(Math.max(1, Number(e.target.value)))} disabled={!aiOn} className="w-16 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold" />
          <select value={aiDifficulty} onChange={e => setAiDifficulty(e.target.value as any)} disabled={!aiOn} className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <button
            onClick={handleAiGenerate}
            disabled={!aiOn || aiLoading}
            className="ml-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
          >
            {aiLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {aiLoading ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Questions editor */}
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {questions.length === 0 && (
          <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest py-4">Koi question nahi — manually add karein ya AI se generate karein</p>
        )}
        {questions.map((q, qi) => (
          <div key={q.id} className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[10px] font-black flex items-center justify-center shrink-0">{qi + 1}</span>
              <input
                value={q.question}
                onChange={e => updateQ(q.id, { question: e.target.value })}
                placeholder={`Question ${qi + 1}`}
                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:border-teal-500"
              />
              <input
                type="number" min={1}
                value={q.marks}
                onChange={e => updateQ(q.id, { marks: Math.max(1, Number(e.target.value) || 1) })}
                className="w-14 px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                title="Marks"
              />
              <button onClick={() => setQuestions(prev => prev.filter(x => x.id !== q.id))} className="p-1.5 text-slate-300 hover:text-rose-600 rounded-lg"><Trash2 size={13} /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateQ(q.id, { correctIndex: oi })}
                    className={`w-5 h-5 rounded-full shrink-0 text-[9px] font-black flex items-center justify-center border ${q.correctIndex === oi ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-300 text-slate-400 hover:border-teal-400'}`}
                    title="Correct answer set karein"
                  >
                    ✓
                  </button>
                  <input
                    value={opt}
                    onChange={e => {
                      const options = q.options.slice();
                      options[oi] = e.target.value;
                      updateQ(q.id, { options });
                    }}
                    placeholder={`Option ${['A', 'B', 'C', 'D'][oi]}`}
                    className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 items-center border-t border-slate-100 pt-3">
        <button onClick={addBlank} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
          <Plus size={13} /> Add Question
        </button>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">{questions.length} Qs · {totalMarks} marks</span>
        <div className="ml-auto flex gap-2">
          <button onClick={onCancel} className="px-4 py-2 bg-white border border-slate-200 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={() => handleSave(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Save Draft</button>
          <button onClick={() => handleSave(true)} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">Publish</button>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// QUIZ RESULTS PANEL — attempts ranking
// ============================================================
function QuizResultsPanel({ quiz, list, onClose }: { quiz: Quiz; list: QuizAttempt[]; onClose: () => void }) {
  const avg = list.length > 0 ? Math.round(list.reduce((s, a) => s + (a.score / Math.max(1, a.totalMarks)) * 100, 0) / list.length) : 0;
  const passCount = list.filter(a => (a.score / Math.max(1, a.totalMarks)) * 100 >= 40).length;
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-white border-2 border-amber-200 rounded-2xl shadow-lg overflow-hidden">
      <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2"><Trophy size={15} className="text-amber-600" /> Results — {quiz.title}</h3>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
            {list.length} attempts · Avg {avg}% · Pass {passCount}/{list.length}
          </p>
        </div>
        <button onClick={onClose} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-500">Close</button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {list.length === 0 ? (
          <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest py-8">Abhi kisi student ne attempt nahi kiya</p>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                {['Rank', 'Student', 'Score', '%', 'Submitted'].map(h => (
                  <th key={h} className="px-4 py-2 text-[9px] font-black text-slate-500 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((a, i) => {
                const pct = Math.round((a.score / Math.max(1, a.totalMarks)) * 100);
                return (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-xs font-black text-slate-700">{['🥇', '🥈', '🥉'][i] || `#${i + 1}`}</td>
                    <td className="px-4 py-2 text-xs font-bold text-slate-800">{a.studentName}</td>
                    <td className="px-4 py-2 text-xs font-bold text-slate-600 tabular-nums">{a.score}/{a.totalMarks}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${pct >= 40 ? 'bg-teal-100 text-teal-700' : 'bg-rose-100 text-rose-700'}`}>{pct}%</span>
                    </td>
                    <td className="px-4 py-2 text-[10px] font-bold text-slate-400">{new Date(a.submittedAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </motion.div>
  );
}




