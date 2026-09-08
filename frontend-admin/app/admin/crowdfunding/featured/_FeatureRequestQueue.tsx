'use client';

// ── Crowdfunding — owner feature-request queue ───────────────────────────────
//
// Featuring is deliberately not self-serve: `featured` is an editorial placement on
// the public discovery rail, so a campaign owner can only REQUEST it. (Un-featuring
// needs no approval, which is why this queue only ever grants placement.)
//
// PRESENTATIONAL ONLY. The page owns the data, the writes and the refetch, so this
// component can never show a state the server did not return — it has no way to
// mutate a request. The only state it keeps is which row has its reject panel open
// and what has been typed into it.

import { useState } from 'react';
import type { CfFeatureRequest, CfFeatureRequestCampaignStatus } from '@/types/crowdfunding';
import { Card, Button, Badge, colors, tint } from '@/components/ui/vuexy';

const CAMPAIGN_STATUS_BADGE: Record<CfFeatureRequestCampaignStatus, string> = {
  ACTIVE: colors.success,
  PENDING_REVIEW: colors.warning,
  CHANGES_REQUESTED: colors.warning,
  COMPLETED: colors.info,
  FROZEN: colors.danger,
  REJECTED: colors.muted,
  UNKNOWN: colors.muted,
};

/**
 * Why an approval cannot be attempted, or null when it can.
 *
 * Approving sets the campaign's `featured` flag, and the backend refuses that with
 * 409 on any non-ACTIVE campaign — so the button is gated rather than offered and
 * left to fail. UNKNOWN is gated too: we cannot prove the campaign is ACTIVE, and
 * guessing here is what would turn a payload change into a stream of 409s.
 */
function approvalBlockedReason(r: CfFeatureRequest): string | null {
  if (r.campaignStatus === 'ACTIVE') return null;
  if (r.campaignStatus === 'UNKNOWN') {
    return 'The campaign status is missing from this request, so it cannot be confirmed ACTIVE. Approving would be refused.';
  }
  return `The campaign is ${r.campaignStatus}, not ACTIVE — only a live campaign can be featured, so approving would be refused.`;
}

// Money is integer kobo. Integer division/modulo only — never float maths.
function naira(kobo: number): string {
  const sign = kobo < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(kobo));
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  return `${sign}₦${major.toLocaleString('en-NG')}${minor ? `.${String(minor).padStart(2, '0')}` : ''}`;
}

function pctOfGoal(raisedKobo: number, goalKobo: number): number {
  if (goalKobo <= 0) return 0;
  return Math.min(100, Math.trunc((raisedKobo * 100) / goalKobo));
}

function when(iso: string): string {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export type FeatureRequestQueueProps = {
  requests: CfFeatureRequest[];
  loading: boolean;
  /** Queue-level load failure. An empty queue and an unreachable one must not look alike. */
  loadError: string | null;
  /** `${id}:approve` / `${id}:reject` while that write is in flight. */
  busyKey: string | null;
  /** Server errors keyed by request id — rendered verbatim on the row. */
  errors: Record<string, string>;
  onApprove: (r: CfFeatureRequest) => void;
  onReject: (r: CfFeatureRequest, note: string) => void;
  onRetry: () => void;
};

export default function FeatureRequestQueue({
  requests, loading, loadError, busyKey, errors, onApprove, onReject, onRetry,
}: FeatureRequestQueueProps) {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showDecided, setShowDecided] = useState(false);

  const pending = requests.filter((r) => r.status === 'PENDING');
  const decided = requests.filter((r) => r.status !== 'PENDING');

  function openReject(id: string) {
    setRejectingId(id);
    setNote('');
  }

  function submitReject(r: CfFeatureRequest) {
    const trimmed = note.trim();
    if (!trimmed) return;
    setRejectingId(null);
    setNote('');
    onReject(r, trimmed);
  }

  return (
    <Card
      title={`Feature requests${pending.length ? ` · ${pending.length} pending` : ''}`}
      style={{ marginBottom: '1.25rem', borderColor: pending.length ? tint(colors.warning, 0.45) : colors.border }}
    >
      <p style={{ color: colors.muted, fontSize: 12, margin: '4px 0 0' }}>
        Campaign owners request the featured slot; approving here sets the campaign&apos;s
        featured flag. Owners can remove themselves from the rail without asking, so this
        queue only ever grants placement.
      </p>

      {loading ? (
        <p style={{ color: colors.muted, fontSize: 13, marginTop: '0.75rem' }}>Loading…</p>
      ) : loadError ? (
        // Never let an unreachable queue read as an empty one — that is how pending
        // work goes unnoticed.
        <div style={{ marginTop: '0.75rem' }}>
          <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>
            The feature-request queue could not be loaded, so pending requests are not shown here: {loadError}
          </p>
          <Button sm variant="outline" style={{ marginTop: '0.5rem' }} onClick={onRetry}>Retry</Button>
        </div>
      ) : pending.length === 0 ? (
        <p style={{ color: colors.muted, fontSize: 13, margin: '0.75rem 0 0' }}>
          No pending feature requests — nothing is waiting on an editorial decision.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.9rem' }}>
          {pending.map((r) => {
            const blocked = approvalBlockedReason(r);
            const rowError = errors[r.id];
            const approveBusy = busyKey === `${r.id}:approve`;
            const rejectBusy = busyKey === `${r.id}:reject`;
            const anyBusy = approveBusy || rejectBusy;
            return (
              <div
                key={r.id}
                style={{
                  border: `1px solid ${rowError ? tint(colors.danger, 0.5) : colors.border}`,
                  borderRadius: 8,
                  padding: '0.85rem 1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ flex: '1 1 22rem', minWidth: '16rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <Badge text={r.campaignStatus} color={CAMPAIGN_STATUS_BADGE[r.campaignStatus] ?? colors.muted} />
                      <span style={{ fontSize: 11, color: colors.muted }}>request {r.id}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{r.campaignTitle}</div>
                    <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                      {naira(r.raisedKobo)} of {naira(r.goalKobo)} ({pctOfGoal(r.raisedKobo, r.goalKobo)}%) ·{' '}
                      {r.contributorCount.toLocaleString('en-NG')} backers
                    </div>
                    <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      Requested by {r.requestedBy} · {when(r.requestedAt)}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <Button
                        sm
                        variant="primary"
                        disabled={!!blocked || anyBusy}
                        title={blocked ?? 'Approve this request and feature the campaign'}
                        style={blocked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                        onClick={() => onApprove(r)}
                      >
                        {approveBusy ? '…' : 'Approve & feature'}
                      </Button>
                      <Button
                        sm
                        variant="danger"
                        disabled={anyBusy}
                        onClick={() => (rejectingId === r.id ? setRejectingId(null) : openReject(r.id))}
                      >
                        {rejectBusy ? '…' : 'Reject'}
                      </Button>
                    </div>
                    {blocked && (
                      <span style={{ fontSize: 11, color: colors.muted, textAlign: 'right', maxWidth: '22rem' }}>
                        {blocked} Rejecting it is still allowed.
                      </span>
                    )}
                  </div>
                </div>

                {rejectingId === r.id && (
                  <div style={{ marginTop: '0.75rem', borderTop: `1px solid ${colors.border}`, paddingTop: '0.75rem' }}>
                    <label htmlFor={`reject-note-${r.id}`} style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
                      Reason for rejection (sent to the owner)
                    </label>
                    <textarea
                      id={`reject-note-${r.id}`}
                      className="vx-input"
                      rows={3}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="e.g. Below the traction bar for the discovery rail — reapply past 25% of goal."
                      style={{ width: '100%', marginTop: 6, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      <Button sm variant="outline" onClick={() => { setRejectingId(null); setNote(''); }}>
                        Cancel
                      </Button>
                      <Button
                        sm
                        variant="danger"
                        disabled={!note.trim() || anyBusy}
                        title={note.trim() ? 'Reject this request' : 'A reason is required'}
                        onClick={() => submitReject(r)}
                      >
                        Confirm rejection
                      </Button>
                    </div>
                  </div>
                )}

                {rowError && (
                  <p style={{ color: colors.danger, fontSize: 12, margin: '0.6rem 0 0' }}>
                    Decision rejected — nothing changed: {rowError}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {decided.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <Button sm variant="outline" onClick={() => setShowDecided((v) => !v)}>
            {showDecided ? 'Hide' : 'Show'} {decided.length} decided request{decided.length === 1 ? '' : 's'}
          </Button>
          {showDecided && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
              {decided.map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', flexWrap: 'wrap', fontSize: 12 }}>
                  <Badge text={r.status} color={r.status === 'APPROVED' ? colors.success : colors.muted} />
                  <div style={{ flex: '1 1 18rem', minWidth: '14rem' }}>
                    <div style={{ color: colors.text }}>{r.campaignTitle}</div>
                    <div style={{ color: colors.muted, marginTop: 2 }}>
                      {r.requestedBy} · requested {when(r.requestedAt)}
                      {r.decidedAt ? ` · decided ${when(r.decidedAt)}` : ''}
                    </div>
                    {r.note && <div style={{ color: colors.muted, marginTop: 2, fontStyle: 'italic' }}>“{r.note}”</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
