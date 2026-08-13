'use client';

import { useEffect, useRef } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { env, hasSupabaseConfig } from '@/config/env';

/**
 * Subscribes to Postgres changes on a table and invokes `onChange` when a row
 * is inserted, updated or deleted.
 *
 * The callback is held in a ref so a caller can pass an inline arrow function
 * without tearing down and re-establishing the websocket on every render — a
 * subscribe/unsubscribe loop is the classic way this hook goes wrong.
 *
 * Degrades silently: with no Supabase config the hook is a no-op and the caller
 * keeps whatever manual refresh it already has. Realtime is an enhancement over
 * a working page, never the only way to see current data.
 */
export function useRealtimeTable(
  table: string,
  onChange: () => void,
  opts: { enabled?: boolean; schema?: string; filter?: string } = {},
): void {
  const { enabled = true, schema = 'public', filter } = opts;

  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    if (!enabled || !hasSupabaseConfig) return;

    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false },
    });

    let channel: RealtimeChannel | null = null;
    try {
      channel = supabase
        .channel(`admin-realtime:${schema}.${table}${filter ? `:${filter}` : ''}`)
        .on(
          'postgres_changes',
          { event: '*', schema, table, ...(filter ? { filter } : {}) },
          () => handlerRef.current(),
        )
        .subscribe();
    } catch {
      // A realtime failure must never break the page.
      channel = null;
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [table, schema, filter, enabled]);
}
