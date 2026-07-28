// ── Paymax Health — Pharmacy presentation constants ──────────────────────────
// Status → label/colour maps for Rx and order state. Resolve all colours through
// the design tokens; never hardcode hex in screens.

import { Colors } from '@/constants/colors';
import type { OrderStatus, RxStatus, ProductCategory } from './types';

export const RX_STATUS_META: Record<RxStatus, { label: string; color: string; bg: string; icon: string }> = {
  verifying: { label: 'Verifying', color: Colors.onWarning, bg: Colors.iconBgGold, icon: 'Clock' },
  verified: { label: 'Verified', color: Colors.teal, bg: Colors.iconBgTeal, icon: 'BadgeCheck' },
  rejected: { label: 'Rejected', color: Colors.error, bg: Colors.errorContainer, icon: 'CircleX' },
  clarification: { label: 'Needs info', color: Colors.onWarning, bg: Colors.iconBgGold, icon: 'CircleAlert' },
  dispensed: { label: 'Dispensed', color: Colors.secondary, bg: Colors.iconBgBlue, icon: 'PackageCheck' },
};

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  created: { label: 'Placed', color: Colors.secondary, bg: Colors.iconBgBlue },
  rx_pending: { label: 'Awaiting Rx', color: Colors.onWarning, bg: Colors.iconBgGold },
  confirmed: { label: 'Confirmed', color: Colors.secondary, bg: Colors.iconBgBlue },
  dispensed: { label: 'Dispensed', color: Colors.secondary, bg: Colors.iconBgBlue },
  in_delivery: { label: 'Out for delivery', color: Colors.secondary, bg: Colors.iconBgBlue },
  ready_for_pickup: { label: 'Ready for pickup', color: Colors.teal, bg: Colors.iconBgTeal },
  delivered: { label: 'Delivered', color: Colors.teal, bg: Colors.iconBgTeal },
  collected: { label: 'Collected', color: Colors.teal, bg: Colors.iconBgTeal },
  closed: { label: 'Closed', color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  cancelled: { label: 'Cancelled', color: Colors.error, bg: Colors.errorContainer },
  refunded: { label: 'Refunded', color: Colors.error, bg: Colors.errorContainer },
};

export const CATEGORY_OPTIONS: { value: ProductCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'otc', label: 'OTC' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'first_aid', label: 'First aid' },
  { value: 'baby', label: 'Baby' },
  { value: 'devices', label: 'Devices' },
];

// HL-9 messaging surfaced at checkout: money is held, released on completion.
export const PAYMENT_HELD_COPY =
  'Your payment is held securely and only released to the pharmacy once your order is delivered or collected. It is refunded if the order is cancelled.';

// Health-BNPL is OFF by default (HEALTH-BUILD §4 — triggers the FCCPC DEON regime;
// must be partner-powered and separately approved). The bnpl screen renders a
// placeholder while this remains false.
export const PHARMACY_BNPL_ENABLED =
  (process.env.EXPO_PUBLIC_HEALTH_PHARMACY_BNPL ?? 'false') === 'true';
