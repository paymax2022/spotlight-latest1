'use client';

// E2E-INFRA-003: the app shipped zero error boundaries — any unhandled render
// error blanked the page. This root boundary catches every route without its
// own error.tsx (which is currently all of them); per-route boundaries can
// still be added for better UX where a screen has a meaningful retry.
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-render failures surface nowhere else — keep the digest so the
    // report can be correlated with server logs.
    console.error('[app/error] unhandled render error', error.digest ?? '', error);
  }, [error]);

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Something went wrong</h1>
      <p>The page hit an unexpected error. You can try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
