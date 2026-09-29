export function formatNaira(kobo: number | null | undefined): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Order Placed',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready for Pickup',
  picked_up: 'On the Way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Declined',
  dispatch_failed: 'No Rider Found',
  delivery_failed: 'Delivery Failed',
};

export function orderStatusLabel(status: string): string {
  return STATUS_LABEL[status] || status.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function orderStatusClass(status: string): string {
  if (status === 'delivered') return 'badge-approved';
  if (status === 'cancelled' || status === 'rejected' || status === 'dispatch_failed' || status === 'delivery_failed') return 'badge-rejected';
  if (status === 'pending') return 'badge-paid';
  return 'badge-pending';
}
