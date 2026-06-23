'use client';

import { useEffect, useState } from 'react';
import { listStemEmergingTeams } from '@/services/stemService';
import type { StemEmergingTeam } from '@/types/stem';

export default function AdminEmergingTeamsPage() {
  const [rows, setRows] = useState<StemEmergingTeam[]>([]);

  useEffect(() => {
    void listStemEmergingTeams(150).then(setRows);
  }, []);

  return (
    <section>
      <h1>Emerging Teams</h1>
      <p>Team entities in the Emerging Future Innovators channel.</p>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <article key={row.id || `${row.innovatorId}-${row.teamName}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.teamName}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>Track: {row.innovationTrack || '-'} · Team size: {row.teamSize}</p>
          </article>
        ))}
        {rows.length === 0 ? <p>No emerging teams found yet.</p> : null}
      </div>
    </section>
  );
}
