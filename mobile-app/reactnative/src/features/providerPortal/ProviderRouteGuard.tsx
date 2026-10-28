// Wraps a provider area's layout. Screens under a gated prefix render only for a
// user who owns an APPROVED provider record of that type; everyone else sees a
// status screen instead. UX gate only — the API enforces ownership and approval
// on every provider-side call (ADR-PR<pr-number> provider-portal-capabilities).

import React from 'react';
import { router, usePathname } from 'expo-router';
import StateView from '@/components/StateView';
import { useProviderCapabilities } from './useProviderCapabilities';
import { decideGate, type GateRule } from './gate';

export default function ProviderRouteGuard({
  rules,
  children,
}: {
  rules: readonly GateRule[];
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const { data: caps, isLoading, refetch } = useProviderCapabilities();

  // A path no rule covers (e.g. the customer screens) never waits on the fetch.
  const covered = decideGate(pathname, rules, []).kind !== 'allow';
  if (!covered) return <>{children}</>;

  if (isLoading) return <StateView kind="loading" message="Checking your provider access…" />;
  // A failed BACKGROUND refetch keeps the last good data; only a first-load
  // failure (no data) blocks, so a network blip does not tear down the navigator.
  if (!caps) {
    return (
      <StateView
        kind="error"
        title="Couldn't check your provider access"
        actionLabel="Retry"
        onAction={() => { void refetch(); }}
      />
    );
  }

  const decision = decideGate(pathname, rules, caps);
  if (decision.kind === 'allow') return <>{children}</>;

  const goPortal = () => router.replace('/provider-portal' as never);
  return decision.kind === 'pending' ? (
    <StateView
      kind="empty"
      icon="Clock"
      title="Your provider application is not approved yet"
      message="You can open this area once your application is approved."
      actionLabel="View my status"
      onAction={goPortal}
    />
  ) : (
    <StateView
      kind="empty"
      icon="Lock"
      title="This area is for approved providers"
      message="Your account doesn't manage a business of this type."
      actionLabel="Provider portal"
      onAction={goPortal}
    />
  );
}
