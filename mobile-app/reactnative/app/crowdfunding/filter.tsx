import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, BadgeCheck, Siren } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import type { CampaignType } from '@/features/crowdfunding/types/crowdfunding.types';

const TYPES: { value: CampaignType; label: string }[] = [
  { value: 'DONATION', label: 'Donation' },
  { value: 'REWARD', label: 'Reward' },
  { value: 'COMMUNITY', label: 'Community' },
  { value: 'SME', label: 'SME / Business' },
];

const PROGRESS: { value: number; label: string }[] = [
  { value: 0, label: 'Any' },
  { value: 25, label: '25%+ funded' },
  { value: 50, label: '50%+ funded' },
  { value: 75, label: '75%+ funded' },
];

export default function FilterScreen() {
  const params = useLocalSearchParams<Record<string, string>>();
  const [verifiedOnly, setVerifiedOnly] = useState(params.verifiedOnly === '1');
  const [urgentOnly, setUrgentOnly] = useState(params.urgentOnly === '1');
  const [type, setType] = useState<CampaignType | undefined>(params.type as CampaignType | undefined);
  const [minProgress, setMinProgress] = useState<number>(params.minProgress ? Number(params.minProgress) : 0);

  const apply = () => {
    const next = new URLSearchParams();
    // keep navigational params (title / collection / category / sort)
    ['title', 'collection', 'category', 'sort', 'location'].forEach((k) => {
      if (params[k] != null) next.set(k, params[k] as string);
    });
    if (verifiedOnly) next.set('verifiedOnly', '1');
    if (urgentOnly) next.set('urgentOnly', '1');
    if (type) next.set('type', type);
    if (minProgress > 0) next.set('minProgress', String(minProgress));
    router.replace(`/crowdfunding/campaigns?${next.toString()}`);
  };

  const reset = () => {
    setVerifiedOnly(false);
    setUrgentOnly(false);
    setType(undefined);
    setMinProgress(0);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <Text style={styles.title}>Filter</Text>
        <Pressable onPress={() => goBack('/crowdfunding')} hitSlop={10} accessibilityLabel="Close">
          <X size={22} color={Colors.onSurface} strokeWidth={2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Toggles */}
        <ToggleRow
          icon={<BadgeCheck size={18} color={Colors.secondary} strokeWidth={2.2} />}
          label="Verified campaigns only"
          value={verifiedOnly}
          onToggle={() => setVerifiedOnly((v) => !v)}
        />
        <ToggleRow
          icon={<Siren size={18} color={Colors.error} strokeWidth={2.2} />}
          label="Urgent campaigns only"
          value={urgentOnly}
          onToggle={() => setUrgentOnly((v) => !v)}
        />

        {/* Campaign type */}
        <Text style={styles.groupTitle}>Campaign type</Text>
        <View style={styles.chipWrap}>
          {TYPES.map((t) => {
            const active = type === t.value;
            return (
              <Pressable
                key={t.value}
                onPress={() => setType(active ? undefined : t.value)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Progress */}
        <Text style={styles.groupTitle}>Funding progress</Text>
        <View style={styles.chipWrap}>
          {PROGRESS.map((p) => {
            const active = minProgress === p.value;
            return (
              <Pressable
                key={p.value}
                onPress={() => setMinProgress(p.value)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={reset} style={styles.resetBtn} accessibilityRole="button">
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
        <View style={styles.applyWrap}>
          <PrimaryButton label="Apply filters" onPress={apply} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function ToggleRow({ icon, label, value, onToggle }: { icon: React.ReactNode; label: string; value: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle} accessibilityRole="switch" accessibilityState={{ checked: value }}>
      <View style={styles.toggleLeft}>
        {icon}
        <Text style={styles.toggleLabel}>{label}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, maxHeight: '88%' },
  grabber: { width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.outlineVariant, alignSelf: 'center', marginTop: Spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.containerMargin },
  title: { ...Typography.titleLg, color: Colors.onSurface },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg, gap: Spacing.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  toggleLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  groupTitle: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLow, paddingHorizontal: Spacing.md, paddingVertical: 9 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { ...Typography.labelSm, color: Colors.onSurface },
  chipTextActive: { color: Colors.onPrimary },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  resetBtn: { height: 56, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  resetText: { ...Typography.labelLg, color: Colors.onSurface },
  applyWrap: { flex: 1 },
});
