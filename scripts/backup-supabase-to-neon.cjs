// BACKUP: Supabase (primary) → Neon `records` table (fresh mirror)
// App ab sirf Supabase par chalti hai — yeh script Neon ke backup ko
// Supabase ke current data ke barabar laati hai (upsert + stale delete).
//
// Run:  node scripts/backup-supabase-to-neon.cjs
// Kabhi bhi chala dein (e.g. hafte-war) — idempotent hai, dobara chalana safe.
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const NEON_CONNECTION = process.env.NEON_CONNECTION ||
  'postgresql://neondb_owner:npg_uHRTvXQ2f4zJ@ep-misty-sky-aybucjjd-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';
const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

const TABLES = ['students', 'teachers', 'classes', 'timetable', 'attendance', 'marks', 'fees', 'fee_data', 'coordinators', 'assignments', 'app_settings'];

if (!SB_URL || !SB_KEY) { console.error('Missing VITE_SUPABASE_URL / SUPABASE_SECRET_KEY in .env'); process.exit(1); }

async function fetchAll(table) {
  let out = [], offset = 0;
  while (true) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?select=id,data`, {
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        Range: `${offset}-${offset + 999}`,
      },
    });
    if (!res.ok) throw new Error(`${table} read FAIL ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return out;
}

(async () => {
  const sql = neon(NEON_CONNECTION);
  console.log('=== SUPABASE → NEON BACKUP START ===');
  const supaIdsByCol = {};
  let grand = 0;

  for (const table of TABLES) {
    // 1) Supabase se poora collection (paginated)
    const rows = await fetchAll(table);
    const recs = rows.map(r => ({ collection_name: table, record_id: String(r.id), data: r.data === undefined ? null : r.data }));
    supaIdsByCol[table] = new Set(recs.map(r => r.record_id));

    // 2) Neon mein upsert (chunks of 100 → 300 params per query)
    for (let i = 0; i < recs.length; i += 100) {
      const chunk = recs.slice(i, i + 100);
      const vals = [];
      const params = [];
      chunk.forEach((r, j) => {
        const b = j * 3;
        vals.push(`($${b + 1}, $${b + 2}, $${b + 3}::jsonb)`);
        params.push(r.collection_name, r.record_id, JSON.stringify(r.data));
      });
      await sql.query(
        `INSERT INTO records (collection_name, record_id, data) VALUES ${vals.join(',')}
         ON CONFLICT (collection_name, record_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        params
      );
    }
    grand += recs.length;
    console.log(`${table}: ${recs.length} rows upserted`);

    // 3) Stale cleanup — Neon mein jo rows Supabase se delete ho chuki hain
    const neonRows = await sql`SELECT record_id FROM records WHERE collection_name = ${table}`;
    const stale = neonRows.map(x => x.record_id).filter(id => !supaIdsByCol[table].has(id));
    for (let i = 0; i < stale.length; i += 100) {
      const chunk = stale.slice(i, i + 100);
      await sql.query(`DELETE FROM records WHERE collection_name = $1 AND record_id = ANY($2::text[])`, [table, chunk]);
    }
    if (stale.length > 0) console.log(`${table}: ${stale.length} stale rows deleted from Neon`);
  }

  // 4) Verify — Neon counts
  const v = await sql`SELECT collection_name, COUNT(*)::int as c FROM records GROUP BY collection_name ORDER BY collection_name`;
  let total = 0;
  v.forEach(x => { total += x.c; console.log(`Neon ${x.collection_name}: ${x.c}`); });
  console.log(`Neon TOTAL: ${total} (Supabase se ${grand} rows mirror hue)`);
  console.log('=== BACKUP COMPLETE — Neon ab fresh hai ===');
})().catch(e => { console.error('BACKUP FAIL:', e.message || e); process.exit(1); });