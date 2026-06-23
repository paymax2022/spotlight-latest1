'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AdminMenuCounts } from '@/types/admin';
import { getAdminMenuCounts } from '@/services/adminApiClient';
import { canManageStem, canReadStem, getCurrentStemRole } from '@/config/stemAccess';
import { quickLinks } from './quickLinks';

export function AdminDashboard() {
  const [counts, setCounts] = useState<AdminMenuCounts | null>(null);
  const role = getCurrentStemRole();
  const visibleQuickLinks = quickLinks.filter((item) => {
    if (item.stemAccess === 'read') return canReadStem(role);
    if (item.stemAccess === 'manage') return canManageStem(role);
    return true;
  });

  useEffect(() => {
    void getAdminMenuCounts().then(setCounts);
  }, []);

  return (
    <div>
      <h1>Admin Portal</h1>
      <p>Manage contestants, contests, analytics, and platform security from one place.</p>

      <div style={{ marginTop: 16, padding: 12, border: '1px solid #2a2a2a' }}>
        <strong>Live Counts</strong>
        <p style={{ marginTop: 8 }}>
          Contestants: {counts?.contestants ?? '-'} | Open Mic: {counts?.open_mic ?? '-'} | Reality TV: {counts?.reality_tv ?? '-'}
        </p>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {visibleQuickLinks.map((item) => (
          <Link key={item.href} href={item.href} style={{ border: '1px solid #2a2a2a', padding: 12 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{item.label}</p>
            <p style={{ margin: '8px 0 0 0', opacity: 0.7, fontSize: 12 }}>{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
