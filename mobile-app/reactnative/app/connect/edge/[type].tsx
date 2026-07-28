import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import ConnectEdgeState from '@/features/connect/components/ConnectEdgeState';

type EdgeConfig = {
  icon: string;
  title: string;
  message: string;
  tone?: 'neutral' | 'error';
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
};

// One parametrised screen covers Connect's full-screen edge states (PRD §10.12
// SY-05..09 plus the onboarding age-gate). Route: /connect/edge/<type>
const CONFIG: Record<string, EdgeConfig> = {
  offline: { icon: 'WifiOff', title: 'No connection', message: 'Check your internet and try again. Some content may be available offline.', tone: 'error', primaryLabel: 'Retry' },
  maintenance: { icon: 'Wrench', title: 'Under maintenance', message: 'Connect is briefly down for maintenance. We’ll be back shortly.', primaryLabel: 'Retry' },
  'force-update': { icon: 'ArrowUpCircle', title: 'Update required', message: 'A newer version of the app is required to keep using Connect. Please update from your app store.', primaryLabel: 'Update now' },
  'geo-restriction': { icon: 'GlobeLock', title: 'Not available here', message: 'Connect isn’t available in your current region yet. We’re working to expand.', tone: 'error', primaryLabel: 'Go home', primaryHref: '/(tabs)/home' },
  'age-gate': { icon: 'Cake', title: 'You must be 18+', message: 'Connect is strictly for adults aged 18 and above. If this is a mistake, contact support.', tone: 'error', primaryLabel: 'Contact support', primaryHref: '/connect/settings/help' },
};

export default function ConnectEdgeScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const cfg = CONFIG[type ?? ''] ?? CONFIG.offline;

  return (
    <ConnectEdgeState
      icon={cfg.icon}
      title={cfg.title}
      message={cfg.message}
      tone={cfg.tone}
      primaryLabel={cfg.primaryLabel}
      onPrimary={cfg.primaryLabel ? () => (cfg.primaryHref ? router.replace(cfg.primaryHref as never) : router.back()) : undefined}
      secondaryLabel="Go back"
      onSecondary={() => router.back()}
    />
  );
}
