// Money is always integer minor units (kobo).

export interface Cashtag {
  id:          string;
  handle:      string;          // includes leading @
  displayName: string;
  avatarColor: string;
  verified:    boolean;
}

export interface MyCashtag {
  handle:      string | null;
  displayName: string;
  avatarColor: string;
  /** Remaining daily AML send allowance (kobo). */
  remainingDailyKobo: number;
  dailyLimitKobo:     number;
}

// `other` is the landing spot for a kind the backend adds before this client
// learns its name. It has to exist: KIND_META is keyed on this union, and an
// unmapped key reads as undefined downstream and takes the screen down. Nothing
// is dropped and nothing is mislabelled as a request to earn a tidy switch.
export type ActivityKind = 'sent' | 'received' | 'request' | 'split' | 'pool' | 'other';
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

// ── Money requests ───────────────────────────────────────────────────────────
// A request has two roles, and they are NOT symmetric:
//   requester = who is owed  (creates the request)
//   payer     = who must pay (receives it, and acts on it)
// `direction` is always read from the CALLER's point of view, which is what the
// backend's GET /requests returns per-session:
//   incoming → I am the payer, I owe this money
//   outgoing → I am the requester, this is owed to me
export type RequestState = 'PENDING' | 'PAID' | 'DECLINED' | 'CANCELLED';
export type RequestDirection = 'incoming' | 'outgoing';

export interface MoneyRequest {
  id:              string;
  direction:       RequestDirection;
  state:           RequestState;
  amountKobo:      number;
  note:            string;
  requesterId:     string;
  payerId:         string;
  /** The OTHER party, labelled for display. '' when they have no cashtag. */
  counterpartHandle: string;
  counterpartName:   string;
  counterpartId:     string;
  createdAtISO:      string;
}

/** The wire shape of one row from GET /api/finance/social/requests. */
export interface RequestRowServer {
  id: string;
  requester_id?: string;
  payer_id?: string;
  amount_kobo?: number;
  note?: string;
  /** Uppercase on the wire: PENDING | PAID | DECLINED | CANCELLED. */
  state?: string;
  direction?: string;
  counterpart_id?: string;
  counterpart_handle?: string;
  counterpart_name?: string;
  created_at?: string;
}

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
