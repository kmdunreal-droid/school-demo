/**
 * SUPABASE CLIENT — primary cloud backend (replaces Firebase).
 *
 * - URL + publishable key browser-safe hain (Firebase anon key ki tarah).
 * - Data security ke liye RLS policies use hoti hain (policies all-access —
 *   current public-app behavior; production mein tighten ki jayengi).
 * - secret key (sb_secret_...) KABHI browser bundle mein daali gayi nahi —
 *   wo sirf scripts/.env mein rehta hai (migration, admin tasks).
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || '';
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) || '';

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
  if (!isSupabaseConfigured()) {
    console.warn('Supabase keys not configured in .env');
    return false;
  }
  try {
    const { data, error } = await supabase.from('records').select('collection_name').limit(1);
    if (error) {
      if ((error as any)?.code === 'PGRST205') {
        console.warn('[Supabase] `records` table missing — SQL Editor mein scripts/supabase-schema.sql chalayein.');
      }
      throw error;
    }
    return true;
  } catch (e: any) {
    console.warn('[Supabase] connection test failed:', e?.message);
    return false;
  }
}