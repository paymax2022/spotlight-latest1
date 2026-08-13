'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/stem/overview', label: 'Overview' },
  { href: '/admin/stem/contests', label: 'Contests' },
  { href: '/admin/stem/submissions', label: 'Submissions' },
  { href: '/admin/stem/judging', label: 'Judging' },
  { href: '/admin/stem/rubrics', label: 'Rubrics' },
  { href: '/admin/stem/leaderboard', label: 'Leaderboard' },
  { href: '/admin/stem/voting', label: 'Voting' },
  { href: '/admin/stem/bootcamp', label: 'Bootcamp' },
  { href: '/admin/stem/sponsors-awards', label: 'Sponsors/Awards' },
  { href: '/admin/stem/reports', label: 'Reports' },
];

export function StemModuleLinks() {
  const pathname = usePathname() ?? '';

  return (
    <nav aria-label="STEM management links" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 14px' }}>
      {LINKS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              border: '1px solid #2a2a2a',
              padding: '6px 10px',
              background: active ? '#1f1f1f' : 'transparent',
              textDecoration: 'none',
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
