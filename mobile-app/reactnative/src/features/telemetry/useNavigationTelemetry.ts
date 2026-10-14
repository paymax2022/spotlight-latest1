import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname, useGlobalSearchParams } from 'expo-router';
import { useAuthStore } from '@/store/authStore';
import { createTelemetryBuffer } from './buffer';
import { routeTemplate } from './route';
import { sendNavigationBatch } from './sender';

export const isNavTelemetryEnabled = (): boolean =>
  process.env.EXPO_PUBLIC_NAV_TELEMETRY === 'true';

let buffer: ReturnType<typeof createTelemetryBuffer> | null = null;
function getBuffer() {
  buffer ??= createTelemetryBuffer({
    send: sendNavigationBatch,
    startTimer: (cb, ms) => { const t = setInterval(cb, ms); return () => clearInterval(t); },
    onBackground: (cb) => {
      const sub = AppState.addEventListener('change', (s) => { if (s === 'background') cb(); });
      return () => sub.remove();
    },
  });
  return buffer;
}

/** Flush pending events now (call on sign-out, while the session is still valid). */
export function flushNavigationTelemetry(): void {
  buffer?.flushNow();
}

export function useNavigationTelemetry(): void {
  const enabled = isNavTelemetryEnabled();
  const authed = useAuthStore((s) => !!s.user);
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  useEffect(() => {
    if (!enabled || !authed) return;
    try {
      const route = routeTemplate(pathname, params as Record<string, string | string[]>);
      if (route) {
        getBuffer().record({ surface: 'mobile', route, occurred_at: new Date().toISOString() });
      }
    } catch { /* never throw into the app */ }
    // params intentionally omitted: record once per pathname change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, authed, pathname]);

  useEffect(() => {
    if (enabled && !authed) flushNavigationTelemetry();
  }, [enabled, authed]);
}
