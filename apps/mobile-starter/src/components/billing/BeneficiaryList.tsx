// @ts-nocheck
import { Pressable, View } from 'react-native';

import { Beneficiary } from '@/api/beneficiaries.api';
import { AppCard } from '@/components/ui/AppCard';
import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme';

/**
 * Quick-refill list of saved beneficiaries for a bill payment screen. (BENE-1)
 *
 * Handles loading / error / empty as inline states so the host screen stays
 * simple. Renders nothing when there are no saved beneficiaries and the list
 * has loaded successfully, to avoid empty clutter on first use.
 */
export function BeneficiaryList({
  isLoading,
  isError,
  beneficiaries,
  onSelect,
}: {
  isLoading: boolean;
  isError: boolean;
  beneficiaries: Beneficiary[];
  onSelect: (beneficiary: Beneficiary) => void;
}) {
  if (isLoading) {
    return (
      <AppCard>
        <AppText variant="h2">Saved beneficiaries</AppText>
        <AppText color={colors.neutral.textMuted}>Loading saved beneficiaries…</AppText>
      </AppCard>
    );
  }

  if (isError) {
    return (
      <AppCard>
        <AppText variant="h2">Saved beneficiaries</AppText>
        <AppText color={colors.neutral.textMuted}>Could not load saved beneficiaries.</AppText>
      </AppCard>
    );
  }

  if (!beneficiaries.length) return null;

  return (
    <AppCard>
      <AppText variant="h2">Quick refill</AppText>
      <View style={{ gap: spacing[2], marginTop: spacing[2] }}>
        {beneficiaries.map((b) => (
          <Pressable
            key={b.id}
            accessibilityRole="button"
            accessibilityLabel={`Refill ${b.label}`}
            onPress={() => onSelect(b)}
            style={{
              borderWidth: 1,
              borderColor: colors.neutral.border,
              backgroundColor: colors.neutral.white,
              borderRadius: radius.md,
              padding: spacing[3],
              gap: 2,
            }}
          >
            <AppText variant="bodyMedium">{b.label || b.customerReference}</AppText>
            <AppText variant="caption" color={colors.neutral.textMuted}>
              {b.customerReference}
              {b.customerName ? ` · ${b.customerName}` : ''}
            </AppText>
          </Pressable>
        ))}
      </View>
    </AppCard>
  );
}
