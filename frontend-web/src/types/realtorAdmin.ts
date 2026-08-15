// ── Admin — Realtor control plane types ──────────────────────────────────────
// All money is integer minor units (kobo).

export interface RealtorOverview {
  listingsLive: number;
  pendingModeration: number;
  pendingVerification: number;
  activeLeases: number;
  escrowHeldKobo: number;
  payoutsDueKobo: number;
  gmvKobo: number;            // 30-day gross transaction value
  openDisputes: number;
  fraudFlags: number;
}

export type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface AdminListing {
  id: string;
  title: string;
  area: string;
  city: string;
  mode: string;
  priceKobo: number;
  verification: 'unverified' | 'document_backed' | 'inspected' | 'verified';
  ownerName: string;
  ownerVerified: boolean;
  riskFlags: string[];
  submittedAt: string;
}

export type VerificationKind = 'owner' | 'agent' | 'developer' | 'vendor' | 'property';
export type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'more_info';

export interface VerificationRequest {
  id: string;
  kind: VerificationKind;
  subjectName: string;
  documents: { label: string; uploaded: boolean }[];
  status: VerificationStatus;
  submittedAt: string;
  riskNote?: string;
}

export type PaymentKind = 'rent' | 'deposit' | 'shortlet' | 'hotel' | 'service_charge' | 'payout' | 'refund';
export type PaymentStatus = 'paid' | 'processing' | 'failed' | 'refunded';

export interface AdminPayment {
  id: string;
  reference: string;
  kind: PaymentKind;
  amountKobo: number;
  escrowHeldKobo: number;
  status: PaymentStatus;
  payer: string;
  createdAt: string;
}

export interface EscrowAccount {
  id: string;
  leaseOrBooking: string;
  amountKobo: number;
  status: 'held' | 'release_requested' | 'released' | 'disputed';
  heldSince: string;
}
