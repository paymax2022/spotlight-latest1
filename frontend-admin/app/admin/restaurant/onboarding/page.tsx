'use client';

import { useCallback, useEffect, useState } from 'react';
import { listApplications, decideApplication } from '@/services/restaurantAdminService';
import type { RestaurantApplication, OnboardingStatus } from '@/types/restaurantAdmin';
import {
  PageHeader,
  Card,
  Kpi,
  Badge,
  btn,
  th,
  td,
  RESTAURANT_PERMS,
  useRestaurantPermissions,
  AccessNotice,
} from '../_ui';

const STATUSES: (OnboardingStatus | '')[] = ['', 'pending', 'in_review', 'approved', 'rejected', 'suspended'];

const STATUS_BADGE: Record<OnboardingStatus, string> = {
  pending: 'placed',
  in_review: 'preparing',
  approved: 'delivered',
  rejected: 'no_rider',
  suspended: 'cancelled',
};

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
      <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
        <PageHeader title="Restaurant Onboarding" />
        <AccessNotice perm="restaurant.manage / restaurant.admin.onboarding" />
      </div>
    );
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader
        title="Restaurant Onboarding / KYC"
        subtitle="Review merchant applications and approve or reject KYC. Reject requires a reviewer note."
        action={<button onClick={() => void load(status)} style={btn()}>Refresh</button>}
      />

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p style={{ color: '#16a34a' }}>{message}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <Kpi label="Awaiting review" value={String(pending)} accent={pending ? '#d97706' : '#16a34a'} />
        <Kpi label="Approved" value={String(approved)} accent="#16a34a" />
        <Kpi label="Rejected" value={String(rejected)} accent="#6b7280" />
      </div>

      <div style={{ display: 'flex', gap: 6, margin: '0 0 1rem', flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            style={{ ...btn(), ...(status === s ? { background: '#340075', color: '#fff', borderColor: '#340075' } : {}) }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <Card title="Applications">
        {loading ? (
          <p style={{ color: '#6b7280' }}>Loading…</p>
        ) : apps.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No applications for this filter.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th style={th()}>Restaurant</th>
                  <th style={th()}>Owner</th>
                  <th style={th()}>Cuisine</th>
                  <th style={th()}>CAC</th>
                  <th style={th()}>Docs</th>
                  <th style={th()}>Status</th>
                  <th style={th()}>Submitted</th>
                  <th style={th()}></th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id}>
                    <td style={td()}><strong>{a.restaurant_name}</strong><div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{a.address}</div></td>
                    <td style={td()}>{a.owner_name ?? a.owner_id}<div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{a.email}</div></td>
                    <td style={td()}>{a.cuisine ?? '—'}</td>
                    <td style={td()}>{a.cac_number ?? <span style={{ color: '#dc2626' }}>missing</span>}</td>
                    <td style={td()}>{a.documents.filter((d) => d.verified).length}/{a.documents.length} verified</td>
                    <td style={td()}><Badge status={STATUS_BADGE[a.status]} label={a.status} /></td>
                    <td style={td()}>{new Date(a.submitted_at).toLocaleDateString('en-NG')}</td>
                    <td style={td()}>
                      <button onClick={() => { setSelected(a); setNote(a.review_note ?? ''); }} style={btn()}>Review</button>
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
          <Card
            title={`Review — ${selected.restaurant_name}`}
            right={<button onClick={() => { setSelected(null); setNote(''); }} style={btn()}>Close</button>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <div><span style={{ color: '#6b7280' }}>Owner</span><div>{selected.owner_name} ({selected.owner_id})</div></div>
              <div><span style={{ color: '#6b7280' }}>Phone</span><div>{selected.phone ?? '—'}</div></div>
              <div><span style={{ color: '#6b7280' }}>CAC</span><div>{selected.cac_number ?? '—'}</div></div>
              <div><span style={{ color: '#6b7280' }}>Bank</span><div>{selected.bank_name ?? '—'} · {selected.bank_account_number ?? '—'}</div></div>
              <div><span style={{ color: '#6b7280' }}>Account name</span><div>{selected.bank_account_name ?? '—'}</div></div>
            </div>

            <strong style={{ fontSize: '0.85rem' }}>Documents</strong>
            <ul style={{ margin: '0.5rem 0 1rem', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
              {selected.documents.map((d, i) => (
                <li key={i}>
                  <a href={d.url} target="_blank" rel="noreferrer">{d.label}</a>{' '}
                  {d.verified ? <Badge status="delivered" label="verified" /> : <Badge status="placed" label="unverified" />}
                </li>
              ))}
            </ul>

            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Reviewer note (required to reject)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Reason / verification notes…"
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.85rem' }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
              <button
                disabled={!canReview || busy}
                title={!canReview ? 'Requires restaurant.admin.onboarding' : 'Approve merchant'}
                onClick={() => void decide('approve')}
                style={{ ...btn(), background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}
              >
                {busy ? '…' : 'Approve'}
              </button>
              <button
                disabled={!canReview || busy || !note.trim()}
                title={!canReview ? 'Requires restaurant.admin.onboarding' : !note.trim() ? 'A note is required to reject' : 'Reject merchant'}
                onClick={() => void decide('reject')}
                style={{ ...btn(), background: '#dc2626', color: '#fff', borderColor: '#dc2626' }}
              >
                {busy ? '…' : 'Reject'}
              </button>
            </div>
            {!canReview && <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 6 }}>You lack <code>restaurant.admin.onboarding</code> — decisions are disabled. Server still enforces.</p>}
          </Card>
        </div>
      )}

      <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        Mock-first. Target routes: <code>GET /api/restaurant/admin/onboarding</code> and{' '}
        <code>POST /api/restaurant/admin/onboarding/:id/&#123;approve|reject&#125;</code> (RBAC{' '}
        <code>restaurant.admin.onboarding</code>). Flip{' '}
        <code>NEXT_PUBLIC_RESTAURANT_ADMIN_USE_MOCK=false</code> when live.
      </p>
    </div>
  );
}
