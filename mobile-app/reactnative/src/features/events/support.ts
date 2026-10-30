// Support desk display helpers shared by app/events/support/*. Pure: no I/O.
import type { SupportCaseKind } from './types';

export const SUPPORT_KINDS: SupportCaseKind[] = ['TICKET', 'PAYMENT', 'REFUND', 'CHECKIN', 'CONDUCT', 'OTHER'];

export const SUPPORT_KIND_LABEL: Record<string, string> = {
  TICKET: 'Ticket',
  PAYMENT: 'Payment',
  REFUND: 'Refund',
  CHECKIN: 'Check-in',
  CONDUCT: 'Conduct',
  OTHER: 'Other',
};

// A deep link may carry any string in ?kind=; only a known kind preselects.
export function parseSupportKind(raw: string | undefined): SupportCaseKind | null {
  const k = (raw ?? '').toUpperCase();
  return (SUPPORT_KINDS as string[]).includes(k) ? (k as SupportCaseKind) : null;
}

// Mirrors support_service.go Reply: only a CLOSED case refuses replies
// (ErrCaseTerminal). A RESOLVED case still accepts one, which is how a customer
// says "this isn't actually fixed".
export function canReplyToCase(status: string): boolean {
  return status !== 'CLOSED';
}
