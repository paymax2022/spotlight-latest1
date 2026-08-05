// ── Bill payments — saved biller/beneficiary store ────────────────────────────
// Saved billers (airtime, data, electricity, cable) the user reuses for repeat
// bill payments. This is the single source of truth shared by the Bills hub and
// the Beneficiaries screen. NON-MONEY: a saved biller is just a reusable target
// (a phone number / meter / smartcard); no balance or amount is moved here — the
// actual purchase runs through the bill payment checkout with its own idempotency.

import { create } from 'zustand';
import { Colors } from '@/constants/colors';
import { RECENT_BILLERS } from '@/data/billPayment';

/** A saved biller the user can pay again in one tap. */
export interface SavedBiller {
  id: string;
  title: string;      // e.g. "MTN Airtime"
  subtitle: string;   // masked target — phone / meter / smartcard
  amount?: string;    // last/typical amount (display only), optional
  icon: string;       // lucide icon name
  accent: string;     // icon tint
  bg: string;         // icon chip background
}

/** Category presets drive the icon + colours for a newly added biller. */
export type BillerCategory = 'Airtime' | 'Data' | 'Electricity' | 'Cable TV';

export const BILLER_CATEGORIES: BillerCategory[] = ['Airtime', 'Data', 'Electricity', 'Cable TV'];

export const CATEGORY_PRESET: Record<BillerCategory, { icon: string; accent: string; bg: string; targetLabel: string; targetPlaceholder: string }> = {
  Airtime:     { icon: 'Smartphone', accent: Colors.primary, bg: Colors.iconBgPurple, targetLabel: 'Phone number',    targetPlaceholder: '0803 000 0000' },
  Data:        { icon: 'Wifi',       accent: Colors.secondary, bg: Colors.iconBgBlue, targetLabel: 'Phone number',    targetPlaceholder: '0803 000 0000' },
  Electricity: { icon: 'Zap',        accent: '#D97706',        bg: 'rgba(234,179,8,0.12)', targetLabel: 'Meter number', targetPlaceholder: '0421 0000 918' },
  'Cable TV':  { icon: 'Tv',         accent: Colors.teal,      bg: Colors.iconBgTeal, targetLabel: 'Smartcard number', targetPlaceholder: '7020 000 903' },
};

let seq = 0;
const newId = () => `bnf_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** Mask a target so the saved list never renders a full account/number. */
export function maskTarget(raw: string): string {
  const digits = raw.replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}

interface BillerState {
  billers: SavedBiller[];
  add: (input: { category: BillerCategory; title: string; target: string; amount?: string }) => void;
  remove: (id: string) => void;
}

export const useBillerStore = create<BillerState>((set) => ({
  // Seed with the historical demo billers so existing screens keep their content.
  billers: RECENT_BILLERS.map((b) => ({ ...b })),

  add: ({ category, title, target, amount }) =>
    set((st) => {
      const preset = CATEGORY_PRESET[category];
      const biller: SavedBiller = {
        id: newId(),
        title: title.trim(),
        subtitle: maskTarget(target),
        amount: amount?.trim() || undefined,
        icon: preset.icon,
        accent: preset.accent,
        bg: preset.bg,
      };
      return { billers: [biller, ...st.billers] };
    }),

  remove: (id) => set((st) => ({ billers: st.billers.filter((b) => b.id !== id) })),
}));
