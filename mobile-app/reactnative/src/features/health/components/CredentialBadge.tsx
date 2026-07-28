import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { CREDENTIAL_STATUS_META } from '../constants/health.constants';
import type { ProviderCredential } from '../types';
import { formatDate } from '../constants/health.constants';

/**
 * Verified-credential badge (HL-2). Surfaces the regulator (VCN/PCN/MLSCN),
 * licence number and verification status anywhere a provider is shown.
 */
export default function CredentialBadge({
  credential,
  showLicense,
}: {
  credential: ProviderCredential;
  showLicense?: boolean;
}) {
  const meta = CREDENTIAL_STATUS_META[credential.status];
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[meta.icon] ?? Icons.BadgeCheck;

  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]} accessibilityRole="text">
      <Icon size={14} color={meta.color} strokeWidth={2.2} />
      <Text style={[styles.text, { color: meta.color }]} numberOfLines={1}>
        {credential.authority} {meta.label}
        {showLicense ? ` · ${credential.licenseNo}` : ''}
        {credential.status === 'expired' && credential.expiresAt ? ` (${formatDate(credential.expiresAt)})` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  text: { ...Typography.labelSm, fontWeight: '700' as const },
});
