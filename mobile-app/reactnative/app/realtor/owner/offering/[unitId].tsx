import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { sanitizeMoneyInput } from '@/utils/money';
import StateView from '@/components/StateView';
import { useUnitOfferings, useSaveUnitOfferings } from '@/features/realtor/hooks/useRealtorOwner';
import { MODE_LABEL } from '@/features/realtor/constants/realtor.constants';
import type { OfferingModeConfig } from '@/features/realtor/types/realtor.owner.types';

export default function OfferingModeScreen() {
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const offerings = useUnitOfferings(String(unitId));
  const save = useSaveUnitOfferings(String(unitId));
  const [modes, setModes] = useState<OfferingModeConfig[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => { if (offerings.data) setModes(offerings.data.modes); }, [offerings.data]);

  const toggle = (mode: string) => setModes((ms) => ms.map((m) => (m.mode === mode ? { ...m, enabled: !m.enabled } : m)));
  const setNaira = (mode: string, field: 'price' | 'nightlyPrice' | 'cautionDeposit', naira: string) =>
    setModes((ms) => ms.map((m) => (m.mode === mode ? { ...m, [field]: (Number(naira.replace(/[^0-9.]/g, '')) || 0) * 100 } : m)));

  const submit = async () => {
    await save.mutateAsync(modes);
    setDone(true);
  };

  if (offerings.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Offering modes" />
        <StateView kind="loading" />
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.doneBody}>
          <View style={styles.doneIcon}><Text style={styles.doneTick}>✓</Text></View>
          <Text style={styles.doneTitle}>Unit published</Text>
          <Text style={styles.doneSub}>Your unit is now listed across the offering modes you enabled.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to dashboard" onPress={() => router.replace('/realtor/owner')} />
        </View>
      </SafeAreaView>
    );
  }

  const naira = (k?: number) => (k ? String(k / 100) : '');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Offering modes"
        subtitle={offerings.data?.unitLabel ?? 'Configure monetisation'}
        rightSlot={
          <Pressable onPress={() => router.push('/realtor/ai/listing-assistant')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Write listing with AI">
            <Sparkles size={22} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.aiRow} onPress={() => router.push('/realtor/ai/listing-assistant')}>
          <Sparkles size={16} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.aiText}>Write the listing with AI</Text>
        </Pressable>
        <Text style={styles.intro}>Enable one or more ways to monetise this unit. The same asset can stack modes.</Text>

        {modes.map((m) => (
          <View key={m.mode} style={[styles.modeCard, m.enabled && styles.modeCardOn]}>
            <Pressable style={styles.modeHead} onPress={() => toggle(m.mode)} accessibilityRole="switch" accessibilityState={{ checked: m.enabled }}>
              <Text style={styles.modeTitle}>{MODE_LABEL[m.mode]}</Text>
              <View style={[styles.switch, m.enabled && styles.switchOn]}>
                <View style={[styles.knob, m.enabled && styles.knobOn]} />
              </View>
            </Pressable>

            {m.enabled ? (
              <View style={styles.modeBody}>
                {m.mode === 'short_stay' ? (
                  <TextInputField label="Nightly price (₦)" placeholder="e.g. 75000" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={naira(m.nightlyPrice)} onChangeText={(t) => setNaira(m.mode, 'nightlyPrice', sanitizeMoneyInput(t))} />
                ) : m.mode === 'for_sale' ? (
                  <TextInputField label="Sale price (₦)" placeholder="e.g. 85000000" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={naira(m.price)} onChangeText={(t) => setNaira(m.mode, 'price', sanitizeMoneyInput(t))} />
                ) : (
                  <TextInputField label="Annual rent (₦)" placeholder="e.g. 6500000" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={naira(m.price)} onChangeText={(t) => setNaira(m.mode, 'price', sanitizeMoneyInput(t))} />
                )}
                {m.mode !== 'for_sale' ? (
                  <TextInputField label="Caution deposit (₦, refundable)" placeholder="e.g. 650000" keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={naira(m.cautionDeposit)} onChangeText={(t) => setNaira(m.mode, 'cautionDeposit', sanitizeMoneyInput(t))} />
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Publish unit" onPress={submit} loading={save.isPending} disabled={!modes.some((m) => m.enabled)} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  aiRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.primaryFixed, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  aiText: { ...Typography.labelMd, color: Colors.onPrimaryFixed },
  intro: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md, lineHeight: 20 },
  modeCard: {
    backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, marginBottom: Spacing.md,
  },
  modeCardOn: { borderColor: Colors.primary },
  modeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeTitle: { ...Typography.titleMd, color: Colors.onSurface },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  modeBody: { marginTop: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
  doneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.md },
  doneIcon: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  doneTick: { ...Typography.displayLg, color: Colors.tertiaryContainer, fontSize: 44, lineHeight: 52 },
  doneTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  doneSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
