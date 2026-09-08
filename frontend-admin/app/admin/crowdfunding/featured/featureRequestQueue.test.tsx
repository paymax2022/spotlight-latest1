/**
 * The queue must never present an action that is guaranteed to fail.
 *
 * Approving a feature request sets the campaign's `featured` flag, and the backend
 * refuses that with 409 on any non-ACTIVE campaign. An operator clicking Approve on
 * a FROZEN campaign and getting a 409 back learns nothing about why; the gate has
 * to be visible in the row, with the reason, before the click.
 *
 * These tests pin that gate, the note capture on reject, and the rule that an
 * unreachable queue must never render as an empty one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CfFeatureRequest } from '@/types/crowdfunding';
import FeatureRequestQueue from './_FeatureRequestQueue';

const makeRequest = (o: Partial<CfFeatureRequest> = {}): CfFeatureRequest => ({
  id: 'fr1',
  campaignId: 'cmp1',
  campaignTitle: 'Borehole for Amaeze',
  status: 'PENDING',
  campaignStatus: 'ACTIVE',
  raisedKobo: 168_300_000,
  goalKobo: 240_000_000,
  contributorCount: 311,
  requestedBy: 'Chinedu Okafor',
  requestedAt: '2026-06-20T08:15:00Z',
  note: null,
  decidedAt: null,
  ...o,
});

function renderQueue(requests: CfFeatureRequest[], props: Partial<React.ComponentProps<typeof FeatureRequestQueue>> = {}) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const onRetry = vi.fn();
  render(
    <FeatureRequestQueue
      requests={requests}
      loading={false}
      loadError={null}
      busyKey={null}
      errors={{}}
      onApprove={onApprove}
      onReject={onReject}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onApprove, onReject, onRetry };
}

// This project wires no jest-dom setup file, so assert on the DOM property directly
// rather than reaching for toBeDisabled().
const approveButton = () => screen.getByRole('button', { name: /approve & feature/i }) as HTMLButtonElement;
const rejectButton = () => screen.getByRole('button', { name: /^reject$/i }) as HTMLButtonElement;

describe('FeatureRequestQueue — approval gating', () => {
  it('enables approval for an ACTIVE campaign', () => {
    const { onApprove } = renderQueue([makeRequest()]);
    expect(approveButton().disabled).toBe(false);
    fireEvent.click(approveButton());
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('gates approval for a FROZEN campaign and says why', () => {
    const { onApprove } = renderQueue([makeRequest({ campaignStatus: 'FROZEN' })]);
    expect(approveButton().disabled).toBe(true);
    expect(screen.getByText(/is FROZEN, not ACTIVE/i)).toBeTruthy();
    fireEvent.click(approveButton());
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('gates approval when the campaign status is UNKNOWN rather than guessing ACTIVE', () => {
    renderQueue([makeRequest({ campaignStatus: 'UNKNOWN' })]);
    expect(approveButton().disabled).toBe(true);
    expect(screen.getByText(/status is missing/i)).toBeTruthy();
  });

  it('still allows rejection of a request whose campaign is not ACTIVE', () => {
    renderQueue([makeRequest({ campaignStatus: 'PENDING_REVIEW' })]);
    expect(rejectButton().disabled).toBe(false);
  });
});

describe('FeatureRequestQueue — rejection captures a note', () => {
  it('requires a note before the rejection can be confirmed', () => {
    const { onReject } = renderQueue([makeRequest()]);
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));

    const confirm = screen.getByRole('button', { name: /confirm rejection/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onReject).not.toHaveBeenCalled();
  });

  it('passes the trimmed note up on confirmation', () => {
    const { onReject } = renderQueue([makeRequest()]);
    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    fireEvent.change(screen.getByLabelText(/reason for rejection/i), { target: { value: '  too early  ' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm rejection/i }));

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onReject.mock.calls[0][1]).toBe('too early');
  });
});

describe('FeatureRequestQueue — rendering', () => {
  it('formats kobo as naira without float maths', () => {
    renderQueue([makeRequest({ raisedKobo: 168_300_050, goalKobo: 240_000_000 })]);
    expect(screen.getByText(/₦1,683,000\.50 of ₦2,400,000/)).toBeTruthy();
  });

  it('shows a server refusal verbatim on the row', () => {
    renderQueue([makeRequest()], { errors: { fr1: 'campaign is not ACTIVE' } });
    expect(screen.getByText(/nothing changed: campaign is not ACTIVE/i)).toBeTruthy();
  });

  it('an unreachable queue reports the failure instead of looking empty', () => {
    renderQueue([], { loadError: 'Feature requests failed: 404' });
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/No pending feature requests/i)).toBeNull();
  });

  it('a genuinely empty queue says so', () => {
    renderQueue([]);
    expect(screen.getByText(/No pending feature requests/i)).toBeTruthy();
  });

  it('keeps decided requests out of the pending list', () => {
    renderQueue([
      makeRequest({ id: 'fr1' }),
      makeRequest({ id: 'fr2', status: 'REJECTED', campaignTitle: 'Old ask', note: 'too early' }),
    ]);
    expect(screen.getByText(/1 pending/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /show 1 decided request/i })).toBeTruthy();
    expect(screen.queryByText('Old ask')).toBeNull();
  });
});
