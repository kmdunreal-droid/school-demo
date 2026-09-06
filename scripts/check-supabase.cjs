// Connectivity + schema check for the Supabase project (reads keys from root .env)
// Run: node scripts/check-supabase.cjs
require('dotenv').config();

const url = process.env.VITE_SUPABASE_URL;
const pub = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const sec = process.env.SUPABASE_SECRET_KEY;

(async () => {
  console.log('URL:', url);
  // 1) PostgREST root — lists existing tables in the OpenAPI spec
  try {
    const r = await fetch(url + '/rest/v1/', { headers: { apikey: pub, Authorization: 'Bearer ' + pub } });
    const t = await r.text();
    console.log('POSTGREST root status:', r.status);
    try {
      const j = JSON.parse(t);
      const schemas = j.components?.schemas || {};
      const tables = Object.keys(schemas).filter(k => !k.startsWith('['));
      console.log('existing tables:', tables.length ? tables.join(', ') : '(none listed)');
    } catch { console.log(t.slice(0, 300)); }
  } catch (e) { console.log('postgrest root ERR:', e.message); }

  // 2) Try reading per-collection tables with both keys
  for (const [label, key] of [['publishable', pub], ['secret', sec]]) {
    try {
      const r = await fetch(url + '/rest/v1/students?select=id&limit=3', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      console.log('students read [' + label + ']:', r.status, (await r.text()).slice(0, 160));
    } catch (e) { console.log('students [' + label + '] ERR:', e.message); }
  }

  // 3) Auth admin endpoint (secret key only)
  try {
    const r = await fetch(url + '/auth/v1/admin/users?per_page=1', { headers: { apikey: sec, Authorization: 'Bearer ' + sec } });
    console.log('auth admin:', r.status, (await r.text()).slice(0, 200));
  } catch (e) { console.log('auth admin ERR:', e.message); }
})();