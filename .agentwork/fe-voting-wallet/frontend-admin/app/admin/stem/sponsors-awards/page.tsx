'use client';

import { useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  awardStemBadge,
  createStemBadge,
  createStemCertificate,
  createStemSponsor,
  listStemBadgeAwards,
  listStemBadges,
  listStemCertificates,
  listStemSponsors,
} from '@/services/stemService';

export default function AdminStemSponsorsAwardsPage() {
  const [applicationId, setApplicationId] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [counts, setCounts] = useState({ sponsors: 0, certs: 0, badges: 0, awards: 0 });

  async function load() {
    const [sponsors, certs, badges, awards] = await Promise.all([
      listStemSponsors(100),
      listStemCertificates(100),
      listStemBadges(100),
      listStemBadgeAwards(applicationId, 100),
    ]);
    setCounts({ sponsors: sponsors.length, certs: certs.length, badges: badges.length, awards: awards.length });
  }

  return (
    <section>
      <h1>STEM Sponsors, Certificates, and Badges</h1>
      <StemModuleLinks />
      <button type="button" onClick={() => void load()}>Refresh</button>
      <button type="button" onClick={() => void createStemSponsor({ name: 'Sponsor A', sponsorType: 'program', logoUrl: '', websiteUrl: '', campaignMessage: '', ctaUrl: '', isActive: true }).then(load)} style={{ marginLeft: 8 }}>Add Sponsor</button>
      <button type="button" onClick={() => void createStemCertificate({ applicationId, certificateType: 'Participation', certificateNumber: `CERT-${Date.now()}`, issuedAt: '', fileUrl: '' }).then(load)} style={{ marginLeft: 8 }}>Issue Certificate</button>
      <button type="button" onClick={() => void createStemBadge({ name: `Badge-${Date.now()}`, description: 'STEM badge', iconUrl: '' }).then(load)} style={{ marginLeft: 8 }}>Create Badge</button>
      <div style={{ marginTop: 10 }}>
        <input placeholder="Application ID" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} />
        <input placeholder="Badge ID" value={badgeId} onChange={(e) => setBadgeId(e.target.value)} style={{ marginLeft: 8 }} />
        <button type="button" onClick={() => void awardStemBadge({ badgeId, applicationId, awardedAt: '', note: 'Auto-award' }).then(load)} style={{ marginLeft: 8 }}>
          Award Badge
        </button>
      </div>
      <p style={{ marginTop: 10 }}>
        Sponsors: {counts.sponsors} · Certificates: {counts.certs} · Badges: {counts.badges} · Awards: {counts.awards}
      </p>
    </section>
  );
}

