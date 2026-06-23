'use client';

import { useEffect, useState } from 'react';
import { listStemEmergingProjects } from '@/services/stemService';
import type { StemEmergingProject } from '@/types/stem';

export default function AdminEmergingProjectsPage() {
  const [rows, setRows] = useState<StemEmergingProject[]>([]);

  useEffect(() => {
    void listStemEmergingProjects(150).then(setRows);
  }, []);

  return (
    <section>
      <h1>Emerging Projects</h1>
      <p>Project entities in the Emerging Future Innovators channel.</p>
      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {rows.map((row) => (
          <article key={row.id || `${row.teamId}-${row.projectTitle}`} style={{ border: '1px solid #2a2a2a', padding: 10 }}>
            <p style={{ margin: 0, fontWeight: 700 }}>{row.projectTitle}</p>
            <p style={{ margin: '4px 0 0 0', fontSize: 12 }}>Category: {row.category || '-'} · Status: {row.status || '-'}</p>
          </article>
        ))}
        {rows.length === 0 ? <p>No emerging projects found yet.</p> : null}
      </div>
    </section>
  );
}
