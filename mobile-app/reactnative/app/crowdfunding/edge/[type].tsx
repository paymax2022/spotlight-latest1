import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import EdgeState from '@/features/crowdfunding/components/EdgeState';

type EdgeConfig = {
  icon: string;
  title: string;
  message: string;
  tone?: 'neutral' | 'error';
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
};

/**
 * One parametrised screen covers Section Q's full-screen edge states.
 * Route: /crowdfunding/edge/<type>
 */
const CONFIG: Record<string, EdgeConfig> = {
  'no-internet': { icon: 'WifiOff', title: 'No internet connection', message: 'Check your connection and try again.', tone: 'error', primaryLabel: 'Retry' },
  'server-error': { icon: 'ServerCrash', title: 'Something went wrong', message: 'Our servers hit a snag. Please try again in a moment.', tone: 'error', primaryLabel: 'Retry' },
  'maintenance': { icon: 'Wrench', title: 'Under maintenance', message: 'Crowdfunding is briefly down for maintenance. We’ll be back shortly.', primaryLabel: 'Retry' },
  'app-update': { icon: 'ArrowUpCircle', title: 'Update required', message: 'A newer version of the app is required to continue. Please update from your app store.', primaryLabel: 'Update now' },
  'session-expired': { icon: 'Clock', title: 'Session expired', message: 'For your security, you’ve been signed out. Please log in again.', primaryLabel: 'Log in', primaryHref: '/(auth)/login' },
  'access-denied': { icon: 'ShieldX', title: 'Access denied', message: 'You don’t have permission to view this page.', tone: 'error', primaryLabel: 'Go home', primaryHref: '/crowdfunding' },
  'account-suspended': { icon: 'UserX', title: 'Account suspended', message: 'Your account is under review. Contact support for assistance.', tone: 'error', primaryLabel: 'Contact support', primaryHref: '/crowdfunding/support/create' },
  'kyc-required': { icon: 'BadgeCheck', title: 'Verification needed', message: 'Complete identity verification (KYC) to create campaigns or withdraw funds.', primaryLabel: 'Verify now', primaryHref: '/crowdfunding/settings/verification' },
  'kyb-required': { icon: 'Building2', title: 'Business verification needed', message: 'Organisations must complete business verification (KYB) before fundraising.', primaryLabel: 'Verify business', primaryHref: '/crowdfunding/settings/verification' },
  'not-found': { icon: 'FileQuestion', title: 'Campaign not found', message: 'This campaign may have been removed or never existed.', primaryLabel: 'Go home', primaryHref: '/crowdfunding' },
};

export default function EdgeScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const cfg = CONFIG[type ?? ''] ?? CONFIG['server-error'];

  return (
    <EdgeState
      icon={cfg.icon}
      title={cfg.title}
      message={cfg.message}
      tone={cfg.tone}
      primaryLabel={cfg.primaryLabel}
      onPrimary={cfg.primaryLabel ? () => (cfg.primaryHref ? router.replace(cfg.primaryHref as never) : goBack('/crowdfunding')) : undefined}
      secondaryLabel="Go back"
      onSecondary={() => goBack('/crowdfunding')}
    />
  );
}
