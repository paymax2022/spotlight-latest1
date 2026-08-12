'use client';

import { useEffect, useState } from 'react';
import { createStemSchoolTeam, listStemSchoolTeams } from '@/services/stemService';
import type { StemSchoolTeam } from '@/types/stem';
import { Page, PageHeader, Card, Button, Input, colors } from '@/components/ui/vuexy';

export default function AdminSchoolTeamsPage() {
  const [rows, setRows] = useState<StemSchoolTeam[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [teamName, setTeamName] = useState('');

  async function load() {
    setRows(await listStemSchoolTeams(150));
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate() {
    if (!schoolId.trim() || !teamName.trim()) return;
    const created = await createStemSchoolTeam({ schoolId: schoolId.trim(), teamName: teamName.trim() });
    if (created) {
      setSchoolId('');
      setTeamName('');
      await load();
    }
  }

  return (
    <Page>
      <PageHeader title="School Teams" subtitle="Teams created under school channel." />
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="School ID" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
          <Input placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          <Button variant="primary" onClick={() => void onCreate()}>Create Team</Button>
        </div>
      </Card>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <Card key={row.id || `${row.schoolId}-${row.teamName}`} style={{ padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.teamName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: colors.muted }}>School ID: {row.schoolId}</p>
          </Card>
        ))}
        {rows.length === 0 ? <p style={{ color: colors.muted }}>No school teams found yet.</p> : null}
      </div>
    </Page>
  );
}
