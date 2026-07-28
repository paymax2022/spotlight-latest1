'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import type { OnboardingQueueRow, OnboardingQueueFilters } from '@/types/onboarding';
import { listReviewQueue, ageFromNow, slaBreached } from '@/services/onboardingService';
import { StatusBadge, RiskBadge } from './statusBadge';

const STATUS_OPTIONS = ['', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO', 'APPROVED', 'REJECTED'];
const MODULE_OPTIONS = [
  ['', 'All modules'],
  ['restaurant', 'Restaurant Delivery'],
  ['transport', 'Transport'],
  ['estate', 'Estate'],
  ['telemedicine', 'Telemedicine'],
  ['crowdfunding', 'Crowdfunding'],
  ['events', 'Events'],
];
const TYPE_OPTIONS = [
  ['', 'All types'],
  ['food_vendor', 'Food Vendor'],
  ['fleet_operator', 'Fleet Operator'],
  ['estate_manager', 'Estate Manager'],
  ['health_provider', 'Health Provider'],
];
const AGE_OPTIONS = [
  ['', 'Any age'],
  ['1d', 'Older than 1 day'],
  ['3d', 'Older than 3 days (SLA)'],
  ['7d', 'Older than 7 days'],
];

const defaultFilters: OnboardingQueueFilters = { module: '', type: '', status: '', age: '' };

export default function MerchantOnboardingQueuePage() {
  const [filters, setFilters] = useState<OnboardingQueueFilters>(defaultFilters);
  const [rows, setRows] = useState<OnboardingQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listReviewQueue(filters));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1>Merchant Onboarding</h1>
      <p>Review queue for merchant onboarding applications across modules.</p>
      {error ? <p style={{ color: 'salmon' }}>{error}</p> : null}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginTop: 12 }}>
        <select value={filters.module} onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))}>
          {MODULE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
          {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          {STATUS_OPTIONS.map((v) => <option key={v} value={v}>{v ? v.replace(/_/g, ' ') : 'All statuses'}</option>)}
        </select>
        <select value={filters.age} onChange={(e) => setFilters((f) => ({ ...f, age: e.target.value }))}>
          {AGE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Apply Filters'}</button>
        <button onClick={() => setFilters(defaultFilters)} disabled={loading}>Reset</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{rows.length} application(s)</span>
      </div>

      {!loading && rows.length === 0 ? (
        <p style={{ opacity: 0.6, marginTop: 24 }}>No applications match the current filters.</p>
      ) : null}

      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 16 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', textAlign: 'left' }}>
              {['Applicant', 'Module', 'Merchant Type', 'Status', 'Age / SLA', 'Risk', ''].map((h) => (
                <th key={h} style={{ padding: '8px 6px', fontWeight: 600, opacity: 0.8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ref = r.submittedAt ?? r.createdAt;
              const breached = slaBreached(r.submittedAt);
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #1c1c1c' }}>
                  <td style={{ padding: '8px 6px' }}>
                    <Link href={`/admin/merchant-onboarding/${r.id}`}>
                      <strong>{r.applicantName}</strong>
                    </Link>
                    <div style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>{r.id}</div>
                  </td>
                  <td style={{ padding: '8px 6px' }}>{r.moduleName}</td>
                  <td style={{ padding: '8px 6px' }}>{r.merchantTypeName}</td>
                  <td style={{ padding: '8px 6px' }}><StatusBadge status={r.status} /></td>
                  <td style={{ padding: '8px 6px' }}>
                    {ageFromNow(ref)}
                    {breached ? <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>● SLA breach</span> : null}
                  </td>
                  <td style={{ padding: '8px 6px' }}><RiskBadge level={r.riskLevel} /></td>
                  <td style={{ padding: '8px 6px' }}>
                    <Link href={`/admin/merchant-onboarding/${r.id}`}>Review →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
