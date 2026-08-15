'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { getStemSchoolDashboard } from '@/services/stemService';
import type { StemSchoolDashboard } from '@/types/stem';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminSchoolDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<StemSchoolDashboard | null>(null);

  useEffect(() => {
    void getStemSchoolDashboard(id).then(setData);
  }, [id]);

  return (
    <Page>
      <PageHeader title="School Dashboard" />
      {!data ? <p style={{ color: colors.muted }}>Loading dashboard...</p> : null}
      {data ? (
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Card style={{ padding: 10 }}><p style={{ margin: 0, fontSize: 12, color: colors.muted }}>School</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.schoolName}</p></Card>
          <Card style={{ padding: 10 }}><p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Verification</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.verificationStatus}</p></Card>
          <Card style={{ padding: 10 }}><p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Teams</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.totalTeams}</p></Card>
          <Card style={{ padding: 10 }}><p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Projects</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.totalProjects}</p></Card>
          <Card style={{ padding: 10 }}><p style={{ margin: 0, fontSize: 12, color: colors.muted }}>Submissions</p><p style={{ margin: '6px 0 0 0', fontWeight: 700 }}>{data.totalSubmissions}</p></Card>
        </div>
      ) : null}
      <p style={{ marginTop: 12 }}><Link href="/admin/schools">Back to Schools</Link></p>
    </Page>
  );
}
