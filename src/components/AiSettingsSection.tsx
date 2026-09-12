import { useState } from 'react';
import { toast } from 'sonner';
import { Key, Eye, EyeOff, Sparkles, Save, Trash2, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { isAiEnabled, getGeminiApiKey, setGeminiApiKey, clearGeminiApiKey, testAiConnection, aiModelName } from '../lib/gemini';

/**
 * AI (Gemini) API Key — Settings section.
 * Principal/Teacher Settings tab mein se enter karke save kiya ja sakta hai.
 * Key sirf is browser ke localStorage mein rehti hai (demo mode = local).
 * Save/Test karne ke baad AI Paper Generator, MCQ Generator aur Student
 * Remarks features real Gemini API se chalte hain.
 */
export default function AiSettingsSection() {
  const [key, setKey] = useState<string>(() => getGeminiApiKey());
  const [showKey, setShowKey] = useState(false);
  const [aiOn, setAiOn] = useState<boolean>(() => isAiEnabled());
  const [testing, setTesting] = useState(false);

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      toast.error('Pehle API key paste karein — aistudio.google.com se free mein milti hai.');
      return;
    }
    try {
      setGeminiApiKey(trimmed);
      setAiOn(true);
      toast.success('✅ Gemini API key saved! AI features ab enabled hain.');
    } catch (err) {
      toast.error('Key save nahi hui — localStorage block ho sakta hai.');
    }
  };

  const handleClear = () => {
    setKey('');
    setShowKey(false);
    clearGeminiApiKey();
    setAiOn(isAiEnabled());
    toast.success('API key remove kar di gayi. AI features ab disabled hain.');
  };

  const handleTest = async () => {
    if (!key.trim()) {
      toast.error('Pehle API key paste karein (Save karne ki zaroorat nahi).');
      return;
    }
    setTesting(true);
    try {
      // Test saved key ke saath chalta hai; pehle save bhi kar dete hain.
      setGeminiApiKey(key.trim());
      setAiOn(true);
      const ok = await testAiConnection();
      if (ok) toast.success('✅ AI connection OK — key valid hai! Features ready hain.');
      else toast.error('⚠️ AI ne koi response nahi diya — key/model check karein.');
    } catch (err: any) {
      toast.error(`❌ AI test failed: ${err?.message || 'Invalid key ya network issue'}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="relative overflow-hidden bg-white dark:bg-slate-800/90 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm border-t-4 border-t-teal-500">
      {/* Decorative glows */}
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full bg-gradient-to-br from-teal-500/15 to-emerald-500/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 w-32 h-32 rounded-full bg-violet-500/5 blur-2xl" />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative p-3 bg-gradient-to-br from-teal-500 via-emerald-500 to-emerald-600 rounded-xl text-white shadow-lg shadow-teal-200 ring-4 ring-teal-500/15">
            <Sparkles size={22} />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase text-slate-800 dark:text-slate-100 flex items-center gap-2">
              AI (Gemini) — API Key &amp; Features
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Settings se AI key enter karein — .env edit karne ki zaroorat nahi.</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest w-fit ${
            aiOn ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-1 ring-teal-500/20' : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 ring-1 ring-slate-400/20'
          }`}
        >
          {aiOn ? (
            <><CheckCircle2 size={13} /> AI Ready — {aiModelName()}</>
          ) : (
            <><XCircle size={13} /> AI Off — key add karein</>
          )}
        </span>
      </div>

      {/* Features list */}
      <div className="mt-4 flex flex-wrap gap-2">
        {['AI Paper Generator 📄', 'MCQ / Quiz Generator 🧠', 'Student Remarks ✍️'].map((f) => (
          <span
            key={f}
            className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
              aiOn ? 'bg-teal-50 dark:bg-teal-500/10 border-teal-200 dark:border-teal-500/20 text-teal-700 dark:text-teal-300' : 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600 text-slate-400 dark:text-slate-500'
            }`}
          >
            {f}
          </span>
        ))}
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="mt-4 space-y-3">
        <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-1">
          AI Model &amp; Key
        </label>
        <div className="flex items-stretch gap-0.5">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300">
              <Key size={15} />
            </span>
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your AIza... Gemini API key"
              autoComplete="off"
              spellCheck={false}
              className="w-full pl-9 pr-11 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-500 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 dark:focus:ring-teal-400/30"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? 'Hide key' : 'Show key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-teal-600"
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          <button
            type="submit"
            className="ml-1.5 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shadow-lg shadow-teal-200/60 hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <Save size={13} /> Save &amp; Enable
          </button>
          {key.trim() && (
            <button
              type="button"
              onClick={handleClear}
              title="Remove key"
              className="ml-1.5 px-3 py-2.5 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl border border-rose-200 dark:border-rose-500/20 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>

        {/* Test Connection */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !key.trim()}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors ${
              testing || !key.trim()
                ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 cursor-not-allowed'
                : 'bg-teal-50 dark:bg-teal-500/10 hover:bg-teal-100 dark:hover:bg-teal-500/20 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-500/20'
            }`}
          >
            <Zap size={13} className={testing ? 'animate-pulse' : ''} />
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
      </form>

      {/* Security Note */}
      <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
        <p className="font-bold uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
          <Key size={11} /> Security Note
        </p>
        Key sirf <strong>is browser ke localStorage</strong> mein hoti hai (cloud/Supabase sync <strong>nahi</strong> hoti).
        Save karne ke baad <strong>AI Paper Generator</strong>, <strong>MCQ Generator</strong> aur <strong>Student Remarks</strong> — teeno features isi waqt enabled ho jate hain. Koi feature "AI Off" dikhe to Settings tab kholein aur key enter karein.
      </div>
    </div>
  );
}