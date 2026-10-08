// Pure helpers for the TOWING card-direct rail (pay by debit card straight
// through Paystack — no wallet, no KYC-tier gate). Backend contract:
// docs/adr/ADR-PR522-mobility-card-direct.md, towing domain
// (backend/internal/transport/paystackcheckout/towing.go). Shared status/copy
// helpers live in ./cardDirect.ts; this file only holds what is towing
// specific. No React / RN / network imports so it runs under
// `node --experimental-strip-types --test`.
//
// IRON RULE: the amount is NEVER built or sent from the client. The server
// quotes, freezes and verifies it; the body below has no money field.

import type { CardDirectStatus } from './cardDirect';

export const TOWING_CARD_DIRECT_BASE = '/mobility/towing/paystack';

interface PlaceLike {
  address: string;
  lat: number;
  lng: number;
}

export interface TowingCardDirectInput {
  serviceType: 'flatbed' | 'wheel_lift' | 'heavy_duty' | 'roadside';
  issue: 'breakdown' | 'accident' | 'flat_tyre' | 'no_fuel' | 'battery' | 'locked_out';
  vehicleType: string;
  pickup: PlaceLike;
  /** null for roadside-only services. */
  dest: PlaceLike | null;
  email?: string;
  callbackUrl?: string;
}

/**
 * The app's service picker (flatbed / wheel_lift / heavy_duty / roadside) is
 * richer than towing_jobs.service_type, whose CHECK only admits
 * tow | flatbed | jumpstart | tire_change | fuel | battery | unlock | mechanic.
 * A value outside it would be charged and then rejected by the INSERT, so the
 * card-direct body is mapped onto the accepted set (the server also refuses
 * anything else before the gateway is touched).
 */
export function mapTowingServiceType(
  serviceType: TowingCardDirectInput['serviceType'],
  issue: TowingCardDirectInput['issue'],
): string {
  switch (serviceType) {
    case 'flatbed':
      return 'flatbed';
    case 'wheel_lift':
    case 'heavy_duty':
      return 'tow';
    case 'roadside':
      switch (issue) {
        case 'battery':
          return 'battery';
        case 'no_fuel':
          return 'fuel';
        case 'flat_tyre':
          return 'tire_change';
        case 'locked_out':
          return 'unlock';
        default:
          return 'mechanic';
      }
  }
}

/**
 * snake_case body for POST /mobility/towing/paystack/initiate. Uses the
 * BACKEND field names (`issue_type`) and carries NO amount / payment_method.
 * Gateway-only fields (email, callback_url) are the only extras; the server
 * strips them before freezing the request.
 */
export function buildTowingCardDirectBody(req: TowingCardDirectInput): Record<string, unknown> {
  const roadside = req.serviceType === 'roadside';
  if (!roadside && !req.dest) {
    throw new Error('A tow destination is required for this service.');
  }
  const body: Record<string, unknown> = {
    service_type: mapTowingServiceType(req.serviceType, req.issue),
    vehicle_type: req.vehicleType,
    issue_type: req.issue,
    pickup: req.pickup,
    dest: roadside ? null : req.dest,
  };
  if (req.email) body.email = req.email;
  if (req.callbackUrl) body.callback_url = req.callbackUrl;
  return body;
}

export function towingCardDirectStatusPath(reference: string): string {
  return `${TOWING_CARD_DIRECT_BASE}/${encodeURIComponent(reference)}/status`;
}

/** Route the Paystack WebView hands off to once the SDK reports success. */
export function towingCardDirectResolverRoute(reference: string): string {
  return `/mobility/paystack/towing/${encodeURIComponent(reference)}`;
}

/** Server shape → client shape ("towingJobId" is the domain's entity id key). */
export function normalizeTowingStatus(raw: {
  reference: string;
  status: CardDirectStatus['status'];
  amountKobo?: number;
  towingJobId?: string;
}): CardDirectStatus & { towingJobId?: string } {
  return { reference: raw.reference, status: raw.status, amountKobo: raw.amountKobo, towingJobId: raw.towingJobId };
}
