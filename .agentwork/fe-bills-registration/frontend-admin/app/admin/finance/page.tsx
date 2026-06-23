import Link from 'next/link';

export const metadata = { title: 'Finance Admin — Spotlight' };

const cards = [
  {
    href: '/admin/finance/kyc',
    title: 'KYC Queue',
    description: 'Review and approve or reject pending KYC submissions.',
    icon: '🪪',
    accent: 'border-amber-500',
  },
  {
    href: '/admin/finance/wallets',
    title: 'Wallet Lookup',
    description: "View any user's wallet balance and transaction history.",
    icon: '💳',
    accent: 'border-emerald-500',
  },
  {
    href: '/admin/finance/disputes',
    title: 'Disputes',
    description: 'Review open dispute tickets and issue resolutions or refunds.',
    icon: '🚩',
    accent: 'border-red-500',
  },
  {
    href: '/admin/payments-finance',
    title: 'Adjustments',
    description: 'Initiate and approve manual ledger adjustments (maker-checker).',
    icon: '⚖️',
    accent: 'border-indigo-500',
  },
];

export default function FinanceAdminPage() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Finance Administration
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem' }}>
        Manage KYC approvals, wallet balances, and ledger adjustments.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: 'block',
              padding: '1.5rem',
              border: `2px solid`,
              borderColor: c.accent.includes('amber') ? '#f59e0b'
                : c.accent.includes('emerald') ? '#10b981'
                : c.accent.includes('red') ? '#dc2626'
                : '#6366f1',
              borderRadius: '0.75rem',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'box-shadow 0.15s',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{c.icon}</div>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{c.title}</div>
            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>{c.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
