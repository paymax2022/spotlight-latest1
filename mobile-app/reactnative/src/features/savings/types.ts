// ── Savings domain types ─────────────────────────────────────────────────────
// Money is always integer minor units (kobo). Never floats, never strings for math.

// Vault: OPEN → (LOCKED | FLEX) → MATURED | CLOSED
export type VaultStatus = 'OPEN' | 'LOCKED' | 'FLEX' | 'MATURED' | 'CLOSED';

export type SaveFrequency = 'daily' | 'weekly' | 'monthly';

export interface AutoSavePlan {
  enabled:        boolean;
  amountKobo:     number;
  frequency:      SaveFrequency;
  nextRunISO:     string | null;
  source:         'wallet';
}

export interface Vault {
  id:             string;
  name:           string;
  emoji?:         string;
  status:         VaultStatus;
  balanceKobo:    number;
  targetKobo:     number | null;
  /** ISO date the vault unlocks / matures (LOCKED only). */
  maturesAtISO:   string | null;
  createdAtISO:   string;
  autoSave:       AutoSavePlan | null;
  /** Consecutive periods saved — basic streak nudge. */
  streak:         number;
  /** NL-2: always 0 — vaults never accrue yield. */
  interestKobo:   0;
}

export interface CreateVaultInput {
  name:        string;
  targetKobo:  number | null;
  lock:        'LOCKED' | 'FLEX';
  maturesAtISO?: string | null;
  initialKobo?: number;
}

export interface EarlyWithdrawQuote {
  vaultId:      string;
  balanceKobo:  number;
  /** Penalty for breaking a LOCKED vault early (config-driven). */
  penaltyKobo:  number;
  netKobo:      number;
  allowed:      boolean;
}

// ── Ajo / Esusu ──────────────────────────────────────────────────────────────
// Circle: FORMING → ACTIVE → (CYCLE×n) → COMPLETED
// Member: INVITED → ACTIVE → DEFAULTED | EXITED
export type CircleStatus = 'FORMING' | 'ACTIVE' | 'COMPLETED';
export type MemberStatus = 'INVITED' | 'ACTIVE' | 'DEFAULTED' | 'EXITED';
export type CycleStatus  = 'UPCOMING' | 'COLLECTING' | 'PAID';

export interface AjoMember {
  id:            string;
  name:          string;
  handle:        string;          // @cashtag
  avatarColor:   string;
  status:        MemberStatus;
  /** Payout position in the rotation (1-indexed). */
  payoutOrder:   number;
  paidThisCycle: boolean;
}

export interface AjoCycle {
  index:          number;          // 1-indexed
  status:         CycleStatus;
  dueISO:         string;
  /** member id scheduled to receive this cycle's pooled payout. */
  beneficiaryId:  string;
  collectedKobo:  number;
  potKobo:        number;
}

export interface AjoCircle {
  id:               string;
  name:             string;
  status:           CircleStatus;
  contributionKobo: number;        // per-member, per-cycle
  frequency:        SaveFrequency;
  memberCount:      number;
  members:          AjoMember[];
  cycles:           AjoCycle[];
  currentCycle:     number;        // 1-indexed; 0 while FORMING
  /** NL-7 — Paymax is ledger/escrow only, never guarantor. Always false. */
  paymaxGuarantees: false;
}

export interface CreateCircleInput {
  name:             string;
  contributionKobo: number;
  frequency:        SaveFrequency;
  memberCount:      number;
}

// ── Group Target ─────────────────────────────────────────────────────────────
export type WithdrawalRule = 'on-date' | 'majority-approval';

export interface GroupTargetContributor {
  id:          string;
  name:        string;
  handle:      string;
  avatarColor: string;
  pledgedKobo: number;
  savedKobo:   number;
}

export interface GroupTarget {
  id:             string;
  name:           string;
  targetKobo:     number;
  savedKobo:      number;
  deadlineISO:    string;
  withdrawalRule: WithdrawalRule;
  contributors:   GroupTargetContributor[];
  /** NL-2: group targets earn no interest. */
  interestKobo:   0;
}

export interface CreateGroupTargetInput {
  name:           string;
  targetKobo:     number;
  deadlineISO:    string;
  withdrawalRule: WithdrawalRule;
}

// ── Home summary ─────────────────────────────────────────────────────────────
export interface SavingsSummary {
  totalSavedKobo:  number;
  vaultCount:      number;
  circleCount:     number;
  targetCount:     number;
}

export interface ContributionResult {
  ok:          boolean;
  newBalanceKobo: number;
}
