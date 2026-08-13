'use client';

import { useEffect, useState } from 'react';
import { listStemEmergingProjects } from '@/services/stemService';
import type { StemEmergingProject } from '@/types/stem';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminEmergingProjectsPage() {
  const [rows, setRows] = useState<StemEmergingProject[]>([]);

  useEffect(() => {
    void listStemEmergingProjects(150).then(setRows);
  }, []);

  return (
    <Page>
      <PageHeader title="Emerging Projects" subtitle="Project entities in the Emerging Future Innovators channel." />
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id || `${row.teamId}-${row.projectTitle}`} style={{ padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.projectTitle}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>Category: {row.category || '-'} · Status: {row.status || '-'}</p>
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No emerging projects found yet.</p> : null}
      </div>
    </Page>
  );
}
