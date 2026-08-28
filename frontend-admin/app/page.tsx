import Link from 'next/link';

export const metadata = { title: 'Admin Dashboard — Spotlight' };

const quickLinks = [
  {
    section: 'Finance',
    items: [
      { href: '/admin/finance/kyc', label: 'KYC Queue', description: 'Approve or reject pending identity submissions', color: '#f59e0b' },
      { href: '/admin/finance/wallets', label: 'Wallet Lookup', description: 'View any user\'s balance and ledger history', color: '#10b981' },
      { href: '/admin/finance/disputes', label: 'Dispute Tickets', description: 'Review open disputes and issue resolutions', color: '#ef4444' },
      { href: '/admin/payments-finance', label: 'Adjustments', description: 'Maker-checker ledger adjustments', color: '#6366f1' },
    ],
  },
  {
    section: 'Contests',
    items: [
      { href: '/admin/competitions', label: 'Competitions', description: 'Manage contest entries and judging', color: '#8b5cf6' },
      { href: '/admin/open-mic', label: 'Open Mic', description: 'Applications, submissions, judging, finale, payments', color: '#8b5cf6' },
    ],
  },
  {
    section: 'Support',
    items: [
      { href: '/admin/users', label: 'Users', description: 'View and manage platform accounts', color: '#0ea5e9' },
      { href: '/admin/chatbot', label: 'Chat Sessions', description: 'Monitor AI-care escalations', color: '#0ea5e9' },
      { href: '/admin/audit-logs', label: 'Audit Logs', description: 'Full immutable event log', color: '#64748b' },
    ],
  },
];

export default function AdminHome() {
  return (
    <div style={{ padding: '2rem', maxWidth: 960, fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>
        Spotlight Admin
      </h1>
      <p style={{ color: '#64748b', marginBottom: '2rem' }}>
        Paymax × Spotlight Super App — internal operations dashboard
      </p>

      {quickLinks.map(({ section, items }) => (
        <section key={section} style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', marginBottom: '0.75rem' }}>
            {section}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
            {items.map(({ href, label, description, color }) => (
              <Link
                key={href}
                href={href}
                style={{
                  display: 'block',
                  padding: '1rem',
                  border: `1px solid #1e293b`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: '6px',
                  textDecoration: 'none',
                  transition: 'background 0.15s',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '0.25rem' }}>{label}</strong>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{description}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
