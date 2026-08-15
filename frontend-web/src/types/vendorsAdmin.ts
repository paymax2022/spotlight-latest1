// Vendor oversight admin types (estate / marketplace vendor portal oversight).
//
// Backend surface: the Go estate module (backend/internal/estate/vendor.go +
// admin.go) exposes vendor + vendor-job endpoints, but they are ESTATE-OBJECT-
// SCOPED, not a global admin-RBAC surface:
//   GET  /api/finance/estate/:id/vendors            → ListVendors (status filter)
//   POST /api/finance/estate/:id/vendors            → CreateVendor
//   POST /api/finance/estate/:id/vendors/:vendorId/verify → VerifyVendor {status}
//   POST /api/finance/estate/:id/vendor/onboard     → OnboardVendor (self, from mobile vendor-portal)
//   GET  /api/finance/estate/:id/vendor/jobs        → vendor jobs (payout lifecycle)
//   POST /api/finance/estate/:id/vendor/jobs/:jid/payout → RequestVendorPayout (kobo, idempotent)
// There is NO cross-estate admin vendor route group and no vendor DISPUTE surface.
// This console is therefore a cross-estate oversight aggregate: the directory +
// approval queue map onto the per-estate vendor + verify endpoints (called with an
// estate id per row); payouts/disputes are read-only until a dedicated admin
// aggregate exists. Mock by default.

// Vendor lifecycle status (mirrors estate_vendors.status: pending|verified|suspended).
export type VendorStatus = 'pending' | 'verified' | 'suspended';

// A vendor directory row (cross-estate aggregate view).
export interface VendorRow {
  id: string;
  estateId: string;
  estateName: string;
  name: string;
  businessName: string;
  category: string;
  phone: string;
  specialties: string[];
  status: VendorStatus;
  verified: boolean;
  rating: number;
  paidJobs: number;
  openJobs: number;
  totalEarnedKobo: number;
  createdAt: string;
}

export interface VendorFilters {
  status?: string;
  category?: string;
  estateId?: string;
  q?: string;
}

// Onboarding/approval queue row — a self-onboarded vendor (from the mobile
// vendor-portal) awaiting estate-admin verification.
export interface VendorApplication {
  id: string;
  estateId: string;
  estateName: string;
  applicantName: string;
  businessName: string;
  category: string;
  phone: string;
  specialties: string[];
  bankProvided: boolean; // bank_account present (payout target)
  status: VendorStatus;
  submittedAt: string;
}

// A vendor job / payout line (read-only oversight of the estate vendor payout
// lifecycle: available→accepted→…→completed→paid).
export type VendorJobStatus =
  | 'available'
  | 'accepted'
  | 'rejected'
  | 'en_route'
  | 'in_progress'
  | 'completed'
  | 'paid';

export interface VendorPayoutRow {
  id: string;
  estateId: string;
  estateName: string;
  vendorId: string;
  vendorName: string;
  title: string;
  status: VendorJobStatus;
  amountKobo: number;
  quoteKobo?: number | null;
  payoutRef: string;
  completedAt?: string | null;
  paidAt?: string | null;
  createdAt: string;
}

export interface VendorPayoutFilters {
  status?: string;
  estateId?: string;
}
