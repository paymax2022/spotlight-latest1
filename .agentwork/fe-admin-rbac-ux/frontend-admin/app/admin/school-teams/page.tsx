'use client';

import { useEffect, useState } from 'react';
import { createStemSchoolTeam, listStemSchoolTeams } from '@/services/stemService';
import type { StemSchoolTeam } from '@/types/stem';

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
    <section>
      <h1>School Teams</h1>
      <p>Teams created under school channel.</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input placeholder="School ID" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} />
        <input placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
        <button type="button" onClick={() => void onCreate()}>Create Team</button>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <article key={row.id || `${row.schoolId}-${row.teamName}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.teamName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>School ID: {row.schoolId}</p>
          </article>
        ))}
        {rows.length === 0 ? <p>No school teams found yet.</p> : null}
      </div>
    </section>
  );
}
