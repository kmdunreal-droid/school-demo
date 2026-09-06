/**
 * SUPABASE SYNC LAYER — Firestore-style per-table backend:
 *
 * Har collection ki apni table hai (id text pk, data jsonb, updated_at):
 *   students, teachers, classes, timetable, attendance, marks,
 *   fees, fee_data, coordinators, assignments, app_settings
 *
 * - sbQueueWrite('students', id, data)  → students table upsert
 * - loadCollectionFromSupabase('fees')  → fees table select
 * - subscribeRecords()                  → SARI tables par ek realtime channel
 *
 * Data Neon/Firestore se migrate karne ke liye:
 * scripts/migrate-neon-to-supabase.cjs (records + sari tables dono fill karta hai)
 *
 * Cross-device sync WebSocket realtime (postgres_changes) se hota hai —
 * koi polling/heartbeat/quota nahi.
 */
import { supabase } from '../supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

let supabaseHealthy = true;
let supabaseLastError: string | null = null;
export const isSupabaseHealthy = () => supabaseHealthy;
export const getSupabaseLastError = () => supabaseLastError;

/** App ki sari collections — har ek ki apni Supabase table hai. */
export const KNOWN_TABLES = [
  'students', 'teachers', 'classes', 'timetable', 'attendance',
  'marks', 'fees', 'fee_data', 'coordinators', 'assignments', 'app_settings',
] as const;

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
    // Upserts — per-table groups (har collection ki apni table, onConflict: id)
    const byTable: Record<string, { id: string; data: any }[]> = {};
    for (const { col, id, data } of sets) {
      if (!byTable[col]) byTable[col] = [];
      byTable[col].push({ id: String(id), data: data === undefined ? null : data });
    }
    for (const [table, rows] of Object.entries(byTable)) {
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await supabase
          .from(table)
          .upsert(chunk, { onConflict: 'id' });
        if (error) throw error;
      }
    }
    // Deletes — per-table batched (ek request mein saari ids)
    const delsByTable: Record<string, string[]> = {};
    for (const { col, id } of dels) {
      if (!delsByTable[col]) delsByTable[col] = [];
      delsByTable[col].push(String(id));
    }
    for (const [table, ids] of Object.entries(delsByTable)) {
      const { error } = await supabase
        .from(table)
        .delete()
        .in('id', ids);
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

/** Sari known tables load karke collection ke hisaab se group karta hai (App ka init path). */
export async function loadAllFromSupabase(): Promise<Record<string, any[]>> {
  try {
    const out: Record<string, any[]> = {};
    await Promise.all(KNOWN_TABLES.map(async (table) => {
      const { data, error } = await supabase.from(table).select('id,data');
      if (error) {
        if ((error as any)?.code === 'PGRST205') {
          console.warn(`[Supabase] table "${table}" missing — SQL Editor mein scripts/supabase-schema.sql chalayein.`);
        } else {
          console.warn(`[Supabase] load "${table}" failed:`, (error as any).message);
        }
        out[table] = [];
        return;
      }
      out[table] = (data || []).map((r: any) => {
        let rowData = r.data;
        if (typeof rowData === 'string') { try { rowData = JSON.parse(rowData); } catch { rowData = {}; } }
        rowData = rowData || {};
        return { ...rowData, id: rowData.id !== undefined ? rowData.id : r.id };
      });
    }));
    supabaseHealthy = true;
    return out;
  } catch (e: any) {
    supabaseHealthy = false;
    supabaseLastError = e?.message || 'Supabase load failed';
    console.warn('[Supabase] loadAllFromSupabase failed:', supabaseLastError);
    return {};
  }
}

/** Kisi ek collection (= apni table) ka data load karo (null agar fail). */
export async function loadCollectionFromSupabase(col: string): Promise<any[] | null> {
  try {
    const { data, error } = await supabase
      .from(col)
      .select('id,data');
    if (error) throw error;
    return (data || []).map((r: any) => {
      let rowData = r.data;
      if (typeof rowData === 'string') { try { rowData = JSON.parse(rowData); } catch { rowData = {}; } }
      rowData = rowData || {};
      return { ...rowData, id: rowData.id !== undefined ? rowData.id : r.id } as any;
    });
  } catch (e: any) {
    supabaseHealthy = false;
    supabaseLastError = e?.message || 'Supabase load failed';
    console.warn('[Supabase] loadCollectionFromSupabase failed:', supabaseLastError);
    return null;
  }
}

/**
 * ONE realtime channel — SARI tables par koi bhi INSERT/UPDATE/DELETE
 * sab connected devices ko push hota hai (WebSocket). Firebase ki 20s polling
 * / heartbeat ka koi sahara nahi chahiye.
 */
export function subscribeRecords(onEvent: (payload: any) => void): () => void {
  const channel: RealtimeChannel = supabase.channel('nsb1-school');
  for (const table of KNOWN_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table } as any,
      (payload: any) => {
        try { onEvent({ ...payload, table }); } catch (e) { console.warn('[Supabase] realtime handler error:', e); }
      }
    );
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('[Sync:RT] Supabase realtime channel subscribed (all tables)');
    else if (status === 'CHANNEL_ERROR') console.warn('[Sync:RT] Supabase realtime channel error');
  });
  return () => { supabase.removeChannel(channel).catch(() => {}); };
}