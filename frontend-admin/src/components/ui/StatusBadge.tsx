import { colors } from '@/components/ui/vuexy';

// Real per-module statuses use each module's own vocabulary (e.g. insurance's
// ACTIVE/CANCELLED/PAYMENT_FAILED, an fx_conversions status, a boost_status,
// a utility_transactions status) — never the generic ledger Posted/Reversed
// styling. This is a best-effort semantic grouping across all of them so the
// badge color is still meaningful without hard-coding every module's exact
// value set. Shared between the Transactions list and detail views.
export function statusBadgeColor(status: string): string {
  const s = status.toUpperCase();
  if (['ACTIVE', 'COMPLETED', 'SUCCESSFUL', 'POSTED', 'PURCHASED'].includes(s)) return colors.success;
  if (['FAILED', 'CANCELLED', 'CANCELLED_BY_SELLER', 'REJECTED_WITH_REASON', 'VOID', 'BIND_FAILED', 'PAYMENT_FAILED', 'REVERSED', 'DISPUTED', 'EXPIRED'].includes(s)) return colors.danger;
  if (['PENDING', 'PENDING_PAYMENT', 'BINDING', 'QUOTED', 'INITIATED', 'WALLET_DEBITED', 'PROVIDER_PENDING', 'RENEWAL_DUE', 'AUTO_REFUNDED'].includes(s)) return colors.warning;
  return colors.muted;
}

export function StatusBadge({ status }: { status: string }) {
  const color = statusBadgeColor(status);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        color,
        background: `${color}22`,
        border: `1px solid ${color}55`,
      }}
    >
      {status}
    </span>
  );
}
