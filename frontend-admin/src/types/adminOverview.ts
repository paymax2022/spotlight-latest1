/**
 * Cross-module operations overview — the shape of GET /api/v1/admin/overview.
 *
 * `value: number | null` is the important part of this contract. null means the
 * backend could not answer for that module (table absent on a partially migrated
 * environment, permission denied, query timeout). It is NOT zero, and the UI must
 * never render it as zero: "nothing to do" and "we could not look" are opposite
 * messages, and an operations console that conflates them is lying to whoever is
 * on call.
 */
export type OverviewValue = {
  label: string;
  value: number | null;
};

export type OverviewAttention = OverviewValue & {
  /** Deep link to the filtered queue, not just the module's home page. */
  href: string;
  /** critical = money or compliance is blocked; warn = content/ops backlog. */
  severity: 'critical' | 'warn';
};

export type OverviewModule = {
  key: string;
  label: string;
  group: string;
  href: string;
  volume: OverviewValue;
  attention: OverviewAttention;
};

export type AdminOverview = {
  generated_at: string;
  modules: OverviewModule[];
};
