/**
 * AI PAPER GENERATOR — book ke chapter (text/photos/PDF) se exam paper design.
 * Gemini free API se generate → editable → print (A4) → MCQs quiz mein push.
 */
import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  FileText, Sparkles, Loader2, Printer, Trash2, Plus, Upload, ClipboardList, X, Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import { aiGeneratePaper, isAiEnabled, type GeneratedPaper, type GeneratedQuestion, type PaperSource } from '../lib/gemini';
import type { Quiz, QuizQuestion, UserSession, Class } from '../types';
import { usePortalCollection, newId, PORTAL_TABLES } from '../lib/portalStore';

interface AiPaperGeneratorProps {
  userSession: UserSession;
  classes: Class[];
}

interface SourceFile {
  name: string;
  mimeType: string;
  data: string; // base64 without prefix
}

export default function AiPaperGenerator({ userSession, classes }: AiPaperGeneratorProps) {
  const aiOn = isAiEnabled();
  const { upsert } = usePortalCollection<Quiz>('acadamis_quizzes', PORTAL_TABLES.quizzes);

  const [sourceText, setSourceText] = useState('');
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [subject, setSubject] = useState('');
  const [className, setClassName] = useState('all');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('mixed');
  const [mcqCount, setMcqCount] = useState(10);
  const [mcqMarks, setMcqMarks] = useState(1);
  const [shortCount, setShortCount] = useState(6);
  const [shortMarks, setShortMarks] = useState(5);
  const [longCount, setLongCount] = useState(2);
  const [longMarks, setLongMarks] = useState(10);
  const [durationMin, setDurationMin] = useState(120);
  const [loading, setLoading] = useState(false);
  const [paper, setPaper] = useState<GeneratedPaper | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraType, setCameraType] = useState<'front' | 'rear'>('rear');

  // ---- Camera capture ----
  const hasCamera = typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

  const openCamera = async () => {
    if (!hasCamera) {
      toast.error('Camera nahi mili — is device/ browser mein camera support nahi hai');
      return;
    }
    try {
      const facingMode = cameraType === 'front' ? 'user' : 'environment';
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOpen(true);
      toast.success(`Camera khul gaya (${cameraType === 'front' ? 'front' : 'rear'} lens)`);
    } catch (err) {
      console.error('Camera access error:', err);
      toast.error('Camera open nahi hui — permission check karein ya doosra device try karein');
    }
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const capturePhoto = () => {
    if (!videoRef.current || !videoRef.current.videoWidth) {
      toast.error('Camera frame ready nahi hai — ek second ruko aur try karein');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { toast.error('Canvas capture fail hua'); return; }
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64 = dataUrl.split(',')[1] || '';
    const fileObj: SourceFile = {
      name: `camera_${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      data: base64,
    };
    setFiles(prev => [...prev, fileObj].slice(0, 8));
    toast.success('Book page ki photo capture ho gayi — file list mein dikhegi');
    // Ek chhota blink feedback ke liye stream ko turant restart nahi karte
  };

  const clsLabel = classes.find(c => c.id === className);

  // ---- File reading (images/pdf/txt → base64/text) ----
  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const next: SourceFile[] = [];
    for (const f of Array.from(fileList)) {
      try {
        if (f.type === 'text/plain' || f.name.endsWith('.txt')) {
          const text = await f.text();
          setSourceText(prev => `${prev}\n\n${text}`.trim());
          toast.success(`${f.name} ka text add ho gaya`);
          continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = reject;
          reader.readAsDataURL(f);
        });
        const base64 = dataUrl.split(',')[1] || '';
        next.push({ name: f.name, mimeType: f.type || 'application/octet-stream', data: base64 });
      } catch {
        toast.error(`${f.name} read nahi hui`);
      }
    }
    if (next.length > 0) {
      setFiles(prev => [...prev, ...next].slice(0, 8));
      toast.success(`${next.length} file(s) upload ho gayi`);
    }
  };

  const generate = async () => {
    if (!sourceText.trim() && files.length === 0) {
      toast.error('Book ka content dein — text paste karein ya pages upload karein');
      return;
    }
    setLoading(true);
    try {
      const source: PaperSource = { text: sourceText, files };
      const result = await aiGeneratePaper(source, {
        subject: subject || 'General',
        className: clsLabel ? `${clsLabel.className} ${clsLabel.section}` : 'All Classes',
        difficulty,
        mcqCount, shortCount, longCount,
        mcqMarks, shortMarks, longMarks,
        durationMin,
      });
      setPaper(result);
      toast.success(`Paper ready! ${result.questions.length} questions · ${result.totalMarks} marks 🎉`);
    } catch (e: any) {
      toast.error(e?.message || 'AI paper generation fail hui');
    } finally {
      setLoading(false);
    }
  };

  const editQuestion = (i: number, patch: Partial<GeneratedQuestion>) => {
    if (!paper) return;
    const questions = paper.questions.slice();
    questions[i] = { ...questions[i], ...patch };
    setPaper({ ...paper, questions, totalMarks: questions.reduce((a, q) => a + q.marks, 0) });
  };

  const removeQuestion = (i: number) => {
    if (!paper) return;
    const questions = paper.questions.filter((_, x) => x !== i);
    setPaper({ ...paper, questions, totalMarks: questions.reduce((a, q) => a + q.marks, 0) });
  };

  const addQuestion = () => {
    if (!paper) return;
    setPaper({ ...paper, questions: [...paper.questions, { question: 'Naya question...', type: 'short', marks: 5, answer: '' }], totalMarks: paper.totalMarks + 5 });
  };

  // ---- Print A4 (print window — payslip/report jaisa pattern) ----
  const printPaper = () => {
    if (!paper) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let qi = 0;
    const sections: { label: string; type: 'mcq' | 'short' | 'long'; instruction: string }[] = [
      { label: 'Section A', type: 'mcq', instruction: 'Attempt all questions. Each has four options; choose the correct one.' },
      { label: 'Section B', type: 'short', instruction: 'Attempt all questions. Answers should be brief.' },
      { label: 'Section C', type: 'long', instruction: 'Attempt all questions. Give detailed answers.' },
    ];
    const sectionsHtml = sections.map(sec => {
      const qs = paper.questions.filter(q => q.type === sec.type);
      if (qs.length === 0) return '';
      const rows = qs.map(q => {
        qi++;
        if (q.type === 'mcq') {
          const opts = (q.options || []).map((o, oi) => `<div class="opt">${'abcd'[oi]}) ${esc(o)}</div>`).join('');
          return `<div class="q"><span class="qn">Q${qi}.</span> ${esc(q.question)} <span class="mk">(${q.marks})</span>${opts}</div>`;
        }
        return `<div class="q"><span class="qn">Q${qi}.</span> ${esc(q.question)} <span class="mk">(${q.marks})</span></div><div class="anslines"></div>`;
      }).join('');
      return `<div class="section">${sec.label} <span class="secnote">${sec.instruction}</span></div>${rows}`;
    }).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Exam Paper — ${esc(paper.subject)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 0; padding: 32px; }
  .head { text-align: center; border-bottom: 3px double #111; padding-bottom: 12px; margin-bottom: 16px; }
  .head img { height: 64px; }
  .school { font-size: 20px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; }
  .meta { display: flex; justify-content: space-between; font-size: 13px; margin-top: 10px; }
  .meta b { text-transform: uppercase; letter-spacing: 1px; }
  .section { background: #111; color: #fff; padding: 5px 12px; font-size: 13px; font-weight: bold; margin: 18px 0 8px; letter-spacing: 1px; }
  .secnote { font-weight: normal; font-size: 11px; font-style: italic; }
  .q { font-size: 13.5px; margin: 8px 0; line-height: 1.55; }
  .qn { font-weight: bold; }
  .mk { color: #555; font-size: 11px; }
  .opt { margin-left: 26px; font-size: 12.5px; }
  .anslines { margin-left: 26px; height: 42px; border-bottom: 1px dotted #999; margin-bottom: 4px; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="head">
  <img src="/logo.png" alt="logo" onerror="this.style.display='none'" />
  <div class="school">Demo School &amp; Academy</div>
  <div class="meta">
    <div><b>Class:</b> ${esc(paper.className)} &nbsp;|&nbsp; <b>Subject:</b> ${esc(paper.subject)}</div>
    <div><b>Time:</b> ${paper.durationMin} min &nbsp;|&nbsp; <b>Marks:</b> ${paper.totalMarks}</div>
  </div>
</div>
${sectionsHtml}
<div style="margin-top:24px; text-align:center; font-size:11px; color:#666;">— Good Luck —</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast.error('Popup block hai — allow karein'); return; }
    w.document.write(html);
    w.document.close();
  };

  // ---- Push MCQs to Quiz module ----
  const pushMcqsToQuiz = () => {
    if (!paper) return;
    const mcqs = paper.questions.filter(q => q.type === 'mcq' && q.options && q.options.length === 4);
    if (mcqs.length === 0) { toast.error('Is paper mein MCQs nahi hain'); return; }
    const questions: QuizQuestion[] = mcqs.map(q => ({
      id: newId('q'),
      question: q.question,
      options: q.options!,
      correctIndex: q.correctIndex ?? 0,
      marks: q.marks,
    }));
    upsert({
      id: newId('quiz'),
      title: `${paper.subject} — Auto Quiz (${new Date().toLocaleDateString()})`,
      subject: paper.subject,
      classId: className,
      className: clsLabel ? `${clsLabel.className} ${clsLabel.section}` : undefined,
      teacherId: String(userSession.id),
      teacherName: userSession.name || 'Teacher',
      timeLimitMin: Math.max(5, mcqs.length * 2),
      totalMarks: questions.reduce((a, q) => a + q.marks, 0),
      questions,
      status: 'draft',
      createdAt: new Date().toISOString(),
    });
    toast.success('MCQs Quiz module mein draft ban gaye — Quizzes tab se publish karein! 🚀');
  };


  return (
    <div className="space-y-6 animate-fade-in">
      <HeaderBlock aiOn={aiOn} />
      {/* ===== CONFIG + SOURCE ===== */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Source content */}
          <div className="space-y-2.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">1️⃣ Book Content</label>
            <textarea
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
              placeholder="Chapter ka text paste karein... (ya neeche book pages ki photos/PDF upload karein)"
              rows={6}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-teal-500"
            />
            <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,.txt" className="hidden" onChange={e => { handleFiles(e.target.files); e.currentTarget.value = ''; }} />
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                <Upload size={13} /> Upload Pages (Photo/PDF/TXT)
              </button>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Book ke pages ki saaf photo ya scanned PDF</span>
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <span key={i} className="px-2.5 py-1 bg-teal-50 border border-teal-200 text-teal-700 rounded-lg text-[10px] font-bold flex items-center gap-1.5">
                    📄 {f.name.slice(0, 24)}
                    <button onClick={() => setFiles(prev => prev.filter((_, x) => x !== i))} className="hover:text-rose-600"><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}



            {/* ===== CAMERA CAPTURE ===== */}
            {hasCamera && (
              <div className="mt-3 space-y-2.5">
                {!cameraOpen ? (
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      onClick={openCamera}
                      className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 border border-rose-200"
                    >
                      <Camera size={13} /> Open Camera
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Lens:</span>
                      <button
                        onClick={() => setCameraType('front')}
                        className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${cameraType === 'front' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                      >
                        Front
                      </button>
                      <button
                        onClick={() => setCameraType('rear')}
                        className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${cameraType === 'rear' ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                      >
                        Rear
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-300">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full max-h-64 object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex items-center justify-between gap-2">
                      <button
                        onClick={() => { closeCamera(); }}
                        className="px-3 py-1.5 bg-white/20 hover:bg-white/30 backdrop-blur text-white rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 border border-white/30"
                      >
                        <X size={12} /> Close Camera
                      </button>
                      <button
                        onClick={capturePhoto}
                        className="w-10 h-10 rounded-full border-4 border-white shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center"
                      >
                        <div className="w-5 h-5 bg-white rounded-full" />
                      </button>
                      <span className="text-white/80 text-[9px] font-bold uppercase tracking-widest bg-black/30 px-2 py-1 rounded">
                        {cameraType === 'front' ? 'Front' : 'Rear'} Lens
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Paper config */}
          <div className="space-y-2.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">2️⃣ Paper Settings</label>
            <div className="grid grid-cols-2 gap-2">
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (e.g. Physics)" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" />
              <select value={className} onChange={e => setClassName(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
                <option value="all">All Classes</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.className} {c.section}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'MCQs', count: mcqCount, setCount: setMcqCount, marks: mcqMarks, setMarks: setMcqMarks },
                { label: 'Short Qs', count: shortCount, setCount: setShortCount, marks: shortMarks, setMarks: setShortMarks },
                { label: 'Long Qs', count: longCount, setCount: setLongCount, marks: longMarks, setMarks: setLongMarks },
              ].map(s => (
                <div key={s.label} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{s.label}</p>
                  <div className="flex gap-1.5">
                    <input type="number" min={0} max={25} value={s.count} onChange={e => s.setCount(Math.max(0, Number(e.target.value)))} className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold" title="Count" />
                    <input type="number" min={1} value={s.marks} onChange={e => s.setMarks(Math.max(1, Number(e.target.value)))} className="w-full px-1.5 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold" title="Marks each" />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={difficulty} onChange={e => setDifficulty(e.target.value as any)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest">
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
                <option value="mixed">Mixed</option>
              </select>
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Time:</label>
                <input type="number" min={10} value={durationMin} onChange={e => setDurationMin(Math.max(10, Number(e.target.value)))} className="w-20 px-2 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold" />
                <span className="text-[10px] font-bold text-slate-400">min</span>
              </div>
            </div>
            <button
              onClick={generate}
              disabled={!aiOn || loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 transition-all"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {loading ? 'AI paper design kar raha hai...' : 'Generate Paper'}
            </button>
          </div>
        </div>
      </div>
      {/* ===== GENERATED PAPER PREVIEW (editable) ===== */}
      {paper && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white border-2 border-indigo-200 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 bg-indigo-50 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">📄 Generated Paper — Editable Preview</h3>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                {paper.className} · {paper.subject} · {paper.questions.length} Qs · {paper.totalMarks} marks · {paper.durationMin} min
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={addQuestion} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                <Plus size={12} /> Add Q
              </button>
              <button onClick={pushMcqsToQuiz} className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                <ClipboardList size={12} /> MCQs → Quiz
              </button>
              <button onClick={printPaper} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                <Printer size={13} /> Print / Save PDF
              </button>
            </div>
          </div>
          <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
            {paper.questions.map((q, i) => (
              <div key={i} className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest">{q.type}</span>
                  <input
                    value={q.question}
                    onChange={e => editQuestion(i, { question: e.target.value })}
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                  />
                  <input
                    type="number" min={1}
                    value={q.marks}
                    onChange={e => editQuestion(i, { marks: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-14 px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                  />
                  <button onClick={() => removeQuestion(i)} className="p-1.5 text-slate-300 hover:text-rose-600 rounded-lg"><Trash2 size={13} /></button>
                </div>
                {q.type === 'mcq' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-8">
                    {(q.options || []).map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-1.5">
                        <button
                          onClick={() => editQuestion(i, { correctIndex: oi })}
                          className={`w-5 h-5 rounded-full shrink-0 text-[9px] font-black flex items-center justify-center border ${q.correctIndex === oi ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-300 text-slate-400'}`}
                        >✓</button>
                        <input
                          value={opt}
                          onChange={e => {
                            const options = (q.options || []).slice();
                            options[oi] = e.target.value;
                            editQuestion(i, { options });
                          }}
                          className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {q.type !== 'mcq' && (
                  <textarea
                    value={q.answer || ''}
                    onChange={e => editQuestion(i, { answer: e.target.value })}
                    placeholder="Model answer / key points..."
                    rows={2}
                    className="ml-8 w-[calc(100%-2rem)] px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-600"
                  />
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function HeaderBlock({ aiOn }: { aiOn: boolean }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
          <FileText size={22} className="text-teal-600" /> AI Paper Generator
        </h1>
        <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Books ke chapter se exam paper — Gemini AI (free)</p>
      </div>
      <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest w-fit ${aiOn ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-500'}`}>
        {aiOn ? '🤖 AI Ready ✓' : '⚠️ AI Off — Settings → AI API Key add karein'}
      </span>
    </div>
  );
}
