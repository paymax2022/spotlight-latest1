'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import OpenMicAuthGate from '@/components/openmic/OpenMicAuthGate';

type ApiState = {
  role?: string;
  profile?: Record<string, unknown> | null;
  applications?: Array<Record<string, unknown>>;
  submissions?: Array<Record<string, unknown>>;
};

export default function OpenMicProfilePage() {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<ApiState>({});

  async function fetchDashboard() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setState({});
      return;
    }
    const [p, a, s] = await Promise.all([
      fetch('/api/open-mic/profile', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch('/api/open-mic/applications', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch('/api/open-mic/submissions', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    ]);
    setState({
      role: p.role,
      profile: p.profile,
      applications: Array.isArray(a.applications) ? a.applications : [],
      submissions: Array.isArray(s.submissions) ? s.submissions : [],
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setState({});
  }

  useEffect(() => {
    void fetchDashboard();
  }, []);

  return (
    <main className="container py-5">
      <h1>My Open Mic Profile</h1>
      <OpenMicAuthGate nextPath="/open-mic/profile">
        <>
          <section className="p-4 border rounded bg-white mt-4">
            <div className="d-flex justify-content-between align-items-center">
              <h3 className="mb-0">Account</h3>
              <button type="button" className="btn-outline py-2 px-3 text-xs" onClick={() => void signOut()}>Sign Out</button>
            </div>
            <p className="mb-1 mt-3">Role: <strong>{state.role || 'participant'}</strong></p>
            <p className="mb-0">Email: {String((state.profile?.email as string) || '-')}</p>
            {['admin', 'super_admin', 'program_manager', 'contest_manager', 'judge', 'reviewer'].includes(String(state.role || '').toLowerCase()) ? (
              <div className="mt-3 d-flex gap-2 flex-wrap">
                <Link href="/admin" className="btn-outline py-2 px-3 text-xs">Admin Dashboard</Link>
                {['judge', 'reviewer', 'admin', 'super_admin'].includes(String(state.role || '').toLowerCase()) ? (
                  <Link href="/admin/open-mic/submissions" className="btn-outline py-2 px-3 text-xs">Review Submissions</Link>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="p-4 border rounded bg-white mt-4">
            <h3>My Applications</h3>
            {(state.applications || []).length === 0 ? <p className="mb-0">No applications yet.</p> : (
              <ul className="mb-0">
                {(state.applications || []).map((row) => (
                  <li key={String(row.id)}>{String(row.stageName || row.fullName || 'Application')} - {String(row.applicationStatus || 'pending')}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="p-4 border rounded bg-white mt-4">
            <h3>My Song Submissions</h3>
            {(state.submissions || []).length === 0 ? <p className="mb-0">No submissions yet.</p> : (
              <ul className="mb-0">
                {(state.submissions || []).map((row) => (
                  <li key={String(row.id)}>{String(row.songTitle || 'Untitled')} - {String(row.status || 'submitted')}</li>
                ))}
              </ul>
            )}
          </section>
          <div className="mt-4">
            <Link href="/open-mic" className="btn-outline py-2 px-3 text-xs">Back to Open Mic</Link>
          </div>
        </>
      </OpenMicAuthGate>
    </main>
  );
}
