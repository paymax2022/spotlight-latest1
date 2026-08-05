'use client';

import Link from 'next/link';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { useEffect, useState } from 'react';
import { getStemOverview } from '@/services/stemService';
import type { StemOverview } from '@/types/stem';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminStemOverviewPage() {
  const [data, setData] = useState<StemOverview | null>(null);

  useEffect(() => {
    void getStemOverview().then(setData);
  }, []);

  const cards = [
    { label: 'Total Applications', value: data?.totalApplications ?? 0 },
    { label: 'Submitted', value: data?.submittedApplications ?? 0 },
    { label: 'Under Review', value: data?.underReviewApplications ?? 0 },
    { label: 'Shortlisted', value: data?.shortlistedApplications ?? 0 },
    { label: 'School Channel', value: data?.schoolChannelApplicants ?? 0 },
    { label: 'Emerging Innovators', value: data?.emergingApplicants ?? 0 },
  ];

  return (
    <Page>
      <PageHeader title="STEM Program Overview" subtitle="National STEM challenge overview across school and emerging channels." />
      <StemModuleLinks />
      <p style={{ marginTop: 8 }}>
        <Link href="/admin/stem/contests">Open STEM Contests</Link> ·{' '}
        <Link href="/admin/stem/submissions">Open STEM Submissions</Link> ·{' '}
        <Link href="/admin/stem/judging">Open STEM Judging</Link> ·{' '}
        <Link href="/admin/stem/leaderboard">Open STEM Leaderboard</Link> ·{' '}
        <Link href="/admin/schools">Open Schools Module</Link> ·{' '}
        <Link href="/admin/emerging-innovators">Open Emerging Innovators Module</Link>
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 10, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <Card title="Workflow Actions">
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            <li>Move applications through submission statuses.</li>
            <li>Create and review judge scoring records.</li>
            <li>Inspect channel and regional leaderboard slices.</li>
          </ul>
        </Card>
        <Card title="Channel Coverage">
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            <li>School channel onboarding and team ops.</li>
            <li>Emerging innovator onboarding and project ops.</li>
            <li>Contest setup with mixed-channel eligibility checks.</li>
          </ul>
        </Card>
      </div>
      {!data ? <p style={{ marginTop: 12, color: colors.muted }}>Loading overview...</p> : null}
      <div style={{ display: 'grid', gap: 10, marginTop: 12, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {cards.map((card) => (
          <Card key={card.label}>
            <p style={{ margin: 0, fontSize: 12, color: colors.muted }}>{card.label}</p>
            <p style={{ margin: '6px 0 0 0', fontWeight: 700, fontSize: 22 }}>{card.value}</p>
          </Card>
        ))}
      </div>
    </Page>
  );
}
