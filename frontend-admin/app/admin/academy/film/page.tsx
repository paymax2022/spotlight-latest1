'use client';

// ── Admin — Film Academy (bridge) ────────────────────────────────────────────
// Film Academy is managed HERE in the console's information architecture, but
// its screens and data still live in frontend-web (/admin/film-academy/*),
// which reads Supabase directly. The Go backend has no Film Academy surface at
// all, so the standard academyAdminService stack (which targets …/api/academy on
// Go) cannot reach it.
//
// Rather than duplicate six working pages — and then keep two copies in step
// until one is deleted — this page carries the Academy chrome and hands off to
// the console that actually owns the data. Replace the links with real tables
// if and when the API moves to Go.
//
// The generic /admin/[...slug] bridge is NOT sufficient here: it points at
// legacyAdminBaseUrl (the retired :4028 admin), and Film Academy is in the
// public web app instead.

import { env } from '@/config/env';
import { AcademyTabs } from '../_ui';
import { Page, PageHeader, Card, colors } from '@/components/ui/vuexy';

const DESTINATIONS = [
  { label: 'Batches',      path: '/admin/film-academy',              desc: 'Cohorts, training fee, instalment plan and schedule.' },
  { label: 'Applications', path: '/admin/film-academy/applications', desc: 'Review, score and decide on applicants.' },
  { label: 'New batch',    path: '/admin/film-academy/batches/new',  desc: 'Open a new cohort for applications.' },
  { label: 'Areas & fees', path: '/admin/film-academy/interest-areas', desc: 'Areas of interest an applicant can choose, and the fee each one adds.' },
  { label: 'Settings',     path: '/admin/film-academy/settings',     desc: 'Programme-wide configuration and fee defaults.' },
];

export default function FilmAcademyAdminBridgePage() {
  return (
    <Page>
      <PageHeader
        title="Film Academy"
        subtitle="Cohorts, applications and training fees for the Spotlight Film Academy. Managed in the web console, which owns this data."
      />
      <AcademyTabs active="film" />

      <Card title="Open in the Film Academy console">
        <p style={{ marginBottom: 16, opacity: 0.8 }}>
          Film Academy records live in the web application rather than this
          console. These links open the working screens in a new tab.
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {DESTINATIONS.map((d) => (
            <a
              key={d.path}
              href={`${env.webAppBaseUrl}${d.path}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'block', padding: '12px 14px', borderRadius: 8,
                border: `1px solid ${colors.border}`, textDecoration: 'none',
              }}
            >
              <div style={{ fontWeight: 600, color: colors.primary }}>{d.label} ↗</div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>{d.desc}</div>
            </a>
          ))}
        </div>
        <p style={{ marginTop: 16, fontSize: 12, opacity: 0.65 }}>
          Destination: <code>{env.webAppBaseUrl}</code> — set
          <code> NEXT_PUBLIC_WEB_APP_BASE_URL</code> per environment.
        </p>
      </Card>
    </Page>
  );
}
