/**
 * SUPABASE CLIENT — primary cloud backend (replaces Firebase).
 *
 * - URL + publishable key browser-safe hain (Firebase anon key ki tarah).
 * - Data security ke liye RLS policies use hoti hain (policies all-access —
 *   current public-app behavior; production mein tighten ki jayengi).
 * - secret key (sb_secret_...) KABHI browser bundle mein daali gayi nahi —
 *   wo sirf scripts/.env mein rehta hai (migration, admin tasks).
 *
 * DEMO MODE (VITE_DATA_MODE=demo):
 *   App abhi FULLY LOCAL hai — client initialize hota hai magar koi network
 *   call nahi hoti (sab gating lib/supabaseSync.ts mein hai). Jab aap nayi
 *   API/backend bhejenge to sirf .env mein VITE_DATA_MODE hatana/wapis
 *   "live" karna hai aur yeh adapter naye endpoint par point kar dena hai.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '';

/** Demo mode = sab kuch localStorage par; koi cloud/network request nahi. */
export const isDemoMode = (): boolean => (import.meta.env.VITE_DATA_MODE as string) === 'demo';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: { eventsPerSecond: 20 },
  },
});

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Connection/health check — headless liye chhota select karta hai. */
export async function testSupabaseConnection(): Promise<boolean> {
  if (isDemoMode()) {
    console.warn('[Demo] Cloud connection off — app local mode (VITE_DATA_MODE=demo).');
    return false;
  }
  if (!isSupabaseConfigured()) {
    console.warn('Supabase keys not configured in .env');
    return false;
  }
  try {
    const { data, error } = await supabase.from('students').select('id').limit(1);
    if (error) {
      if ((error as any)?.code === 'PGRST205') {
        console.warn('[Supabase] tables missing — SQL Editor mein scripts/supabase-schema.sql chalayein.');
      }
      throw error;
    }
    return true;
  } catch (e: any) {
    console.warn('[Supabase] connection test failed:', e?.message);
    return false;
  }
}