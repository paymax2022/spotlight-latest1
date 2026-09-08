'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { syncAdminSession } from '@/features/auth/adminSession';
import { acceptStaffInvite } from '@/services/staysExtranetService';
import { PageHeader, Card, btnPrimary } from '../../../_ui';

type Status = 'checking' | 'accepting' | 'done' | 'error';

function AcceptInviteBody() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setStatus('error');
      setError('This invite link is missing its token.');
      return;
    }

    (async () => {
      const signedIn = await syncAdminSession();
      if (!signedIn) {
        const self = `/extranet/staff/invite/accept?token=${encodeURIComponent(token)}`;
        router.replace(`/extranet/onboarding/signup?next=${encodeURIComponent(self)}`);
        return;
      }
      setStatus('accepting');
      try {
        await acceptStaffInvite(token);
        setStatus('done');
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'This invite could not be accepted.');
      }
    })();
  }, [token, router]);

  if (status === 'checking' || status === 'accepting') {
    return <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{status === 'checking' ? 'Checking your session…' : 'Accepting your invite…'}</p>;
  }

  if (status === 'done') {
    return (
      <div>
        <p style={{ color: '#15803d', fontWeight: 600 }}>You&apos;re in.</p>
        <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>This property now shows up in your extranet.</p>
        <Link href="/extranet/profile" style={{ ...btnPrimary(), textDecoration: 'none', display: 'inline-block', marginTop: '0.5rem' }}>
          Go to property profile
        </Link>
      </div>
    );
  }

  return (
    <div>
      <p style={{ color: '#b91c1c', fontWeight: 600 }}>This invite is not valid.</p>
      <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{error} It may be expired, already used, or sent to a different email than the one you signed in with.</p>
    </div>
  );
}

export default function AcceptStaffInvitePage() {
  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Join your team's property" subtitle="Accepting this invite links your Paymax account to the property with the role you were assigned." />
      <Card title="Staff invite">
        <Suspense fallback={null}>
          <AcceptInviteBody />
        </Suspense>
      </Card>
    </div>
  );
}
