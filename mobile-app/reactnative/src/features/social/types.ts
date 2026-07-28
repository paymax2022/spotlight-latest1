// ── Social Payments domain types ─────────────────────────────────────────────
// Money is always integer minor units (kobo).

export interface Cashtag {
  id:          string;
  handle:      string;          // includes leading @
  displayName: string;
  avatarColor: string;
  verified:    boolean;
}

export interface MyCashtag {
  handle:      string | null;   // null = not set up yet
  displayName: string;
  avatarColor: string;
  /** Remaining daily AML send allowance (kobo). */
  remainingDailyKobo: number;
  dailyLimitKobo:     number;
}

// ── Activity feed ────────────────────────────────────────────────────────────
export type ActivityKind = 'sent' | 'received' | 'request' | 'split' | 'pool';
export type ActivityStatus = 'completed' | 'pending' | 'declined';

export interface ActivityItem {
  id:           string;
  kind:         ActivityKind;
  status:       ActivityStatus;
  counterparty: string;          // handle or group name
  avatarColor:  string;
  amountKobo:   number;
  note?:        string;
  createdAtISO: string;
}

// ── Send / Request ───────────────────────────────────────────────────────────
export interface SendInput {
  toHandle:   string;
  amountKobo: number;
  note?:      string;
}

export interface RequestInput {
  fromHandle: string;
  amountKobo: number;
  note?:      string;
}

export interface PayResult {
  id:     string;
  ok:     boolean;
  status: ActivityStatus;
}

// ── Split bill ───────────────────────────────────────────────────────────────
export type SplitStatus = 'collecting' | 'settled';
export type ShareState = 'paid' | 'pending';

export interface SplitShare {
  id:          string;
  name:        string;
  handle:      string;
  avatarColor: string;
  amountKobo:  number;
  state:       ShareState;
  isYou?:      boolean;
}

export interface SplitBill {
  id:           string;
  title:        string;
  status:       SplitStatus;
  totalKobo:    number;
  collectedKobo:number;
  mode:         'equal' | 'custom';
  shares:       SplitShare[];
  createdAtISO: string;
}

export interface CreateSplitInput {
  title:      string;
  totalKobo:  number;
  mode:       'equal' | 'custom';
  participants: { handle: string; amountKobo: number }[];
}

// ── Group pool ───────────────────────────────────────────────────────────────
export type PoolStatus = 'open' | 'closed';

export interface PoolContributor {
  id:          string;
  name:        string;
  handle:      string;
  avatarColor: string;
  amountKobo:  number;
}

export interface GroupPool {
  id:           string;
  title:        string;
  description?: string;
  status:       PoolStatus;
  goalKobo:     number | null;
  raisedKobo:   number;
  /** Who can withdraw + when (display copy). */
  payoutRule:   string;
  contributors: PoolContributor[];
  createdAtISO: string;
}

export interface CreatePoolInput {
  title:       string;
  description?:string;
  goalKobo:    number | null;
  payoutRule:  string;
}

export interface ContributeResult {
  ok:         boolean;
  raisedKobo: number;
}
