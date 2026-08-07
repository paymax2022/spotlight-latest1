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
import { Page, PageHeader, Card, Button, Input } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="STEM Sponsors, Certificates, and Badges" />
      <StemModuleLinks />
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          <Button variant="primary" onClick={() => void createStemSponsor({ name: 'Sponsor A', sponsorType: 'program', logoUrl: '', websiteUrl: '', campaignMessage: '', ctaUrl: '', isActive: true }).then(load)}>Add Sponsor</Button>
          <Button variant="primary" onClick={() => void createStemCertificate({ applicationId, certificateType: 'Participation', certificateNumber: `CERT-${Date.now()}`, issuedAt: '', fileUrl: '' }).then(load)}>Issue Certificate</Button>
          <Button variant="primary" onClick={() => void createStemBadge({ name: `Badge-${Date.now()}`, description: 'STEM badge', iconUrl: '' }).then(load)}>Create Badge</Button>
        </div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input placeholder="Application ID" value={applicationId} onChange={(e) => setApplicationId(e.target.value)} />
          <Input placeholder="Badge ID" value={badgeId} onChange={(e) => setBadgeId(e.target.value)} />
          <Button variant="primary" onClick={() => void awardStemBadge({ badgeId, applicationId, awardedAt: '', note: 'Auto-award' }).then(load)}>
            Award Badge
          </Button>
        </div>
        <p style={{ marginTop: 12, fontSize: 13 }}>
          Sponsors: {counts.sponsors} · Certificates: {counts.certs} · Badges: {counts.badges} · Awards: {counts.awards}
        </p>
      </Card>
    </Page>
  );
}
