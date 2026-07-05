import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import OnboardingStep from '@/features/connect/components/OnboardingStep';
import TextInputField from '@/components/TextInputField';
import { useLinkIdentity, useTierBenefits } from '@/features/connect/hooks/useConnect';
import { formatKobo } from '@/features/connect/constants/format';

// ON-13 — BVN/NIN linkage. Enter/confirm BVN or NIN; NIBSS/NIMC lookup result.
// Shows the tier benefits unlocked by linking an ID. The value goes only to the
// verified backend endpoint over TLS; it is never logged (SAFETY §5).
type IdType = 'bvn' | 'nin';

export default function BvnNin() {
  const [type, setType] = useState<IdType>('bvn');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const link = useLinkIdentity();
  const { data: tiers } = useTierBenefits();
  const tier1 = tiers?.find((t) => t.tier === 1);

  const valid = /^\d{11}$/.test(value);

  const onLink = () => {
    if (!valid) {
      setError('Enter a valid 11-digit number.');
      return;
    }
    setError(undefined);
    link.mutate(
      { identityType: type, value },
      {
        onSuccess: () => router.push('/connect/onboarding/tier-intro'),
        onError: (e) => setError(e instanceof Error ? e.message : 'Lookup failed. Please try again.'),
      },
    );
  };

  return (
    <OnboardingStep
      step={8}
      totalSteps={9}
      title="Link your Nigerian ID"
      subtitle="Linking your BVN or NIN moves you to Tier 1 so you can send and receive gifts."
      primaryLabel="Verify & link"
      onPrimary={onLink}
      primaryDisabled={!valid}
      primaryLoading={link.isPending}
      secondaryLabel="Skip for now"
      onSecondary={() => router.push('/connect/onboarding/tier-intro')}
      footerNote="We use a real-time NIBSS/NIMC lookup. Your ID is encrypted and never stored in plain text."
    >
      <View style={styles.segment}>
        {(['bvn', 'nin'] as IdType[]).map((t) => {
          const active = type === t;
          return (
            <Pressable
              key={t}
              style={[styles.segBtn, active && styles.segBtnActive]}
              onPress={() => { setType(t); setError(undefined); }}
            >
              <Text style={[styles.segText, active && styles.segTextActive]}>{t.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInputField
        label={`${type.toUpperCase()} (11 digits)`}
        value={value}
        onChangeText={(t) => { setValue(t.replace(/\D/g, '').slice(0, 11)); if (error) setError(undefined); }}
        placeholder="00000000000"
        keyboardType="number-pad"
        leftIcon={<Lock size={18} color={Colors.outline} />}
        error={error}
        maxLength={11}
      />

      {tier1 ? (
        <View style={styles.benefitCard}>
          <View style={styles.benefitHead}>
            <Text style={styles.benefitTier}>{tier1.label}</Text>
            <Text style={styles.benefitLimit}>up to {formatKobo(tier1.dailyLimitKobo)}/day</Text>
          </View>
          {tier1.privileges.map((p) => (
            <View key={p} style={styles.benefitRow}>
              <View style={styles.bullet} />
              <Text style={styles.benefitText}>{p}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: 4 },
  segBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.surfaceContainerLowest },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segTextActive: { color: Colors.primary },
  benefitCard: {
    backgroundColor: Colors.iconBgPurple,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  benefitHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xs },
  benefitTier: { ...Typography.titleMd, color: Colors.primary },
  benefitLimit: { ...Typography.labelMd, color: Colors.secondary },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bullet: { width: 6, height: 6, borderRadius: Radius.full, backgroundColor: Colors.primary },
  benefitText: { ...Typography.bodyMd, color: Colors.onSurface },
});
