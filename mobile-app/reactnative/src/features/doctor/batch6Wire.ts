// Pure wire→domain mapping for the three batch-6 doctor reads the Records and
// Earnings tabs render. Deliberately free of React Native imports so node:test
// can run it, like features/providerPortal/portals.ts.

import type {
  DoctorRecordsDashboard,
  EarningsBreakdown,
  EarningsPeriod,
  WalletBalance,
} from '@/types/doctor.batch6';

/** One row of GET /records/dashboard's `shares` (model_clinical.go RecordShare). */
export interface RecordShareWire {
  patientId?: string | null;
  status?:    string;
}

/** The body GET /records/dashboard writes (service_clinical.go GetRecordsDashboard). */
export interface RecordsDashboardWire {
  totalShares?:  number;
  activeShares?: number;
  shares?:       RecordShareWire[];
}

/**
 * The records dashboard, built from the share rows the backend actually projects.
 *
 * `GetRecordsDashboard` summarises `doctor_record_shares` and answers
 * `{totalShares, activeShares, shares[]}` — it has no patients table and no
 * per-category counts, so `recentPatients` and `categoryCounts` stay empty and
 * the screen falls to its "No recent patients" / "No records yet" states rather
 * than reading `.length` off undefined.
 */
export function mapRecordsDashboardWire(wire: RecordsDashboardWire): DoctorRecordsDashboard {
  const shares = wire.shares ?? [];
  const patients = new Set<string>();
  for (const share of shares) {
    if (share.patientId) patients.add(share.patientId);
  }
  return {
    totalPatients:  patients.size,
    recentPatients: [],
    categoryCounts: [],
    pendingShares:  shares.filter((s) => s.status === 'pending').length,
  };
}

/** The body GET /earnings/breakdown writes (service_tail2.go GetEarningsBreakdown). */
export interface EarningsBreakdownWire {
  currency?:           string;
  ledgerBalanceKobo?:  number;
  grossKobo?:          number;
  commissionKobo?:     number;
  vatKobo?:            number;
  netKobo?:            number;
  invoiceCount?:       number;
}

/** The body GET /wallet/balance writes (service_tail2.go GetWalletBalance). */
export interface WalletBalanceWire {
  availableKobo?: number;
  currency?:      string;
  source?:        string;
}

// The three periods the earnings toggle offers (EarningsPeriod).
const EARNINGS_PERIODS: EarningsPeriod[] = ['today', 'week', 'month'];

/**
 * The earnings breakdown, from a projection that has no time dimension.
 *
 * `GetEarningsBreakdown` sums `doctor_invoices` lifetime-wide and reads the
 * ledger balance; it never splits by day, week or month, and never by source.
 * So the per-period tiles are zeroed and each period carries an empty
 * `bySource`, which renders "No earnings in this period." — while `periods`
 * itself is always the full three, because earnings.tsx selects from it before
 * it renders anything.
 *
 * `lifetimeKobo` follows the backend's own definition of lifetime (service.go
 * GetEarnings sets it to the ledger balance), not the invoice net, so the two
 * earnings paths cannot disagree about the same doctor's money.
 */
export function mapEarningsBreakdownWire(wire: EarningsBreakdownWire): EarningsBreakdown {
  return {
    todayKobo:    0,
    weekKobo:     0,
    monthKobo:    0,
    lifetimeKobo: wire.ledgerBalanceKobo ?? 0,
    periods: EARNINGS_PERIODS.map((period) => ({ period, grossKobo: 0, bySource: [] })),
  };
}

/**
 * The wallet balance, from a projection that is a single number.
 *
 * `GetWalletBalance` is `ledger.GetBalance` — no pending bucket (service.go
 * GetEarnings hardcodes `PendingKobo: 0`) and no transaction list, so `ledger`
 * is empty and earnings.tsx shows its "No activity" state instead of reading
 * `.length` off undefined. `ledgerKobo` equals available because the ledger
 * projection is only ever the cleared balance.
 */
export function mapWalletBalanceWire(wire: WalletBalanceWire): WalletBalance {
  const availableKobo = wire.availableKobo ?? 0;
  return { availableKobo, pendingKobo: 0, ledgerKobo: availableKobo, ledger: [] };
}
