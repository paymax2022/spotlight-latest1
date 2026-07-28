// ── Association — Support constants (W) ───────────────────────────────────────

import { Colors } from '@/constants/colors';
import type { TicketStatus, TicketCategory } from '../types/settings.types';

export const TICKET_STATUS_STYLE: Record<TicketStatus, { label: string; color: string; bg: string }> = {
  OPEN:        { label: 'Open',        color: Colors.gold,      bg: Colors.iconBgGold },
  IN_PROGRESS: { label: 'In progress', color: Colors.secondary, bg: Colors.iconBgBlue },
  RESOLVED:    { label: 'Resolved',    color: Colors.teal,      bg: Colors.iconBgTeal },
};

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  MEMBERSHIP: 'Membership',
  PAYMENT:    'Payment',
  TECHNICAL:  'Technical',
  OTHER:      'Other',
};

export const TICKET_CATEGORY_OPTIONS: TicketCategory[] = ['MEMBERSHIP', 'PAYMENT', 'TECHNICAL', 'OTHER'];
