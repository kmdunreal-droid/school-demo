// Migrates all data from the Neon `records` table into Supabase `records` table.
// Pehle scripts/supabase-schema.sql Supabase SQL Editor mein run karein.
// Run: node scripts/migrate-neon-to-supabase.cjs
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const NEON_CONNECTION = process.env.NEON_CONNECTION ||
  'postgresql://neondb_owner:npg_uHRTvXQ2f4zJ@ep-misty-sky-aybucjjd-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';
const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

const KNOWN_TABLES = ['students', 'teachers', 'classes', 'timetable', 'attendance', 'marks', 'fees', 'fee_data', 'coordinators', 'assignments', 'app_settings'];

(async () => {
  if (!SB_URL || !SB_KEY) { console.error('Missing VITE_SUPABASE_URL / SUPABASE_SECRET_KEY in .env'); process.exit(1); }

  const sql = neon(NEON_CONNECTION);
  const rows = await sql`select collection_name, record_id, data from records order by collection_name, record_id`;
  console.log('Neon rows to migrate:', rows.length);

  const CHUNK = 100;
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      collection_name: r.collection_name,
      record_id: String(r.record_id),
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    }));
    const res = await fetch(`${SB_URL}/rest/v1/records?on_conflict=collection_name%2Crecord_id`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      console.error('upsert FAIL (records)', res.status, errText);
      if (errText.includes('PGRST205') || res.status === 404) {
        console.error('\nPlease run scripts/supabase-schema.sql in the Supabase SQL Editor first, then retry.');
      }
      process.exit(1);
    }

    // Per-table upserts (Firestore-style tables: students, fees, ...)
    const perTable = {};
    for (const r of chunk) {
      if (KNOWN_TABLES.includes(r.collection_name)) {
        if (!perTable[r.collection_name]) perTable[r.collection_name] = [];
        perTable[r.collection_name].push({ id: r.record_id, data: r.data });
      }
    }
    for (const [table, rows] of Object.entries(perTable)) {
      const res2 = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      });
      if (!res2.ok) {
        const errText = (await res2.text()).slice(0, 300);
        console.error(`upsert FAIL (${table})`, res2.status, errText);
        if (errText.includes('PGRST205') || res2.status === 404) {
          console.error(`\nTable "${table}" missing — run scripts/supabase-schema.sql in the Supabase SQL Editor first, then retry.`);
        }
        process.exit(1);
      }
    }
    total += chunk.length;
    console.log('upserted', total, '/', rows.length);
  }

  // Verify — per-table counts
  const v = await fetch(`${SB_URL}/rest/v1/records?select=collection_name,record_id`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: '0-9999' },
  });
  const vd = await v.json();
  const byCol = {};
  (vd || []).forEach((r) => { byCol[r.collection_name] = (byCol[r.collection_name] || 0) + 1; });
  console.log('Supabase rows (records):', (vd || []).length, JSON.stringify(byCol));

  for (const t of KNOWN_TABLES) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/${t}?select=id`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Range: '0-0' },
      });
      const cr = r.headers.get('content-range'); // e.g. "0-0/243"
      const count = cr ? cr.split('/')[1] : '?';
      console.log(`Supabase table "${t}": ${count} rows`);
    } catch (e) { console.log(`"${t}" count ERR:`, e.message); }
  }
  console.log('DONE — app ab Supabase (per-table) se chalti hai.');
})().catch((e) => { console.error('ERR', e && e.message || e); process.exit(1); });