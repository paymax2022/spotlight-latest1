import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Fingerprint, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { formatKobo } from '@/features/connect/constants/format';
import { useSubmitTier1 } from '@/features/connect/wallet/hooks';

// WL-13 — Tier 1: link BVN or NIN. Unlocks small gifting + a ₦30,000/day limit.
export default function Tier1BvnNin() {
  const submit = useSubmitTier1();
  const [type, setType] = useState<'bvn' | 'nin'>('bvn');
  const [value, setValue] = useState('');

  const valid = /^\d{11}$/.test(value);

  const onSubmit = () => {
    if (!valid) return;
    submit.mutate(
      { identifier: value, identifierType: type },
      {
        onSuccess: (r) => {
          if (r.reviewState === 'pending') router.replace('/connect/wallet/tier/pending');
          else router.replace('/connect/wallet/tier/status');
        },
        onError: (e: unknown) => Alert.alert('Verification failed', e instanceof Error ? e.message : 'Please try again.'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Tier 1 · BVN / NIN" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}><Fingerprint size={24} color={Colors.primary} /></View>
          <Text style={styles.heroTitle}>Link your identity</Text>
          <Text style={styles.heroSub}>Tier 1 unlocks gifting up to {formatKobo(3_000_000)}/day.</Text>
        </View>

        <View style={styles.segment}>
          {(['bvn', 'nin'] as const).map((t) => (
            <Pressable key={t} style={[styles.segItem, type === t && styles.segItemActive]} onPress={() => setType(t)}>
              <Text style={[styles.segText, type === t && styles.segTextActive]}>{t.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <TextInputField
          label={`${type.toUpperCase()} (11 digits)`}
          value={value}
          onChangeText={(t) => setValue(t.replace(/[^0-9]/g, '').slice(0, 11))}
          keyboardType="number-pad"
          placeholder="00000000000"
          inputMode="numeric"
        />

        <View style={styles.privacy}>
          <Lock size={14} color={Colors.onSurfaceVariant} />
          <Text style={styles.privacyText}>
            Your {type.toUpperCase()} is verified against the national registry and never stored in plain text.
            We only confirm a match.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Verify & continue" onPress={onSubmit} disabled={!valid} loading={submit.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  heroCard: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.lg },
  heroIcon: { width: 56, height: 56, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...Typography.titleLg, color: Colors.onSurface, marginTop: Spacing.sm },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, padding: 4 },
  segItem: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.full },
  segItemActive: { backgroundColor: Colors.primary },
  segText: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  segTextActive: { color: Colors.onPrimary },
  privacy: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  privacyText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
