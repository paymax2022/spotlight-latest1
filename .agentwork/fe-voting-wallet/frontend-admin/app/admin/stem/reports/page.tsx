'use client';

import { useEffect, useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import { getStemReportBuckets, getStemReportSummary } from '@/services/stemService';
import type { StemReportBucket, StemReportSummary } from '@/types/stem';

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
    <section>
      <h1>STEM Reports and Analytics</h1>
      <StemModuleLinks />
      {!summary ? <p>Loading summary...</p> : null}
      {summary ? (
        <p style={{ marginBottom: 12 }}>
          Applications: {summary.totalApplications} · Schools: {summary.totalSchools} · Emerging: {summary.totalEmerging} · Votes: {summary.totalVotes} ·
          Sponsors: {summary.totalSponsors} · Certificates: {summary.totalCertificates} · Badge Awards: {summary.totalBadgeAwards} · Cohorts:{' '}
          {summary.totalBootcampCohorts}
        </p>
      ) : null}
      <h2 style={{ marginTop: 12, fontSize: 16 }}>Vote Status Distribution</h2>
      <ul>
        {voteStatus.map((item) => (
          <li key={item.key}>
            {item.key}: {item.count}
          </li>
        ))}
      </ul>
      <h2 style={{ marginTop: 12, fontSize: 16 }}>Bootcamp Cohort Status Distribution</h2>
      <ul>
        {cohortStatus.map((item) => (
          <li key={item.key}>
            {item.key}: {item.count}
          </li>
        ))}
      </ul>
    </section>
  );
}
