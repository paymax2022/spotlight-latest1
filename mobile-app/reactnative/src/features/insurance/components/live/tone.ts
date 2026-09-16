// ── Insurance (live) — tone → design token mapping ──────────────────────────
// Categories carry an abstract `tone`, never a colour. This is the ONE place a
// tone becomes a token, so no screen in the module ever hardcodes a hex value.

import { Colors } from '@/constants/colors';
import type { Tone } from '../../live/catalog';

export interface ToneTokens {
  fg: string;
  bg: string;
}

const TONES: Record<Tone, ToneTokens> = {
  brand:  { fg: Colors.primary,           bg: Colors.iconBgPurple },
  accent: { fg: Colors.secondary,         bg: Colors.iconBgBlue },
  teal:   { fg: Colors.tertiaryContainer, bg: Colors.iconBgTeal },
  gold:   { fg: Colors.onWarning,         bg: Colors.iconBgGold },
  green:  { fg: Colors.tertiary,          bg: Colors.iconBgGreen },
  red:    { fg: Colors.error,             bg: Colors.iconBgRed },
  purple: { fg: Colors.primaryContainer,  bg: Colors.iconBgPurple },
};

export function toneTokens(tone: Tone | string | undefined): ToneTokens {
  return TONES[(tone ?? 'brand') as Tone] ?? TONES.brand;
}
