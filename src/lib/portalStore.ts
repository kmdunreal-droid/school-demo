/**
 * PORTAL STORE — naye modules (notices, events, quizzes, attempts) ka
 * shared local store. Teacher-Pay pattern follow karta hai:
 *   - har portal same localStorage key parh/save karta hai
 *   - writes Supabase queue mein bhi jaate hain (demo = no-op)
 *   - 'storage' event se cross-tab refresh
 */
import { useCallback, useEffect, useState } from 'react';
import { safeStorage } from './safeStorage';
import { sbQueueWrite, sbQueueDelete } from './supabaseSync';

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readList<T>(key: string): T[] {
  try {
    const raw = safeStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Shared collection hook — sab portals same key use karte hain.
 * Cross-tab sync browser 'storage' event se (same browser, demo mode).
 */
export function usePortalCollection<T extends { id: string }>(key: string, table: string) {
  const [items, setItems] = useState<T[]>(() => readList<T>(key));

  // Persist + cloud queue (demo mode mein sbQueueWrite no-op hai)
  useEffect(() => {
    safeStorage.setItem(key, JSON.stringify(items));
    items.forEach(item => {
      if (item && item.id) sbQueueWrite(table, String(item.id), item);
    });
  }, [key, table, items]);

  // Cross-tab refresh (same browser doosra tab)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== key || e.newValue == null) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) setItems(parsed);
      } catch { /* ignore */ }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  /** Item add/update karo. */
  const upsert = useCallback((item: T) => {
    setItems(prev => {
      const idx = prev.findIndex(p => String(p.id) === String(item.id));
      if (idx === -1) return [item, ...prev];
      const next = prev.slice();
      next[idx] = item;
      return next;
    });
  }, []);

  /** Item delete karo (cloud se bhi). */
  const remove = useCallback((id: string) => {
    sbQueueDelete(table, String(id));
    setItems(prev => prev.filter(p => String(p.id) !== String(id)));
  }, [table]);

  return { items, upsert, remove, setItems } as const;
}

/** Naye tables — Supabase schema inhe bhi janta hoga (live mode). */
export const PORTAL_TABLES = {
  notices: 'notices',
  events: 'school_events',
  quizzes: 'quizzes',
  quizAttempts: 'quiz_attempts',
} as const;
