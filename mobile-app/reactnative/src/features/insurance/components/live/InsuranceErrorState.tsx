// ── Insurance (live) — real error states ────────────────────────────────────
// The module used to fall back to fixtures whenever a call failed, so a broken
// backend looked like a working product. It no longer does: a failure is shown,
// named, and retryable. This component turns a normalised `InsuranceError` into
// something a person can act on, and tells the truth about which layer failed.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CloudOff, Lock, ServerCrash, TriangleAlert, WifiOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import { InsuranceColors } from '../../constants/insurance.constants';
import type { InsuranceError } from '../../live/types';

function describe(error: InsuranceError | null | undefined): {
  Icon: typeof CloudOff;
  title: string;
  detail: string;
} {
  const status = error?.status ?? null;

  if (status == null) {
    return {
      Icon: WifiOff,
      title: "Can't reach Paymax",
      detail:
        error?.message ||
        'Check your connection and try again. Nothing was charged.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      Icon: Lock,
      title: 'Sign in to continue',
      detail: error?.message || 'Your session expired. Sign in again to see your cover.',
    };
  }
  if (status === 404) {
    return {
      Icon: CloudOff,
      title: 'Not available yet',
      detail:
        error?.message ||
        'This part of Protection is not switched on for your account yet.',
    };
  }
  if (status >= 500) {
    return {
      Icon: ServerCrash,
      title: 'Something broke on our side',
      detail:
        error?.message ||
        'The insurance service is having trouble. Nothing was charged — please try again shortly.',
    };
  }
  return {
    Icon: TriangleAlert,
    title: "That didn't work",
    detail: error?.message || 'Please check the details and try again.',
  };
}

export default function InsuranceErrorState({
  error,
  onRetry,
  compact = false,
}: {
  error: InsuranceError | Error | null | unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const normalised = (error ?? null) as InsuranceError | null;
  const { Icon, title, detail } = describe(normalised);

  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={styles.iconBox}>
        <Icon size={26} color={Colors.error} strokeWidth={1.9} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {normalised?.code && normalised.code !== 'UNKNOWN' ? (
        <Text style={styles.code}>{normalised.code}</Text>
      ) : null}
      {onRetry ? (
        <View style={styles.action}>
          <PrimaryButton label="Try again" onPress={onRetry} fullWidth={false} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

/** Inline banner form, for a failure inside a screen that still has content. */
export function InsuranceErrorBanner({ error }: { error: InsuranceError | null | unknown }) {
  const normalised = (error ?? null) as InsuranceError | null;
  if (!normalised) return null;
  const { detail } = describe(normalised);
  return (
    <View style={styles.banner}>
      <TriangleAlert size={18} color={Colors.error} />
      <Text style={styles.bannerText}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xs,
  },
  compact: { flex: 0, paddingVertical: Spacing.lg },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    backgroundColor: Colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  detail: {
    ...Typography.bodySm,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  code: {
    ...Typography.labelSm,
    color: Colors.outline,
    marginTop: Spacing.xs,
    letterSpacing: 0.4,
  },
  action: { marginTop: Spacing.md },

  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  bannerText: { ...Typography.bodySm, color: InsuranceColors.text, flex: 1, lineHeight: 20 },
});
