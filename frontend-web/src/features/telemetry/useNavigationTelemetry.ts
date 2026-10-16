'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { browserBufferOptions, createTelemetryBuffer } from './buffer';
import { shouldEmit } from './gate';
import { routeTemplate } from './route';
import { sendNavigationBatch } from './sender';

// Literal dotted access so Next inlines it at build time.
const FLAG = process.env.NEXT_PUBLIC_NAV_TELEMETRY;

export function useNavigationTelemetry(): void {
  const pathname = usePathname();
  const params = useParams();
  const [authed, setAuthed] = useState(false);
  const bufRef = useRef<ReturnType<typeof createTelemetryBuffer> | null>(null);
  const enabled = FLAG === 'true';

  // Track auth state only when the flag is on.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (!cancelled) setAuthed(!!data.session);
    }).catch(() => {});
    const sub = supabase.auth.onAuthStateChange((_e: unknown, session: unknown) => {
      if (!cancelled) setAuthed(!!session);
    });
    return () => {
      cancelled = true;
      try { sub?.data?.subscription?.unsubscribe(); } catch { /* ignore */ }
    };
  }, [enabled]);

  const active = shouldEmit(FLAG, authed);

  // Buffer + listeners only exist while active.
  useEffect(() => {
    if (!active) return;
    const buf = createTelemetryBuffer({ send: sendNavigationBatch, ...browserBufferOptions() });
    bufRef.current = buf;
    return () => {
      buf.flushNow();
      buf.dispose();
      bufRef.current = null;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !bufRef.current || !pathname) return;
    try {
      const route = routeTemplate(pathname, (params ?? {}) as Record<string, string | string[]>);
      if (route) {
        bufRef.current.record({ surface: 'web', route, occurred_at: new Date().toISOString() });
      }
    } catch { /* never throw into the app */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pathname]);
}
