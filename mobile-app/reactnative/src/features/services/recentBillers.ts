// "Recent Billers" for the Bills hub, derived from the user's REAL utility purchases
// (`utility_transactions`). Whatever provider they bought from shows up, with that
// provider's own logo — nothing here is a fixed provider list. The previous list was a
// hard-coded demo (Eko / MTN / DSTV) shown to everyone.
//
// Pure: the hook in useRecentBillers.ts does the fetching and logo lookup.

import type { ServiceType, Transaction } from '@/types/transaction';

export interface RecentBiller {
  /** Id of the latest purchase this row stands for (stable React key). */
  id: string;
  serviceType: ServiceType;
  /** The provider as the purchase recorded it (e.g. "MTN", "Kaduna Electric"); null if unknown. */
  providerName: string | null;
  title: string;
  subtitle: string;
  /** Amount of that latest purchase, kobo. */
  amountKobo: number;
}

/** The billing API's logo category for a service type. */
export function logoCategory(t: ServiceType): 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'education' {
  switch (t) {
    case 'AIRTIME': return 'airtime';
    case 'DATA': return 'data';
    case 'ELECTRICITY': return 'electricity';
    case 'CABLE_TV': return 'cable_tv';
    case 'EDUCATION': return 'education';
  }
}

const TYPE_LABEL: Record<ServiceType, string> = {
  AIRTIME: 'Airtime',
  DATA: 'Data',
  ELECTRICITY: 'Electricity',
  CABLE_TV: 'Cable TV',
  EDUCATION: 'Education',
};

// What the number is called, so "04210000918" reads as a meter rather than a mystery.
const TARGET_PREFIX: Record<ServiceType, string> = {
  AIRTIME: '',
  DATA: '',
  ELECTRICITY: 'Meter ',
  CABLE_TV: 'Smartcard ',
  EDUCATION: '',
};

/** Same masking as the saved-billers list: never render a full account/number. */
export function maskIdentifier(raw: string): string {
  const digits = raw.replace(/\s+/g, '');
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}•••${digits.slice(-3)}`;
}

function titleFor(t: Transaction, provider: string | null): string {
  if (!provider) return TYPE_LABEL[t.serviceType];
  // Airtime/data have no product worth naming; the others do (a plan, prepaid/postpaid…).
  const detail = t.serviceType === 'AIRTIME' || t.serviceType === 'DATA'
    ? TYPE_LABEL[t.serviceType]
    : (t.productName?.trim() || TYPE_LABEL[t.serviceType]);
  // "DSTV Compact" already names the provider; do not print "DSTV DSTV Compact".
  if (detail.toLowerCase().includes(provider.toLowerCase())) return detail;
  return `${provider} ${detail}`;
}

/**
 * The latest successful purchase per provider + number, newest first, capped.
 * Only SUCCESSFUL purchases count: a failed or still-pending purchase is not a biller
 * the user has used.
 */
export function deriveRecentBillers(txs: Transaction[], limit = 5): RecentBiller[] {
  const sorted = [...txs]
    .filter((t) => t.status === 'SUCCESSFUL')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const seen = new Set<string>();
  const out: RecentBiller[] = [];
  for (const t of sorted) {
    const provider = t.providerName?.trim() || null;
    const key = `${t.serviceType}|${(provider ?? '').toLowerCase()}|${t.customerIdentifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: t.id,
      serviceType: t.serviceType,
      providerName: provider,
      title: titleFor(t, provider),
      subtitle: t.customerIdentifier ? `${TARGET_PREFIX[t.serviceType]}${maskIdentifier(t.customerIdentifier)}` : '',
      amountKobo: t.amount,
    });
    if (out.length >= limit) break;
  }
  return out;
}
