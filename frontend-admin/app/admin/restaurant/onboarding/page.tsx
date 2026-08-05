'use client';

import { useCallback, useEffect, useState } from 'react';
import { listApplications, decideApplication } from '@/services/restaurantAdminService';
import type { RestaurantApplication, OnboardingStatus } from '@/types/restaurantAdmin';
import { RESTAURANT_PERMS, useRestaurantPermissions, AccessNotice } from '../_ui';
import { Page, PageHeader, Card, Button, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUSES: (OnboardingStatus | '')[] = ['', 'pending', 'in_review', 'approved', 'rejected', 'suspended'];

const STATUS_COLOR: Record<string, string> = {
  pending: colors.warning,
  in_review: colors.warning,
  approved: colors.success,
  rejected: colors.danger,
  suspended: colors.secondary,
  verified: colors.success,
  unverified: colors.warning,
};

function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge text={label ?? status} color={STATUS_COLOR[status] ?? colors.secondary} />;
}

function KpiTile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? colors.text, marginTop: 4 }}>{value}</div>
    </Card>
  );
}

export default function OnboardingReviewPage() {
  const { can } = useRestaurantPermissions();
  const canView = can(RESTAURANT_PERMS.manage) || can(RESTAURANT_PERMS.onboarding);
  const canReview = can(RESTAURANT_PERMS.onboarding);

  const [apps, setApps] = useState<RestaurantApplication[]>([]);
  const [status, setStatus] = useState<OnboardingStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<RestaurantApplication | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (s: OnboardingStatus | '') => {
    setLoading(true);
    setError(null);
    try {
      setApps(await listApplications(s));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  async function decide(decision: 'approve' | 'reject') {
    if (!selected) return;
    if (decision === 'reject' && !note.trim()) {
      setError('A reviewer note is required to reject an application.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await decideApplication(selected.id, decision, note);
      setMessage(`Application ${selected.restaurant_name} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      setSelected(null);
      setNote('');
      await load(status);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const pending = apps.filter((a) => a.status === 'pending' || a.status === 'in_review').length;
  const approved = apps.filter((a) => a.status === 'approved').length;
  const rejected = apps.filter((a) => a.status === 'rejected').length;

  if (!canView) {
    return (
      <Page>
        <PageHeader title="Restaurant Onboarding" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.onboarding" />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Restaurant Onboarding / KYC"
        subtitle="Review merchant applications and approve or reject KYC. Reject requires a reviewer note."
        actions={<Button variant="outline" onClick={() => void load(status)}>Refresh</Button>}
      />

      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {message && <p style={{ color: colors.success }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <KpiTile label="Awaiting review" value={String(pending)} accent={pending ? colors.warning : colors.success} />
        <KpiTile label="Approved" value={String(approved)} accent={colors.success} />
        <KpiTile label="Rejected" value={String(rejected)} accent={colors.muted} />
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Button
            key={s || 'all'}
            sm
            variant={status === s ? 'primary' : 'outline'}
            onClick={() => setStatus(s)}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      <Card title="Applications">
        {loading ? (
          <p style={{ color: colors.muted }}>Loading…</p>
        ) : apps.length === 0 ? (
          <p style={{ color: colors.muted }}>No applications for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={thCell}>Restaurant</th>
                  <th style={thCell}>Owner</th>
                  <th style={thCell}>Cuisine</th>
                  <th style={thCell}>CAC</th>
                  <th style={thCell}>Docs</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell}>Submitted</th>
                  <th style={thCell}></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td style={tdCell}><strong>{a.restaurant_name}</strong><div style={{ color: colors.muted, fontSize: '0.75rem' }}>{a.address}</div></td>
                    <td style={tdCell}>{a.owner_name ?? a.owner_id}<div style={{ color: colors.muted, fontSize: '0.75rem' }}>{a.email}</div></td>
                    <td style={tdCell}>{a.cuisine ?? '—'}</td>
                    <td style={tdCell}>{a.cac_number ?? <span style={{ color: colors.danger }}>missing</span>}</td>
                    <td style={tdCell}>{a.documents.filter((d) => d.verified).length}/{a.documents.length} verified</td>
                    <td style={tdCell}><StatusBadge status={a.status} label={a.status} /></td>
                    <td style={tdCell}>{new Date(a.submitted_at).toLocaleDateString('en-NG')}</td>
                    <td style={tdCell}>
                      <Button sm variant="outline" onClick={() => { setSelected(a); setNote(a.review_note ?? ''); }}>Review</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <div style={{ marginTop: '1.25rem' }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ fontSize: 16 }}>Review — {selected.restaurant_name}</strong>
              <Button sm variant="outline" onClick={() => { setSelected(null); setNote(''); }}>Close</Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <div><span style={{ color: colors.muted }}>Owner</span><div>{selected.owner_name} ({selected.owner_id})</div></div>
              <div><span style={{ color: colors.muted }}>Phone</span><div>{selected.phone ?? '—'}</div></div>
              <div><span style={{ color: colors.muted }}>CAC</span><div>{selected.cac_number ?? '—'}</div></div>
              <div><span style={{ color: colors.muted }}>Bank</span><div>{selected.bank_name ?? '—'} · {selected.bank_account_number ?? '—'}</div></div>
              <div><span style={{ color: colors.muted }}>Account name</span><div>{selected.bank_account_name ?? '—'}</div></div>
            </div>

            <strong style={{ fontSize: '0.85rem' }}>Documents</strong>
            <ul style={{ margin: '0.5rem 0 1rem', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
              {selected.documents.map((d, i) => (
                <li key={i}>
                  <a href={d.url} target="_blank" rel="noreferrer">{d.label}</a>{' '}
                  {d.verified ? <StatusBadge status="verified" label="verified" /> : <StatusBadge status="unverified" label="unverified" />}
                </li>
              ))}
            </ul>

            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Reviewer note (required to reject)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Reason / verification notes…"
              style={{ width: '100%', padding: '0.5rem', border: `1px solid ${colors.inputBorder}`, borderRadius: '0.375rem', fontSize: '0.85rem' }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
              <Button
                variant="primary"
                disabled={!canReview || busy}
                title={!canReview ? 'Requires restaurant.admin.onboarding' : 'Approve merchant'}
                onClick={() => void decide('approve')}
              >
                {busy ? '…' : 'Approve'}
              </Button>
              <Button
                variant="danger"
                disabled={!canReview || busy || !note.trim()}
                title={!canReview ? 'Requires restaurant.admin.onboarding' : !note.trim() ? 'A note is required to reject' : 'Reject merchant'}
                onClick={() => void decide('reject')}
              >
                {busy ? '…' : 'Reject'}
              </Button>
            </div>
            {!canReview && <p style={{ fontSize: '0.78rem', color: colors.muted, marginTop: 6 }}>You lack <code>restaurant.admin.onboarding</code> — decisions are disabled. Server still enforces.</p>}
          </Card>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: colors.muted }}>
        Mock-first. Target routes: <code>GET /api/restaurant/admin/onboarding</code> and{' '}
        <code>POST /api/restaurant/admin/onboarding/:id/&#123;approve|reject&#125;</code> (RBAC{' '}
        <code>restaurant.admin.onboarding</code>). Flip{' '}
        <code>NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false</code> when live.
      </p>
    </Page>
  );
}
