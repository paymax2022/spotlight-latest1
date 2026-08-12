'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Page, PageHeader, Card, colors, tint } from '@/components/ui/vuexy';

type HubLink = { group: string; code: string; href: string; title: string; desc: string };

const LINKS: HubLink[] = [
  { group: 'Configuration', code: 'A1', href: '/admin/intake/form-builder', title: 'Intake Form Builder', desc: 'Manage schema fields — required/optional, order, conditional logic — and publish a new version.' },
  { group: 'Configuration', code: 'A2', href: '/admin/intake/rules', title: 'Red-flag Rules', desc: 'Define which answers trigger the triage gate and the guidance/routing each produces.' },
  { group: 'Configuration', code: 'A3', href: '/admin/intake/vocab', title: 'Clinical Vocabularies', desc: 'Maintain condition, allergen, and medication lookup lists.' },
  { group: 'Configuration', code: 'A4', href: '/admin/intake/consent', title: 'Consent Versions', desc: 'Author and version the consent text patients accept.' },
  { group: 'Configuration', code: 'A5', href: '/admin/intake/config/reminder', title: 'Reminder Settings', desc: 'Timing/cadence and channels for intake-completion reminders.' },
  { group: 'Configuration', code: 'A6', href: '/admin/intake/config/summary', title: 'Doctor Summary Template', desc: 'Order the sections of the clinician-facing summary.' },
  { group: 'Configuration', code: 'A7', href: '/admin/intake/config/content', title: 'Content & Localization', desc: 'Question text, urgent-care and crisis guidance copy.' },
  { group: 'Operations & records', code: 'A8', href: '/admin/intake/monitoring', title: 'Intake Monitoring', desc: 'Appointments with intake status; incomplete-near-appointment alerts.' },
  { group: 'Operations & records', code: 'A9', href: '/admin/intake/records', title: 'Intake Record Viewer', desc: 'View a specific intake — access-controlled and audit-logged, read-only.' },
  { group: 'Operations & records', code: 'A10', href: '/admin/intake/access-log', title: 'Access & Audit Log', desc: 'Who accessed which intake, plus consent and red-flag events.' },
  { group: 'Operations & records', code: 'A11', href: '/admin/intake/red-flag-queue', title: 'Red-flag Queue', desc: 'Triggered cases and their routing/disposition, handled supportively.' },
  { group: 'Analytics', code: 'A12', href: '/admin/intake/analytics', title: 'Completion Analytics', desc: 'Completion rate, per-step drop-off, average time-to-complete.' },
  { group: 'Analytics', code: 'A13', href: '/admin/intake/insights', title: 'Clinical Insights', desc: 'Most common complaints/conditions and red-flag rate — de-identified, aggregated.' },
];

const GROUPS = ['Configuration', 'Operations & records', 'Analytics'];

function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: tint(colors.warning, 0.12), border: `1px solid ${tint(colors.warning, 0.3)}`, color: colors.text, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginTop: 14, display: 'flex', gap: 8 }}>
      <span aria-hidden>🔒</span>
      <span>{children}</span>
    </div>
  );
}

export default function IntakeHubPage() {
  return (
    <Page>
      <PageHeader
        title="Pre-Consultation Intake"
        subtitle="Configure the patient intake schema, safety rules, and consent; monitor intake completion and triggered red-flag cases; and review de-identified analytics. All access is role-gated (health.admin.intake) and audit-logged."
      />
      <Notice>
        Intake holds sensitive health data. Every configuration change and every record access is written to the audit log.
      </Notice>

      {GROUPS.map((group) => (
        <section key={group} style={{ marginTop: 24 }}>
          <p style={{ fontSize: 12, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{group}</p>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 8 }}>
            {LINKS.filter((l) => l.group === group).map((l) => (
              <Link key={l.href} href={l.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                <Card style={{ height: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <strong>{l.title}</strong>
                    <span style={{ fontSize: 11, color: colors.muted, fontFamily: 'monospace' }}>{l.code}</span>
                  </div>
                  <p style={{ fontSize: 12, color: colors.muted, marginTop: 8, marginBottom: 0 }}>{l.desc}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
