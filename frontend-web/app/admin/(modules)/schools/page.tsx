'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createStemSchool, listStemSchools, updateStemSchoolVerification } from '@/services/stemService';
import type { StemSchool } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function AdminSchoolsPage() {
  const [rows, setRows] = useState<StemSchool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [state, setState] = useState('');
  const [officialEmail, setOfficialEmail] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const data = await listStemSchools(150);
    setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async () => {
    if (!schoolName.trim()) {
      setError('School name is required.');
      return;
    }
    setSaving(true);
    setError('');
    const created = await createStemSchool({
      schoolName: schoolName.trim(),
      state: state.trim(),
      officialEmail: officialEmail.trim(),
      country: 'Nigeria',
    });
    setSaving(false);
    if (!created) {
      setError('Could not create school onboarding record.');
      return;
    }
    setSchoolName('');
    setState('');
    setOfficialEmail('');
    await load();
  };

  const onUpdateStatus = async (id: string, status: string) => {
    await updateStemSchoolVerification(id, status);
    await load();
  };

  return (
    <Page>
      <PageHeader title="Schools" subtitle="School onboarding and participation snapshot from STEM applications." />
      {error ? <p style={{ marginTop: 8, color: colors.danger }}>{error}</p> : null}
      <Card title="Create School Onboarding Record" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0,1fr))', marginTop: 14 }}>
          <Input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="School name" />
          <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
          <Input value={officialEmail} onChange={(e) => setOfficialEmail(e.target.value)} placeholder="Official email" />
        </div>
        <Button variant="primary" style={{ marginTop: 10 }} onClick={() => void onCreate()} disabled={saving}>
          {saving ? 'Creating...' : 'Create School'}
        </Button>
      </Card>
      {loading ? <p style={{ marginTop: 12, color: colors.muted }}>Loading schools...</p> : null}
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {!loading && rows.length === 0 ? <p style={{ color: colors.muted }}>No schools found yet.</p> : null}
        {rows.map((row) => (
          <Card key={`${row.id || row.name}-${row.state}`} style={{ padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.name}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>{row.state || '-'}</p>
            <p style={{ margin: '6px 0 0 0', fontSize: 12 }}>
              Applications: {row.applications} · Submitted: {row.submittedCount} · Under Review: {row.underReviewCount} · Shortlisted: {row.shortlistedCount}
            </p>
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 12, marginRight: 8 }}>Verification:</label>
              {row.id ? (
                <select
                  value={row.verificationStatus || 'PENDING'}
                  onChange={(e) => void onUpdateStatus(row.id as string, e.target.value)}
                >
                  <option value="PENDING">PENDING</option>
                  <option value="UNDER_REVIEW">UNDER_REVIEW</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="NEEDS_MORE_INFORMATION">NEEDS_MORE_INFORMATION</option>
                </select>
              ) : (
                <span style={{ fontSize: 12 }}>{row.verificationStatus}</span>
              )}
            </div>
            {row.id ? (
              <p style={{ margin: '8px 0 0 0', fontSize: 12 }}>
                <Link href={`/admin/schools/${row.id}`}>Open School Dashboard</Link>
              </p>
            ) : null}
          </Card>
        ))}
      </div>
    </Page>
  );
}
