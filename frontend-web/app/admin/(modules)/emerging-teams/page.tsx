'use client';

import { useEffect, useState } from 'react';
import { listStemEmergingTeams } from '@/services/stemService';
import type { StemEmergingTeam } from '@/types/stem';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminEmergingTeamsPage() {
  const [rows, setRows] = useState<StemEmergingTeam[]>([]);

  useEffect(() => {
    void listStemEmergingTeams(150).then(setRows);
  }, []);

  return (
    <Page>
      <PageHeader title="Emerging Teams" subtitle="Team entities in the Emerging Future Innovators channel." />
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id || `${row.innovatorId}-${row.teamName}`} style={{ padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.teamName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>Track: {row.innovationTrack || '-'} · Team size: {row.teamSize}</p>
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No emerging teams found yet.</p> : null}
      </div>
    </Page>
  );
}
