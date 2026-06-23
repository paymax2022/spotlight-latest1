'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createStemSchool, listStemSchools, updateStemSchoolVerification } from '@/services/stemService';
import type { StemSchool } from '@/types/stem';

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
    <section>
      <h1>Schools</h1>
      <p>School onboarding and participation snapshot from STEM applications.</p>
      {error ? <p style={{ marginTop: 8, color: '#fca5a5' }}>{error}</p> : null}
      <div style={{ border: '1px solid #2a2a2a', padding: 12, marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>Create School Onboarding Record</h2>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} placeholder="School name" />
          <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
          <input value={officialEmail} onChange={(e) => setOfficialEmail(e.target.value)} placeholder="Official email" />
        </div>
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={saving}
          style={{ marginTop: 10, border: '1px solid #2a2a2a', padding: '6px 12px' }}
        >
          {saving ? 'Creating...' : 'Create School'}
        </button>
      </div>
      {loading ? <p style={{ marginTop: 12 }}>Loading schools...</p> : null}
      <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
        {!loading && rows.length === 0 ? <p>No schools found yet.</p> : null}
        {rows.map((row) => (
          <article key={`${row.id || row.name}-${row.state}`} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
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
          </article>
        ))}
      </div>
    </section>
  );
}
