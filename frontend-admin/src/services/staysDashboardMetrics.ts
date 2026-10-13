// Metrics the Go dashboard cannot measure yet are returned as 0 and listed in
// `unavailable_metrics`. Callers use this to render "Not available" instead of a
// zero that would read as a measured all-clear.

export const UNAVAILABLE_LABEL = 'Not available';

export function isMetricUnavailable(
  dashboard: { unavailable_metrics?: string[] | null },
  metric: string,
): boolean {
  const list = dashboard.unavailable_metrics;
  return Array.isArray(list) && list.includes(metric);
}
