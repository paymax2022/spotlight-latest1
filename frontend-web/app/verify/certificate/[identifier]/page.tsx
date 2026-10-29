// Public credential verification page.
//
// A verifier scans the QR on a certificate (or types the code) and lands here.
// The page shows the SAME four facts as the JSON registry — holder display name,
// programme, completion date and status — and nothing else. Revoked credentials
// remain resolvable so a verifier sees the revocation, not a 404.

import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { featureFlags } from '@/src/lib/feature-flags';
import {
  formatCertificateDate,
  resolvePublicSiteUrl,
} from '@/src/server/services/academy/topics/certificate-artifact';
import {
  verifyCertificate,
  type CertificateVerification,
} from '@/src/server/services/academy/topics/certificates';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Certificate verification — Spotlight Film Academy',
  description: 'Verify a Spotlight Film Academy programme credential.',
  robots: { index: false, follow: false },
};

const COLORS = {
  gold: '#B88A2E',
  ink: '#1E1B16',
  muted: '#6B655C',
  cream: '#FAF7F0',
  card: '#FFFFFF',
  valid: '#1F7A5A',
  revoked: '#B3261E',
  border: '#E4DCCB',
};

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: COLORS.cream,
  color: COLORS.ink,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  padding: '48px 16px',
};

const cardStyle: CSSProperties = {
  maxWidth: 640,
  margin: '0 auto',
  background: COLORS.card,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 16,
  padding: 32,
  boxShadow: '0 18px 50px rgba(30, 27, 22, 0.08)',
};

const labelStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: COLORS.muted,
  fontWeight: 700,
};

const valueStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 16,
  color: COLORS.ink,
};

function Brand() {
  return (
    <p style={{ ...labelStyle, color: COLORS.gold, textAlign: 'center', marginBottom: 20 }}>
      Spotlight Film Academy
    </p>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <Brand />
        <h1 style={{ margin: 0, fontSize: 26, textAlign: 'center' }}>Certificate verification</h1>
        <p style={{ marginTop: 16, color: COLORS.muted, textAlign: 'center', lineHeight: 1.6 }}>
          {message}
        </p>
        <p style={{ marginTop: 24, textAlign: 'center' }}>
          <a href={resolvePublicSiteUrl()} style={{ color: COLORS.gold }}>Return to Spotlight</a>
        </p>
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '14px 0', borderTop: `1px solid ${COLORS.border}` }}>
      <dt style={labelStyle}>{label}</dt>
      <dd style={valueStyle}>{value}</dd>
    </div>
  );
}

function VerificationCard({ result }: { result: CertificateVerification }) {
  const valid = result.valid;
  const statusLabel = valid ? 'Verified credential' : 'Revoked credential';
  const badgeColor = valid ? COLORS.valid : COLORS.revoked;

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <Brand />
        <h1 style={{ margin: 0, fontSize: 26, textAlign: 'center' }}>Certificate verification</h1>

        <div
          style={{
            margin: '22px auto 8px',
            maxWidth: 420,
            textAlign: 'center',
            border: `1px solid ${badgeColor}`,
            borderRadius: 999,
            padding: '10px 18px',
            color: badgeColor,
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}
        >
          {statusLabel}
        </div>

        <p style={{ margin: '10px 0 26px', textAlign: 'center', color: COLORS.muted, lineHeight: 1.6 }}>
          {valid
            ? 'This credential is currently issued and valid in the Spotlight Film Academy registry.'
            : 'This credential was revoked and is no longer valid. Revocation stays visible so a verifier is never shown a missing record.'}
        </p>

        <dl style={{ margin: 0 }}>
          <Detail label="Holder" value={result.studentName ?? 'Not recorded'} />
          <Detail label="Programme" value={result.programName ?? 'Not recorded'} />
          <Detail label="Completion date" value={formatCertificateDate(result.completionDate)} />
          <Detail label="Certificate number" value={result.certificateNumber ?? 'Not recorded'} />
          <Detail
            label="Status"
            value={valid ? 'Issued' : result.status === 'revoked' ? 'Revoked' : (result.status ?? 'Unknown')}
          />
          {result.issuedAt ? <Detail label="Issued" value={formatCertificateDate(result.issuedAt)} /> : null}
          {result.revokedAt ? <Detail label="Revoked" value={formatCertificateDate(result.revokedAt)} /> : null}
        </dl>

        <p style={{ margin: '26px 0 0', fontSize: 12, lineHeight: 1.6, color: COLORS.muted }}>
          This page publishes only the holder&apos;s display name, programme, completion date and
          status. It never exposes an email address, phone number, user id or enrollment id.
        </p>
        <p style={{ margin: '16px 0 0', textAlign: 'center', fontSize: 13 }}>
          <a href={resolvePublicSiteUrl()} style={{ color: COLORS.gold }}>Spotlight Film Academy</a>
        </p>
      </div>
    </main>
  );
}

export default async function VerifyCertificatePage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  if (!featureFlags.filmAcademyTopics()) {
    return <Unavailable message="Credential verification is not available yet." />;
  }

  const { identifier } = await params;
  let result: CertificateVerification;
  try {
    result = await verifyCertificate(createAdminClient(), identifier);
  } catch (error) {
    console.error('[film/certificates] public verification page failed', error);
    return <Unavailable message="Verification is temporarily unavailable. Please try again shortly." />;
  }

  if (!result.found) notFound();
  return <VerificationCard result={result} />;
}
