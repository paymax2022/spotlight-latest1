'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/src/lib/auth/client';

export default function MyApplicationsClient() {
  const [items, setItems] = useState<Array<Record<string, any>>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/me/applications', { headers: await authHeaders(), cache: 'no-store' });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || 'Unable to load applications.');
        setItems(payload.applications || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load applications.');
      }
    }
    void load();
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="glass-card rounded-md p-4">
      {items.length === 0 ? <p className="mb-0">No applications yet.</p> : null}
      {items.map((item) => (
        <div key={String(item.id)} className="border-bottom py-3 d-flex justify-content-between align-items-center gap-3">
          <div>
            <p className="mb-0 font-semibold">{item.programName}</p>
            <p className="mb-0 text-sm text-foreground/60">{item.programType} - {String(item.status).replaceAll('_', ' ')}</p>
            <p className="mb-0 text-xs text-foreground/50">{item.reference || item.id}</p>
          </div>
          <Link href={String(item.editHref || item.detailsHref)} className="btn-outline py-2 px-3 text-xs">
            {item.nextAction || 'View'}
          </Link>
        </div>
      ))}
    </div>
  );
}
