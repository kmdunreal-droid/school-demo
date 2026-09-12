/**
 * GEMINI AI HELPER — paper generation, MCQs aur student remarks.
 *
 * Setup (free):
 *   1. https://aistudio.google.com → "Get API key" → copy karein
 *   2. .env mein: VITE_GEMINI_API_KEY="your_key"
 *   3. Bas — AI features auto-enable ho jayenge. Key na ho to features
 *      gracefully "disabled" dikhte hain, baqi app normal chalti hai.
 */
import { GoogleGenAI } from '@google/genai';
import { safeStorage } from './safeStorage';

const env: any = (import.meta as any).env || {};
const MODEL: string = String(env.VITE_GEMINI_MODEL || 'gemini-2.5-flash');

// ============================================================
// RUNTIME API KEY — Settings (Principal/Teacher) se enter karke
// yahan save hoti hai. Agar runtime key na ho to .env ka
// VITE_GEMINI_API_KEY / GEMINI_API_KEY fallback use hota hai.
// KEY SIRF IS BROWSER KE localStorage MEIN HAI — cloud sync NAHI.
// ============================================================
export const GEMINI_KEY_STORAGE = 'acadamis_gemini_api_key';

const envKey = (): string =>
  String(env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || '').trim();

export function getGeminiApiKey(): string {
  try {
    const saved = safeStorage.getItem(GEMINI_KEY_STORAGE) || '';
    if (saved && saved !== 'undefined' && saved !== 'null') return String(saved).trim();
  } catch (e) {
    /* ignore */
  }
  return envKey();
}

export function setGeminiApiKey(key: string): void {
  const trimmed = String(key || '').trim();
  if (trimmed) safeStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
  else safeStorage.removeItem(GEMINI_KEY_STORAGE);
  client = null; // client force-recreate — nayi key ke saath
}

export function clearGeminiApiKey(): void {
  safeStorage.removeItem(GEMINI_KEY_STORAGE);
  client = null;
}

export function isAiEnabled(): boolean {
  return getGeminiApiKey().length > 0;
}

export function aiModelName(): string {
  return MODEL;
}

let client: GoogleGenAI | null = null;
let clientKey: string = '';

function getClient(): GoogleGenAI {
  const key = getGeminiApiKey();
  if (!key) {
    throw new Error('AI disabled — Settings → "AI API Key" mein Google AI Studio se free key add karein (aistudio.google.com)');
  }
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key });
    clientKey = key;
  }
  return client;
}

/** Settings mein saved key ko verify karne ke liye minimal test call. */
export async function testAiConnection(): Promise<boolean> {
  const ai = getClient();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: 'Reply with exactly: OK',
    config: { maxOutputTokens: 8, temperature: 0 },
  } as any);
  return String((res as any).text || '').trim().length > 0;
}

/** JSON-mode request — structured output for papers/MCQs. */
async function aiJson<T>(systemInstruction: string, parts: any[]): Promise<T> {
  const ai = getClient();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
  } as any);
  const text = String((res as any).text || '').trim();
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new Error('AI ka jawab parse nahi hua — dobara try karein');
  }
}

/** Plain-text request — remarks waghera ke liye. */
async function aiText(systemInstruction: string, prompt: string): Promise<string> {
  const ai = getClient();
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { systemInstruction, temperature: 0.8 },
  } as any);
  return String((res as any).text || '').trim();
}

// ============================================================
// AI PAPER GENERATOR — books/se content se exam paper
// ============================================================
export interface GeneratedQuestion {
  question: string;
  type: 'mcq' | 'short' | 'long';
  marks: number;
  options?: string[];      // mcq only (4 options)
  correctIndex?: number;   // mcq only (0-3)
  answer?: string;         // short/long ka model answer
}

export interface GeneratedPaper {
  subject: string;
  className: string;
  totalMarks: number;
  durationMin: number;
  difficulty: string;
  questions: GeneratedQuestion[];
}

export interface PaperSource {
  text?: string;                            // pasted chapter text
  files?: { mimeType: string; data: string }[]; // base64 (no data: prefix) — images/pdf
}

export interface PaperConfig {
  subject: string;
  className: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  mcqCount: number;
  shortCount: number;
  longCount: number;
  mcqMarks: number;
  shortMarks: number;
  longMarks: number;
  durationMin: number;
}

const PAPER_SYSTEM = `You are an expert school exam paper designer. You design high-quality exam papers STRICTLY from the provided source content (book chapter text, scanned book pages, or images).
Rules:
- Every question MUST be answerable from the provided source material only.
- Never invent questions about topics not present in the source.
- Questions should test understanding, not just memory (but simple recall is OK for easy difficulty).
- Language: match the language of the source content (English/Urdu/mixed).
- MCQs: exactly 4 options, one correct.
- Return ONLY valid JSON, no markdown.`;

export async function aiGeneratePaper(source: PaperSource, cfg: PaperConfig): Promise<GeneratedPaper> {
  const parts: any[] = [];
  const counts = `Create an exam paper for ${cfg.className}, subject "${cfg.subject}".
Question plan:
- ${cfg.mcqCount} MCQ questions, ${cfg.mcqMarks} mark(s) each (type "mcq", include 4 options + correctIndex 0-3)
- ${cfg.shortCount} short questions, ${cfg.shortMarks} mark(s) each (type "short", include a brief model answer)
- ${cfg.longCount} long/detailed questions, ${cfg.longMarks} mark(s) each (type "long", include a model answer outline)
Difficulty: ${cfg.difficulty}. Duration: ${cfg.durationMin} minutes.
Total questions must match the plan exactly.`;

  if (source.text && source.text.trim()) {
    parts.push({ text: `${counts}\n\nSOURCE CONTENT (book chapter):\n"""\n${source.text.slice(0, 60000)}\n"""` });
  }
  (source.files || []).forEach(f => parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } }));
  if (parts.length === 0) throw new Error('Pehle chapter text paste karein ya book pages upload karein');
  if (source.text && source.text.trim() && (source.files || []).length > 0) {
    parts.unshift({ text: counts });
  }

  const out = await aiJson<{ questions: GeneratedQuestion[] }>(PAPER_SYSTEM, parts);
  const questions = (out.questions || []).map((q, i) => ({
    question: String(q.question || `Question ${i + 1}`),
    type: (['mcq', 'short', 'long'].includes(q.type) ? q.type : 'short') as GeneratedQuestion['type'],
    marks: Math.max(1, Number(q.marks) || 1),
    options: Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : undefined,
    correctIndex: Number.isInteger(q.correctIndex) ? Math.min(3, Math.max(0, q.correctIndex as number)) : undefined,
    answer: q.answer ? String(q.answer) : undefined,
  }));
  if (questions.length === 0) throw new Error('AI ne koi question generate nahi kiya — source content check karein');

  const totalMarks = questions.reduce((a, q) => a + q.marks, 0);
  return {
    subject: cfg.subject,
    className: cfg.className,
    totalMarks,
    durationMin: cfg.durationMin,
    difficulty: cfg.difficulty,
    questions,
  };
}

// ============================================================
// AI MCQ GENERATOR — quiz module ke liye
// ============================================================
export async function aiGenerateMcqs(
  source: PaperSource,
  subject: string,
  count: number,
  marksPerQ: number,
  difficulty: string
): Promise<GeneratedQuestion[]> {
  const parts: any[] = [];
  const ask = `Generate exactly ${count} multiple-choice questions (MCQs) for subject "${subject}" (difficulty: ${difficulty}) STRICTLY from the provided content. Each MCQ: exactly 4 options, one correct (correctIndex 0-3), ${marksPerQ} mark(s) each. Return JSON: { "questions": [ { "question", "type": "mcq", "marks", "options": [4 strings], "correctIndex" } ] }`;
  if (source.text && source.text.trim()) parts.push({ text: `${ask}\n\nCONTENT:\n"""\n${source.text.slice(0, 60000)}\n"""` });
  (source.files || []).forEach(f => parts.push({ inlineData: { mimeType: f.mimeType, data: f.data } }));
  if (parts.length === 0) throw new Error('Pehle content dein — text paste karein ya book pages upload karein');
  const out = await aiJson<{ questions: GeneratedQuestion[] }>(PAPER_SYSTEM, parts);
  const qs = (out.questions || [])
    .map((q, i) => ({
      question: String(q.question || `Question ${i + 1}`),
      type: 'mcq' as const,
      marks: Math.max(1, Number(q.marks) || marksPerQ),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : [],
      correctIndex: Number.isInteger(q.correctIndex) ? Math.min(3, Math.max(0, q.correctIndex as number)) : 0,
    }))
    .filter(q => q.options.length === 4);
  if (qs.length === 0) throw new Error('AI ne MCQs generate nahi kiye — content check karein');
  return qs;
}

// ============================================================
// AI STUDENT REMARKS — report card comments
// ============================================================
export interface RemarkInput {
  studentName: string;
  className: string;
  attendancePct: number;
  avgPct: number;
  bestSubject?: string;
  weakSubject?: string;
  tone: 'formal' | 'motivational' | 'concise';
}

export async function aiGenerateRemark(input: RemarkInput): Promise<string> {
  const prompt = `Student: ${input.studentName} (Class ${input.className})
Attendance: ${input.attendancePct}% | Average marks: ${input.avgPct}%
${input.bestSubject ? `Strongest subject: ${input.bestSubject}` : ''}${input.weakSubject ? ` | Needs improvement: ${input.weakSubject}` : ''}
Write ONE teacher's remark for the report card (2-3 sentences, ${input.tone} tone, encouraging but honest, school context: Pakistan). Reply with the remark text only — no quotes, no labels.`;
  return aiText(
    'You write concise, professional school report-card remarks for teachers. Match the tone requested. Keep it 2-3 sentences.',
    prompt
  );
}


