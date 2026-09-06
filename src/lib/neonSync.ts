/**
 * NEON POSTGRESQL BACKUP SYNC
 * ============================
 * Firebase/Firestore ke saath-saath har record Neon Postgres ke `records`
 * table mein mirror hota hai. Agar Firebase fail ho ya khali ho to app
 * Neon se data load kar ke chalti hai (fallback).
 *
 * Schema:
 *   records (
 *     collection_name text,
 *     record_id       text,
 *     data            jsonb,
 *     updated_at      timestamptz,
 *     primary key (collection_name, record_id)
 *   )
 */
import { neon } from '@neondatabase/serverless';

const NEON_CONNECTION = 'postgresql://neondb_owner:npg_uHRTvXQ2f4zJ@ep-misty-sky-aybucjjd-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require';

const sql = neon(NEON_CONNECTION);

// --- Health tracking ---
let neonHealthy = true;
let neonLastError: string | null = null;
export const isNeonHealthy = () => neonHealthy;
export const getNeonLastError = () => neonLastError;

// --- Schema bootstrap (fire-and-forget, once) ---
let schemaReady = false;
export async function ensureNeonSchema(): Promise<boolean> {
  if (schemaReady) return true;
  try {
    await sql`
      create table if not exists records (
        collection_name text not null,
        record_id       text not null,
        data            jsonb not null,
        updated_at      timestamptz not null default now(),
        primary key (collection_name, record_id)
      )
    `;
    schemaReady = true;
    neonHealthy = true;
    return true;
  } catch (e: any) {
    neonHealthy = false;
    neonLastError = e?.message || 'Neon schema error';
    console.warn('[Neon] schema bootstrap failed:', neonLastError);
    return false;
  }
}

// --- Queued writes (mirrors Firestore batch queue) ---
const pendingNeon = {
  set: [] as { col: string; id: string; json: string }[],
  del: [] as { col: string; id: string }[]
};
let neonTimer: any = null;
let neonFlushInFlight = false;

export function neonQueueWrite(col: string, id: string, data: any) {
  let json: string;
  try {
    json = JSON.stringify(data, (_k, v) => (v === undefined ? null : v));
  } catch {
    return; // non-serializable — skip
  }
  pendingNeon.set.push({ col, id, json });
  scheduleNeonFlush();
}

export function neonQueueDelete(col: string, id: string) {
  pendingNeon.del.push({ col, id });
  scheduleNeonFlush();
}

/**
 * NEON HEARTBEAT — cross-device sync trigger.
 * Har local write par bheja jata hai taake doosri devices ko pata chale ke data badla.
 * (Firebase write quota fail hone par bhi Neon kaam karta hai.)
 */
export function neonHeartbeat(deviceId: string) {
  neonQueueWrite('sync_meta', 'global', { updatedAt: Date.now(), byDevice: deviceId });
}

function scheduleNeonFlush() {
  if (neonTimer) clearTimeout(neonTimer);
  neonTimer = setTimeout(() => { flushNeon(); }, 900);
}

export async function flushNeon(): Promise<void> {
  if (neonFlushInFlight) return;
  if (pendingNeon.set.length === 0 && pendingNeon.del.length === 0) return;
  if (!schemaReady) {
    const ok = await ensureNeonSchema();
    if (!ok) { return; } // keep queue for retry on next change
  }
  neonFlushInFlight = true;
  const setOps = pendingNeon.set.splice(0);
  const delOps = pendingNeon.del.splice(0);
  try {
    // Upserts in chunks (parameter limits safety)
    for (let i = 0; i < setOps.length; i += 200) {
      const chunk = setOps.slice(i, i + 200);
      const cols = chunk.map(o => o.col);
      const ids = chunk.map(o => o.id);
      const jsons = chunk.map(o => o.json);
      await sql`
        insert into records (collection_name, record_id, data, updated_at)
        select u.col, u.id, u.j::jsonb, now()
        from unnest(${cols}::text[], ${ids}::text[], ${jsons}::text[]) as u(col, id, j)
        on conflict (collection_name, record_id)
        do update set data = excluded.data, updated_at = now()
      `;
    }
    // Deletes in chunks
    for (let i = 0; i < delOps.length; i += 200) {
      const chunk = delOps.slice(i, i + 200);
      const cols = chunk.map(o => o.col);
      const ids = chunk.map(o => o.id);
      await sql`
        delete from records r
        using unnest(${cols}::text[], ${ids}::text[]) as u(col, id)
        where r.collection_name = u.col and r.record_id = u.id
      `;
    }
    neonHealthy = true;
    neonLastError = null;
  } catch (e: any) {
    neonHealthy = false;
    neonLastError = e?.message || 'Neon write failed';
    console.warn('[Neon] flush failed (data re-queued):', neonLastError);
    // Re-queue so data isn't lost; next scheduleNeonFlush retry will push.
    pendingNeon.set.unshift(...setOps);
    pendingNeon.del.unshift(...delOps);
  } finally {
    neonFlushInFlight = false;
  }
}

// Flush pending Neon writes before tab close/hide.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { flushNeon(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNeon();
  });
}

// --- Full load (fallback when Firebase unavailable/empty) ---
export async function loadAllFromNeon(): Promise<Record<string, any[]>> {
  try {
    if (!schemaReady) await ensureNeonSchema();
    const rows = await sql`select collection_name, data from records order by collection_name, record_id`;
    const out: Record<string, any[]> = {};
    for (const r of rows) {
      if (!out[r.collection_name]) out[r.collection_name] = [];
      out[r.collection_name].push(typeof r.data === 'string' ? JSON.parse(r.data) : r.data);
    }
    neonHealthy = true;
    neonLastError = null;
    return out;
  } catch (e: any) {
    neonHealthy = false;
    neonLastError = e?.message || 'Neon load failed';
    console.warn('[Neon] loadAllFromNeon failed:', neonLastError);
    return {};
  }
}

/** Kisi ek collection ka data load karo (null agar fail/khali). */
export async function loadCollectionFromNeon(col: string): Promise<any[] | null> {
  try {
    if (!schemaReady) await ensureNeonSchema();
    const rows = await sql`select data from records where collection_name = ${col}`;
    neonHealthy = true;
    return rows.map(r => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  } catch (e: any) {
    neonHealthy = false;
    neonLastError = e?.message || 'Neon load failed';
    return null;
  }
}
