'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { getStemReportBuckets, getStemReportSummary } from '@/services/stemService';
import type { StemReportBucket, StemReportSummary } from '@/types/stem';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

export default function AdminStemReportsPage() {
  const [summary, setSummary] = useState<StemReportSummary | null>(null);
  const [voteStatus, setVoteStatus] = useState<StemReportBucket[]>([]);
  const [cohortStatus, setCohortStatus] = useState<StemReportBucket[]>([]);

  useEffect(() => {
    void getStemReportSummary().then(setSummary);
    void getStemReportBuckets('vote_status').then(setVoteStatus);
    void getStemReportBuckets('cohort_status').then(setCohortStatus);
  }, []);

  return (
    <Page>
      <PageHeader title="STEM Reports and Analytics" />
      <StemModuleLinks />
      {!summary ? <p style={{ color: colors.muted }}>Loading summary...</p> : null}
      {summary ? (
        <p style={{ marginBottom: 12, fontSize: 13 }}>
          Applications: {summary.totalApplications} · Schools: {summary.totalSchools} · Emerging: {summary.totalEmerging} · Votes: {summary.totalVotes} ·
          Sponsors: {summary.totalSponsors} · Certificates: {summary.totalCertificates} · Badge Awards: {summary.totalBadgeAwards} · Cohorts:{' '}
          {summary.totalBootcampCohorts}
        </p>
      ) : null}
      <Card title="Vote Status Distribution" style={{ marginTop: 12 }}>
        <ul style={{ margin: '10px 0 0' }}>
          {voteStatus.map((item) => (
            <li key={item.key}>
              {item.key}: {item.count}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Bootcamp Cohort Status Distribution" style={{ marginTop: 12 }}>
        <ul style={{ margin: '10px 0 0' }}>
          {cohortStatus.map((item) => (
            <li key={item.key}>
              {item.key}: {item.count}
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
