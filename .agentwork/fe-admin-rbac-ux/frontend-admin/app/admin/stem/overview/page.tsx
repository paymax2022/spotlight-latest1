'use client';

import Link from 'next/link';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { useEffect, useState } from 'react';
import { getStemOverview } from '@/services/stemService';
import type { StemOverview } from '@/types/stem';

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
    <section>
      <h1>STEM Program Overview</h1>
      <StemModuleLinks />
      <p>National STEM challenge overview across school and emerging channels.</p>
      <p style={{ marginTop: 8 }}>
        <Link href="/admin/stem/contests">Open STEM Contests</Link> ·{' '}
        <Link href="/admin/stem/submissions">Open STEM Submissions</Link> ·{' '}
        <Link href="/admin/stem/judging">Open STEM Judging</Link> ·{' '}
        <Link href="/admin/stem/leaderboard">Open STEM Leaderboard</Link> ·{' '}
        <Link href="/admin/schools">Open Schools Module</Link> ·{' '}
        <Link href="/admin/emerging-innovators">Open Emerging Innovators Module</Link>
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 10, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        <article style={{ border: '1px solid #2a2a2a', padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Workflow Actions</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Move applications through submission statuses.</li>
            <li>Create and review judge scoring records.</li>
            <li>Inspect channel and regional leaderboard slices.</li>
          </ul>
        </article>
        <article style={{ border: '1px solid #2a2a2a', padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Channel Coverage</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>School channel onboarding and team ops.</li>
            <li>Emerging innovator onboarding and project ops.</li>
            <li>Contest setup with mixed-channel eligibility checks.</li>
          </ul>
        </article>
      </div>
      {!data ? <p style={{ marginTop: 12 }}>Loading overview...</p> : null}
      <div style={{ display: 'grid', gap: 10, marginTop: 12, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {cards.map((card) => (
          <article key={card.label} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
            <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{card.label}</p>
            <p style={{ margin: '6px 0 0 0', fontWeight: 700, fontSize: 22 }}>{card.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
