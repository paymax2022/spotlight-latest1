'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { listStemSubmissions, updateStemSubmissionStatus } from '@/services/stemService';
import type { StemSubmission } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="STEM Submissions" />
      <StemModuleLinks />
      <div style={{ marginTop: 8 }}>
        <Input placeholder="Filter status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} />
      </div>
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <Card key={r.id}>
            <p style={{ margin: 0, fontWeight: 700 }}>{r.id}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>{r.challengeType} · {r.categoryTrack} · {r.status}</p>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <Button variant="outline" sm onClick={() => void onUpdate(r.id, 'under_review')}>Mark Under Review</Button>
              <Button variant="outline" sm onClick={() => void onUpdate(r.id, 'shortlisted')}>Mark Shortlisted</Button>
            </div>
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No submissions found.</p> : null}
      </div>
    </Page>
  );
}
