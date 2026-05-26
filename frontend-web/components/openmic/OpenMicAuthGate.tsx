'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Props = {
  nextPath: string;
  children: React.ReactNode;
};

export default function OpenMicAuthGate({ nextPath, children }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const isAuthed = Boolean(data.session?.access_token);
      setAuthed(isAuthed);
      setReady(true);
      if (!isAuthed) {
        router.replace(`/open-mic/login?next=${encodeURIComponent(nextPath)}`);
      }
    });
    return () => {
      active = false;
    };
  }, [supabase, router, nextPath]);

  if (!ready || !authed) {
    return (
      <div className="p-4 border rounded bg-white">
        <p className="mb-0 text-sm">Checking authentication...</p>
      </div>
    );
  }

  return <>{children}</>;
}
