'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { listStemSubmissions, updateStemSubmissionStatus } from '@/services/stemService';
import type { StemSubmission } from '@/types/stem';

export default function StemSubmissionsPage() {
  const [rows, setRows] = useState<StemSubmission[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  async function load() {
    setRows(await listStemSubmissions(150, statusFilter));
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  async function onUpdate(id: string, status: string) {
    await updateStemSubmissionStatus(id, status, 'screening');
    await load();
  }

  return (
    <section>
      <h1>STEM Submissions</h1>
      <StemModuleLinks />
      <div style={{ marginTop: 8 }}>
        <input placeholder="Filter status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
      </div>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <article key={r.id} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{r.id}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>{r.challengeType} · {r.categoryTrack} · {r.status}</p>
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => void onUpdate(r.id, 'under_review')}>Mark Under Review</button>
              <button type="button" onClick={() => void onUpdate(r.id, 'shortlisted')} style={{ marginLeft: 8 }}>Mark Shortlisted</button>
            </div>
          </article>
        ))}
        {rows.length === 0 ? <p>No submissions found.</p> : null}
      </div>
    </section>
  );
}
