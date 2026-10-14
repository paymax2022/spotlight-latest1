'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AdminUsersRequestError } from '@/services/usersService';
import { describeReferrer, getUserReferredBy, type ReferredBy } from '@/services/userReferredByService';
import { Card, Button, colors } from '@/components/ui/vuexy';

/**
 * Read-only "Referred by" for the admin user profile: the person (or the Admin house
 * account) this user is connected to, and the code they used. Contains no mutation
 * controls.
 */
export function ReferredByPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<ReferredBy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setData(await getUserReferredBy(userId));
    } catch (err) {
      setData(null);
      if (err instanceof AdminUsersRequestError && err.status === 403) setForbidden(true);
      else setError(err instanceof Error ? err.message : 'Loading referrer failed.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  let body;
  if (loading) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>Loading referrer…</p>;
  } else if (forbidden) {
    body = <p style={{ color: colors.muted, fontSize: 13 }}>You don&apos;t have permission to view this.</p>;
  } else if (error || !data) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error ?? 'No data.'}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else {
    const d = describeReferrer(data);
    const person = data.attributed && !data.is_house && data.referrer_id;
    body = (
      <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        <div data-testid="referred-by-title" style={{ fontWeight: 600 }}>
          {person ? <Link href={`/admin/users/${data.referrer_id}`}>{d.title}</Link> : d.title}
        </div>
        {d.detail ? <div data-testid="referred-by-detail" style={{ color: colors.muted }}>{d.detail}</div> : null}
        {data.attributed && data.attributed_at ? (
          <div style={{ color: colors.muted }}>
            Connected {new Date(data.attributed_at).toLocaleString('en-NG')}
            {data.status === 'grace' ? ' · can still claim a code' : ''}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="referred-by-panel">
      <Card title="Referred by">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
