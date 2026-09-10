/**
 * SUPABASE KEEP-ALIVE PING
 * ------------------------------------------------
 * Muqsad: Supabase free project ko "pause" hone se bachana.
 * Supabase free tier kisi project ko ~1 week inactivity ke baad pause
 * kar deta hai. Yeh script roz/weekly chhota REST ping karta hai taake
 * project active rahe.
 *
 * Use:
 *   npm run keepalive            // ek baar ping (dist/log printing ke saath)
 *   npm run keepalive:watch      // --watch: har 6 ghante auto-ping (Ctrl+C tak)
 *
 * Windows Task Scheduler (har hafta auto chalane ke liye):
 *   1) Win+R → "taskchd.msc" → "Create Basic Task..."
 *   2) Name: "NSB1 Supabase Keepalive"
 *   3) Trigger: "Weekly" → koi bhi din, time choose karein
 *   4) Action: "Start a program"
 *      Program:  C:\Program Files\nodejs\node.exe
 *      Arguments: "d:\app\school app demo\scripts\supabase-keepalive.cjs"
 *      Start in: "d:\app\school app demo"
 *   5) OK — har hafte khud chalega 👍
 */
require('dotenv').config();

const URL = process.env.VITE_SUPABASE_URL || 'https://ezggmokzscashorchsdw.supabase.co';
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

const IS_WATCH = process.argv.includes('--watch');
const INTERVAL_MIN = 6 * 60; // 6 ghante
const PING_ENDPOINTS = [
  { name: 'postgrest root', url: `${URL}/rest/v1/` },
  { name: 'auth health', url: `${URL}/auth/v1/health` },
];

function fmt(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function pingOnce() {
  const started = Date.now();
  const results = [];
  for (const ep of PING_ENDPOINTS) {
    try {
      const headers = KEY ? { apikey: KEY, Authorization: `Bearer ${KEY}` } : {};
      const r = await Promise.race([
        fetch(ep.url, { headers, method: 'GET' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10000)),
      ]);
      const ok = r.status >= 200 && r.status < 500; // 4xx = bhapa hua matlab server awake hai
      results.push(`${ep.name}: HTTP ${r.status} ${ok ? 'OK' : '(eno fine — server alive)'}`);
    } catch (e) {
      results.push(`${ep.name}: ERROR ${e.message} — network thoda check karein (retry aage hoga)`);
    }
  }
  const elapsed = fmt(Date.now() - started);
  const line = `[${new Date().toLocaleString()}] ${results.join(' | ')} | took ${elapsed}`;
  console.log(line);
  try { require('fs').appendFileSync(require('path').join(__dirname, '..', 'keepalive.log'), line + '\n'); }
  catch { /* log optional */ }
  return results;
}

(async () => {
  console.log(`Supabase keepalive — ${URL}`);
  console.log('Demo mode ping (project ko wake/pause se bachata hai).');
  await pingOnce();
  if (!IS_WATCH) return;
  console.log(`Watch mode ON — har ${INTERVAL_MIN / 60} ghante ping hoga (Ctrl+C band karne ke liye).`);
  setInterval(async () => { await pingOnce(); }, INTERVAL_MIN * 60 * 1000);
})();