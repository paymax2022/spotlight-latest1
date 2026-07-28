// ── Paymax — Elevation / Shadow System ───────────────────────────────────────

import { Platform } from 'react-native';

// Level 1 — Standard cards
export const shadow1 = Platform.select({
  ios: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius:  20,
  },
  android: { elevation: 2 },
}) ?? {};

// Level 2 — Active / elevated cards
export const shadow2 = Platform.select({
  ios: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius:  24,
  },
  android: { elevation: 5 },
}) ?? {};

// Level 3 — Modals / popovers (tinted with primary)
export const shadow3 = Platform.select({
  ios: {
    shadowColor:   '#4C1D95',
    shadowOffset:  { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius:  32,
  },
  android: { elevation: 8 },
}) ?? {};

// Glass effect simulation (iOS only; Android uses elevation)
export const glassCard = Platform.select({
  ios: {
    shadowColor:   '#340075',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius:  24,
  },
  android: { elevation: 4 },
}) ?? {};
