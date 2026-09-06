// Creates the principal/cloud-register user in Supabase Auth (secret key based, admins).
// Run: node scripts/create-supabase-auth-user.cjs
require('dotenv').config();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const EMAIL = process.env.SUPABASE_ADMIN_EMAIL || 'ali@nsb1.com';
const PASSWORD = process.env.SUPABASE_ADMIN_PASSWORD || '111222';

(async () => {
  if (!url || !key) { console.error('Missing VITE_SUPABASE_URL / SUPABASE_SECRET_KEY'); process.exit(1); }

  // Check existing
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=100`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const users = await list.json();
  const existing = (users.users || []).find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
  if (existing) {
    console.log('Principal user already exists:', existing.email, '| id:', existing.id);
    return;
  }

  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const body = await res.json();
  if (res.ok) {
    console.log('Principal auth user created:', body.email, '| id:', body.id);
  } else {
    console.error('Create failed:', res.status, JSON.stringify(body));
    process.exit(1);
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });