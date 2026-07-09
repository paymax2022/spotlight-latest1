'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { getStemSchoolDashboard } from '@/services/stemService';
import type { StemSchoolDashboard } from '@/types/stem';

export default function AdminSchoolDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<StemSchoolDashboard | null>(null);

  useEffect(() => {
    void getStemSchoolDashboard(id).then(setData);
  }, [id]);

  return (
    <section>
      <h1>School Dashboard</h1>
      {!data ? <p>Loading dashboard...</p> : null}
      {data ? (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <article style={{ border: '1px solid #2a2a2a', padding: 10 }}><p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>School</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.schoolName}</p></article>
          <article style={{ border: '1px solid #2a2a2a', padding: 10 }}><p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>Verification</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.verificationStatus}</p></article>
          <article style={{ border: '1px solid #2a2a2a', padding: 10 }}><p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>Teams</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.totalTeams}</p></article>
          <article style={{ border: '1px solid #2a2a2a', padding: 10 }}><p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>Projects</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.totalProjects}</p></article>
          <article style={{ border: '1px solid #2a2a2a', padding: 10 }}><p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>Submissions</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.totalSubmissions}</p></article>
        </div>
      ) : null}
      <p style={{ marginTop: 12 }}><Link href="/admin/schools">Back to Schools</Link></p>
    </section>
  );
}
