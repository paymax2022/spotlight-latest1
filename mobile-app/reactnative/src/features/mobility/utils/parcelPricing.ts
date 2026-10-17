// Display helpers for the parcel estimate. Prices are the SERVER's — these only
// look them up; nothing here computes a fare.

interface PriceOption {
  size: string;
  speed: string;
  fareKobo: number;
}

interface InsuranceInfo {
  productName: string;
  underwriter: string;
  provider: string;
}

/** The server's price for one size × speed, or undefined when it did not quote it. */
export function parcelOptionFare(
  est: { options?: readonly PriceOption[] } | undefined,
  size: string,
  speed: string,
): number | undefined {
  return est?.options?.find((o) => o.size === size && o.speed === speed)?.fareKobo;
}

const PROVIDER_LABELS: Record<string, string> = { mycover: 'MyCover', octamile: 'Octamile' };

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** "Cover · Underwriter via Provider", dropping the parts the server did not send. */
export function parcelInsuranceLine(info: InsuranceInfo | undefined | null): string | null {
  if (!info) return null;
  let line = info.productName;
  if (info.underwriter) line += ` · ${info.underwriter}`;
  if (info.provider) line += ` via ${providerLabel(info.provider)}`;
  return line;
}
