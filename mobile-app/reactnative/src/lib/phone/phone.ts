// ── Phone number sanitisation, formatting and identity normalisation ─────────
//
// One place, because a phone number is an AUTHENTICATION IDENTIFIER here, not
// just a contact field. backend/internal/services/auth_service.go resolves a
// sign-in by NormalizePhone(), so a number this app formats differently from the
// way the backend reduces it is not a cosmetic bug — it is a user who cannot log
// in, presenting as a wrong password.
//
// The backend rule (services/phone_identifier.go), mirrored exactly below:
//   strip to digits
//   "234" + 10 digits (13 total) -> drop the country code
//   "0"   + 10 digits (11 total) -> drop the trunk zero
//   anything that is not then exactly 10 digits -> NOT a match ("")
//
// That rule is NIGERIA-ONLY and collapses to a bare 10-digit national number, so
// two subscribers in different countries whose national numbers share those ten
// digits are indistinguishable to sign-in. See COUNTRIES below.

export interface Country {
  iso2:     string;
  name:     string;
  dial:     string;  // e.g. "+234"
  flag:     string;
  nsnLen:   number;  // national significant number length
  /** Example NSN used to build the placeholder — never a real subscriber. */
  sample:   string;
  /**
   * Whether a number from this country can be used as a SIGN-IN identifier.
   * Only NG can: the backend reduces every identifier to a 10-digit Nigerian
   * NSN, so admitting another country here would let two different subscribers
   * collide on the same ten digits.
   */
  identity: boolean;
}

export const COUNTRIES: Country[] = [
  { iso2: 'NG', name: 'Nigeria',        dial: '+234', flag: '🇳🇬', nsnLen: 10, sample: '8012345678', identity: true  },
  { iso2: 'GH', name: 'Ghana',          dial: '+233', flag: '🇬🇭', nsnLen: 9,  sample: '201234567',  identity: false },
  { iso2: 'KE', name: 'Kenya',          dial: '+254', flag: '🇰🇪', nsnLen: 9,  sample: '712345678',  identity: false },
  { iso2: 'ZA', name: 'South Africa',   dial: '+27',  flag: '🇿🇦', nsnLen: 9,  sample: '712345678',  identity: false },
  { iso2: 'GB', name: 'United Kingdom', dial: '+44',  flag: '🇬🇧', nsnLen: 10, sample: '7400123456', identity: false },
  { iso2: 'US', name: 'United States',  dial: '+1',   flag: '🇺🇸', nsnLen: 10, sample: '2015550123', identity: false },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // NG — the only identity-capable one.

export function countryByIso2(iso2: string): Country {
  return COUNTRIES.find((c) => c.iso2 === iso2) ?? DEFAULT_COUNTRY;
}

/** Every non-digit removed. The one primitive every other function builds on. */
export function digitsOnly(raw: string): string {
  return (raw ?? '').replace(/\D+/g, '');
}

/**
 * The national significant number for `country`, with country code and trunk
 * zero removed and the result capped at the country's NSN length.
 *
 * Capping matters: without it a paste of "+2348012345678 (work)" silently keeps
 * trailing digits and produces a number that validates but is not the subscriber.
 */
export function toNsn(raw: string, country: Country = DEFAULT_COUNTRY): string {
  let d = digitsOnly(raw);
  const cc = country.dial.replace('+', '');
  if (d.startsWith(cc) && d.length > country.nsnLen) d = d.slice(cc.length);
  // Trunk zero, stripped WHENEVER present rather than only on a full-length
  // string. A national number never begins with 0, so keeping it mid-typing
  // grouped "0801" as "080 1", and let the 10-digit "0801234567" — which is one
  // digit short — pass isValid by occupying the full width with a zero.
  while (d.startsWith('0')) d = d.slice(1);
  return d.slice(0, country.nsnLen);
}

/** True when the NSN is complete for the country. */
export function isValid(raw: string, country: Country = DEFAULT_COUNTRY): boolean {
  return toNsn(raw, country).length === country.nsnLen;
}

/** E.164 ("+2348012345678") — the form to send to APIs. "" when incomplete. */
export function toE164(raw: string, country: Country = DEFAULT_COUNTRY): string {
  const nsn = toNsn(raw, country);
  return nsn.length === country.nsnLen ? `${country.dial}${nsn}` : '';
}

/**
 * The identity form the BACKEND matches on (services.NormalizePhone). Returns ""
 * for anything it would refuse, so a caller can never accidentally submit an
 * identifier the backend will fail to resolve.
 */
export function toIdentity(raw: string): string {
  const d = digitsOnly(raw);
  let n = d;
  if (n.startsWith('234') && n.length === 13) n = n.slice(3);
  else if (n.startsWith('0') && n.length === 11) n = n.slice(1);
  return n.length === 10 ? n : '';
}

/** Grouped for display: "801 234 5678". Formatting only — never sent anywhere. */
export function formatNsn(raw: string, country: Country = DEFAULT_COUNTRY): string {
  const n = toNsn(raw, country);
  const groups = country.nsnLen === 10 ? [3, 3, 4] : [3, 3, 3];
  const out: string[] = [];
  let i = 0;
  for (const g of groups) {
    if (i >= n.length) break;
    out.push(n.slice(i, i + g));
    i += g;
  }
  return out.join(' ');
}

/** Placeholder built from the country's own sample, so it can never mislead. */
export function placeholderFor(country: Country = DEFAULT_COUNTRY): string {
  return formatNsn(country.sample, country);
}
