import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { IdCard, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { ID_TYPES } from '@/features/kycverify/constants';
import { kycVerifyDraft } from '@/features/kycverify/draft';
import type { IdType } from '@/features/kycverify/types';

/** K4 — ID type select (BVN/NIN and, where allowed, passport/licence). */
export default function KycIdTypeScreen() {
  const [idType, setIdType] = useState<IdType>(kycVerifyDraft.current.idType);

  // Consent gate — cannot reach any check screen without recorded consent.
  if (!kycVerifyDraft.current.consentGiven || !kycVerifyDraft.current.sessionId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Choose ID type" />
        <StateView
          kind="error"
          icon="ShieldAlert"
          title="Consent required"
          message="Please review and accept the verification consent before continuing."
          actionLabel="Go to consent"
          onAction={() => router.replace('/kyc-verify/consent')}
        />
      </SafeAreaView>
    );
  }

  const next = () => {
    kycVerifyDraft.current.idType = idType;
    router.push('/kyc-verify/id-number');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Choose ID type" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Which government ID would you like to verify with?</Text>
        <View style={styles.list}>
          {ID_TYPES.map((opt) => {
            const selected = idType === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setIdType(opt.value)}
                style={[styles.option, selected && styles.optionOn]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <View style={[styles.optionIcon, selected && styles.optionIconOn]}>
                  <IdCard size={20} color={selected ? Colors.primary : Colors.onSurfaceVariant} strokeWidth={2} />
                </View>
                <Text style={[styles.optionLabel, selected && styles.optionLabelOn]}>{opt.label}</Text>
                {selected ? (
                  <View style={styles.tick}><Check size={12} color={Colors.onPrimary} strokeWidth={3} /></View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  list: { gap: Spacing.sm },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md,
  },
  optionOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  optionIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  optionIconOn: { backgroundColor: Colors.iconBgPurple },
  optionLabel: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  optionLabelOn: { color: Colors.primary, fontWeight: '700' as const },
  tick: { width: 20, height: 20, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
