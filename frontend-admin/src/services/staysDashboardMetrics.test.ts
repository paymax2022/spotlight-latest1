// @vitest-environment node
/**
 * The Go dashboard returns 0 for metrics it has no source for (reconciliation
 * breaks) and names them in `unavailable_metrics`. The page must treat those as
 * "not available", not as a measured zero: showing "0 breaks" on a dashboard
 * that cannot see breaks is a false all-clear.
 */
import { describe, it, expect } from 'vitest';
import { isMetricUnavailable, UNAVAILABLE_LABEL } from './staysDashboardMetrics';

describe('isMetricUnavailable', () => {
  it('is true only for metrics the backend names', () => {
    const d = { unavailable_metrics: ['reconciliation_breaks_open', 'reconciliation_break_value_kobo'] };
    expect(isMetricUnavailable(d, 'reconciliation_breaks_open')).toBe(true);
    expect(isMetricUnavailable(d, 'reconciliation_break_value_kobo')).toBe(true);
    expect(isMetricUnavailable(d, 'refunds_pending')).toBe(false);
  });

  it('treats a missing or malformed list as nothing unavailable (fixture mode, older backend)', () => {
    expect(isMetricUnavailable({}, 'reconciliation_breaks_open')).toBe(false);
    expect(isMetricUnavailable({ unavailable_metrics: undefined }, 'x')).toBe(false);
    expect(isMetricUnavailable({ unavailable_metrics: null as unknown as string[] }, 'x')).toBe(false);
  });

  it('exposes the label the tile shows', () => {
    expect(UNAVAILABLE_LABEL).toBe('Not available');
  });
});
