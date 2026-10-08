// Local to the connect surface. Money formatting, colors and safety copy come
// Deal-Room-specific label maps that the foundation doesn't own.

// The connect model has no order FSM, so a conversation is only ever: plain
// chatting, an offer is on the table (pending), or a price has been agreed.
export type DealStage = 'chatting' | 'offer_pending' | 'offer_accepted' | 'completed';

export const DEAL_STAGE_LABEL: Record<DealStage, string> = {
  chatting: 'Chatting',
  offer_pending: 'Offer pending',
  offer_accepted: 'Price agreed',
  completed: 'Completed',
};

// ── Scam-language patterns (Deal Room warning banner) ────────────────────────
// (typed or received) contains any. Kept plain-language so ops can extend it.
export const SCAM_PATTERNS: { pattern: RegExp; hint: string }[] = [
  { pattern: /\bpay(?:ing)?\s+outside\b/i, hint: 'paying outside the app' },
  { pattern: /\boutside\s+(?:the\s+)?(?:app|escrow|paymax)\b/i, hint: 'moving off-platform' },
  { pattern: /\bgift\s*card/i, hint: 'gift cards' },
  { pattern: /\bwhats\s*app\b/i, hint: 'moving to WhatsApp' },
  { pattern: /\btelegram\b/i, hint: 'moving to Telegram' },
  { pattern: /\bwestern\s+union\b/i, hint: 'Western Union' },
  { pattern: /\bbank\s+transfer\s+(?:directly|to\s+me)\b/i, hint: 'a direct bank transfer' },
  { pattern: /\bcrypto|bitcoin|usdt\b/i, hint: 'crypto payment' },
];

export function detectScamHint(text: string): string | null {
  for (const { pattern, hint } of SCAM_PATTERNS) {
    if (pattern.test(text)) return hint;
  }
  return null;
}

export const REVIEW_TAGS = [
  'As described',
  'Smooth meetup',
  'Good communication',
  'Well packaged',
  'Fair price',
  'Would deal again',
] as const;
