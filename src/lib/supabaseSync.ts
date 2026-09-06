/**
 * SUPABASE SYNC LAYER — same `records` table ke saath:
 *
 *   records (
 *     collection_name text,
 *     record_id       text,
 *     data            jsonb,
 *     updated_at      timestamptz default now(),
 *     primary key (collection_name, record_id)
 *   )
 *
 * Yeh Neon ke `records` table jaisa hi hai — is liye Neon ki data seedhi
 * Supabase mein migrate ho sakti hai (scripts/migrate-neon-to-supabase.cjs).
 *
 * Cross-device sync NOW WebSocket realtime (postgres_changes) se hota hai —
 * koi polling/heartbeat/quota nahi.
 */
import { supabase } from '../supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

let supabaseHealthy = true;
let supabaseLastError: string | null = null;
export const isSupabaseHealthy = () => supabaseHealthy;
export const getSupabaseLastError = () => supabaseLastError;

// --- Queued writes (batched upsert on conflict) ---
const pendingSet: { col: string; id: string; data: any }[] = [];
const pendingDel: { col: string; id: string }[] = [];
let sbTimer: any = null;
let flushInFlight = false;

function scheduleFlush() {
  if (sbTimer) clearTimeout(sbTimer);
  sbTimer = setTimeout(() => { flushSupabase(); }, 900);
}

export function sbQueueWrite(col: string, id: string, data: any) {
  pendingSet.push({ col, id, data });
  scheduleFlush();
}

export function sbQueueDelete(col: string, id: string) {
  pendingDel.push({ col, id });
  scheduleFlush();
}

/** Pending queue ko foran flush karta hai. Success = true. Fail par data re-queue hota hai. */
export async function flushSupabase(): Promise<boolean> {
  if (flushInFlight) return true;
  if (pendingSet.length === 0 && pendingDel.length === 0) return true;
  flushInFlight = true;
  const sets = pendingSet.splice(0);
  const dels = pendingDel.splice(0);
  try {
    // Upserts — chunks (body size safe)
    for (let i = 0; i < sets.length; i += 100) {
      const chunk = sets.slice(i, i + 100);
      const body = chunk.map(({ col, id, data }) => ({
        collection_name: col,
        record_id: String(id),
        data: data === undefined ? null : data,
      }));
      const { error } = await supabase
        .from('records')
        .upsert(body, { onConflict: 'collection_name,record_id' });
      if (error) throw error;
    }
    for (const d of dels) {
      const { error } = await supabase
        .from('records')
        .delete()
        .eq('collection_name', d.col)
        .eq('record_id', String(d.id));
      if (error) throw error;
    }
    supabaseHealthy = true;
    supabaseLastError = null;
    return true;
  } catch (e: any) {
    supabaseHealthy = false;
    supabaseLastError = e?.message || 'Supabase write failed';
    console.warn('[Supabase] flush failed (data re-queued):', supabaseLastError);
    pendingSet.unshift(...sets);
    pendingDel.unshift(...dels);
    return false;
  } finally {
    flushInFlight = false;
  }
}

// Flush pending writes before tab close/hide.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { flushSupabase(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSupabase();
  });
}

/** Poora records table load karke collection_name ke hisaab se group karta hai. */
export async function loadAllFromSupabase(): Promise<Record<string, any[]>> {
  try {
    const { data, error } = await supabase.from('records').select('*').order('record_id');
    if (error) throw error;
    const out: Record<string, any[]> = {};
    (data || []).forEach((r: any) => {
      if (!out[r.collection_name]) out[r.collection_name] = [];
      let rowData = r.data;
      if (typeof rowData === 'string') { try { rowData = JSON.parse(rowData); } catch { rowData = {}; } }
      rowData = rowData || {};
      const item = { ...rowData, id: rowData.id !== undefined ? rowData.id : r.record_id };
      out[r.collection_name].push(item);
    });
    supabaseHealthy = true;
    return out;
  } catch (e: any) {
    supabaseHealthy = false;
    supabaseLastError = e?.message || 'Supabase load failed';
    console.warn('[Supabase] loadAllFromSupabase failed:', supabaseLastError);
    return {};
  }
}

/** Kisi ek collection ka data load karo (null agar fail/khali). */
export async function loadCollectionFromSupabase(col: string): Promise<any[] | null> {
  try {
    const { data, error } = await supabase
      .from('records')
      .select('*')
      .eq('collection_name', col);
    if (error) throw error;
    return (data || []).map((r: any) => {
      let rowData = r.data;
      if (typeof rowData === 'string') { try { rowData = JSON.parse(rowData); } catch { rowData = {}; } }
      rowData = rowData || {};
      return { ...rowData, id: rowData.id !== undefined ? rowData.id : r.record_id } as any;
    });
  } catch (e: any) {
    supabaseHealthy = false;
    supabaseLastError = e?.message || 'Supabase load failed';
    console.warn('[Supabase] loadCollectionFromSupabase failed:', supabaseLastError);
    return null;
  }
}

/**
 * ONE realtime channel — `records` table par koi bhi INSERT/UPDATE/DELETE
 * sab connected devices ko push hota hai (WebSocket). Firebase ki 20s polling
 * / heartbeat ka koi sahara nahi chahiye.
 */
export function subscribeRecords(onEvent: (payload: any) => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel('nsb1-records')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'records' },
      (payload) => { try { onEvent(payload); } catch (e) { console.warn('[Supabase] realtime handler error:', e); } }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') console.log('[Sync:RT] Supabase realtime channel subscribed');
      else if (status === 'CHANNEL_ERROR') console.warn('[Sync:RT] Supabase realtime channel error');
    });
  return () => { supabase.removeChannel(channel).catch(() => {}); };
}