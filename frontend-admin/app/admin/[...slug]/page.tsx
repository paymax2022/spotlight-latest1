'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { env } from '@/config/env';

export default function LegacyAdminBridgePage() {
  const pathname = usePathname() || '/admin';
  const legacyUrl = useMemo(() => `${env.legacyAdminBaseUrl}${pathname}`, [pathname]);

  return (
    <div>
      <h1>Module In Transition</h1>
      <p>
        This admin route has not been fully moved yet. Use the legacy route for now while migration
        completes.
      </p>
      <p>
        <a href={legacyUrl} target="_blank" rel="noreferrer">
          Open Legacy Module
        </a>
      </p>
      <p>
        <Link href="/admin">Back to migrated dashboard</Link>
      </p>
      <p style={{ fontSize: 12, opacity: 0.75 }}>
        Current path: <code>{pathname}</code>
      </p>
    </div>
  );
}
