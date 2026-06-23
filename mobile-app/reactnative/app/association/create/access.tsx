import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/association/components/WizardProgress';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';
import type { RestrictionConfig } from '@/features/association/types/orgDraft.types';

const TOGGLES: { key: keyof Omit<RestrictionConfig, 'graceDays'>; label: string; help: string }[] = [
  { key: 'disableVoting', label: 'Disable voting', help: 'Unpaid members cannot vote in elections.' },
  { key: 'disableEvents', label: 'Disable event registration', help: 'Unpaid members cannot register for events.' },
  { key: 'disableChat', label: 'Disable chat posting', help: 'Unpaid members can read but not post.' },
  { key: 'disableCard', label: 'Disable membership card', help: 'The digital card is hidden until dues are paid.' },
];

export default function WizardAccess() {
  const { draft, patch } = useOrgDraft();
  const r = draft.restrictions;
  const [fee, setFee] = useState(draft.registrationFeeKobo ? String(draft.registrationFeeKobo / 100) : '');

  const setRestriction = (key: keyof RestrictionConfig, val: boolean | number) =>
    patch({ restrictions: { ...r, [key]: val } });

  const next = () => {
    const naira = parseInt(fee.replace(/[^0-9]/g, ''), 10) || 0;
    patch({ registrationFeeKobo: naira * 100 });
    router.push('/association/create/preview');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={4} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Registration fee</Text>
        <Text style={styles.help}>One-off fee charged when a member joins. Leave blank for free.</Text>
        <TextInputField placeholder="₦0" value={fee} onChangeText={setFee} keyboardType="number-pad" />

        <Text style={[styles.label, styles.sectionGap]}>Grace period</Text>
        <Text style={styles.help}>Days after dues are due before restrictions apply.</Text>
        <View style={styles.graceRow}>
          {[0, 7, 14, 30].map((d) => {
            const active = r.graceDays === d;
            return (
              <View key={d} style={styles.graceChipWrap}>
                <Text
                  onPress={() => setRestriction('graceDays', d)}
                  style={[styles.graceChip, active && styles.graceChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`${d} days grace`}
                >
                  {d === 0 ? 'None' : `${d}d`}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={[styles.label, styles.sectionGap]}>When dues are unpaid</Text>
        <Text style={styles.help}>Choose what gets restricted after the grace period.</Text>
        <View style={[styles.card, shadow1]}>
          {TOGGLES.map((t, i) => (
            <View key={t.key} style={[styles.toggleRow, i > 0 && styles.toggleDivider]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>{t.label}</Text>
                <Text style={styles.toggleHelp}>{t.help}</Text>
              </View>
              <Switch
                value={r[t.key]}
                onValueChange={(v) => setRestriction(t.key, v)}
                trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
                thumbColor={Colors.white}
                accessibilityLabel={t.label}
              />
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Review" onPress={next} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120, gap: Spacing.sm, paddingTop: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface },
  sectionGap: { marginTop: Spacing.md },
  help: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  graceRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  graceChipWrap: { flex: 1 },
  graceChip: { ...Typography.labelMd, color: Colors.onSurface, textAlign: 'center', paddingVertical: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant, overflow: 'hidden' },
  graceChipActive: { color: Colors.onPrimary, backgroundColor: Colors.primary, borderColor: Colors.primary },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, marginTop: Spacing.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  toggleDivider: { borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  toggleLabel: { ...Typography.labelLg, color: Colors.onSurface },
  toggleHelp: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
