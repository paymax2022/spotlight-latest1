import { Colors } from '@/constants/colors';

// Flip to false once the live Go-backend /connect endpoints are reachable from
// the app (or set EXPO_PUBLIC_CONNECT_USE_MOCK=false). Mirrors the visitor/realtor
// mock-first convention.
export const USE_MOCK = (process.env.EXPO_PUBLIC_CONNECT_USE_MOCK ?? 'true') !== 'false';

// Connect REST namespace. NOTE: Connect lives on the Go backend (:8080), not the
// frontend-web host the shared axios client points at — Phase 1 wires the correct
// base; Phase 0 stays mock-first.
export const CONNECT_API_BASE = '/api/v1/connect';

// Module-scoped colors built on the base design tokens (never hardcode hex).
export const ConnectColors = {
  brand:    Colors.primary,
  accent:   Colors.secondary,
  ok:       Colors.teal,
  okBg:     Colors.iconBgTeal,
  warn:     Colors.gold,
  danger:   Colors.error,
  surface:  Colors.surfaceContainerLowest,
  text:     Colors.onSurface,
  muted:    Colors.onSurfaceVariant,
  border:   Colors.outlineVariant,
};
