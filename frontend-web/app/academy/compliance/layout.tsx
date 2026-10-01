import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { featureFlags } from '@/src/lib/feature-flags';

/**
 * Gates every page under /academy/compliance behind
 * FEATURE_ACADEMY_COMPLIANCE_ENABLED. The dashboards call /api/compliance/*
 * endpoints that are not implemented yet, so the pages render broken (every
 * fetch 404s). Keeping the whole segment 404 until the API lands means
 * production never ships the dead surface; flip the flag on to re-enable.
 */
export default function AcademyComplianceLayout({ children }: { children: ReactNode }) {
  if (!featureFlags.academyCompliance()) notFound();
  return <>{children}</>;
}
