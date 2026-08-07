import Link from 'next/link';
import { Page, PageHeader, colors } from '@/components/ui/vuexy';

export const metadata = { title: 'Finance Admin — Spotlight' };

const cards = [
  {
    href: '/admin/finance/kyc',
    title: 'KYC Queue',
    description: 'Review and approve or reject pending KYC submissions.',
    icon: '🪪',
    accent: colors.warning,
  },
  {
    href: '/admin/finance/wallets',
    title: 'Wallet Lookup',
    description: "View any user's wallet balance and transaction history.",
    icon: '💳',
    accent: colors.success,
  },
  {
    href: '/admin/finance/disputes',
    title: 'Disputes',
    description: 'Review open dispute tickets and issue resolutions or refunds.',
    icon: '🚩',
    accent: colors.danger,
  },
  {
    href: '/admin/payments-finance',
    title: 'Adjustments',
    description: 'Initiate and approve manual ledger adjustments (maker-checker).',
    icon: '⚖️',
    accent: colors.primary,
  },
];

export default function FinanceAdminPage() {
  return (
    <Page>
      <PageHeader
        title="Finance Administration"
        subtitle="Manage KYC approvals, wallet balances, and ledger adjustments."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            style={{
              display: 'block',
              padding: '1.5rem',
              border: `2px solid ${c.accent}`,
              borderRadius: '0.75rem',
              textDecoration: 'none',
              color: 'inherit',
              background: colors.card,
              transition: 'box-shadow 0.15s',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{c.icon}</div>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: colors.text }}>{c.title}</div>
            <div style={{ fontSize: '0.875rem', color: colors.muted }}>{c.description}</div>
          </Link>
        ))}
      </div>
    </Page>
  );
}
