import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, Plus, X } from 'lucide-react-native';
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
import { GROUP_RULE_OPTIONS } from '@/features/association/constants/orgWizard.constants';
import type { RestrictionConfig } from '@/features/association/types/orgDraft.types';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';

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
  const [customRule, setCustomRule] = useState('');

  const setRestriction = (key: keyof RestrictionConfig, val: boolean | number) =>
    patch({ restrictions: { ...r, [key]: val } });

  const toggleRule = (rule: string) =>
    patch({ rules: draft.rules.includes(rule) ? draft.rules.filter((x) => x !== rule) : [...draft.rules, rule] });

  const addCustomRule = () => {
    const v = customRule.trim();
    if (!v || draft.rules.includes(v)) { setCustomRule(''); return; }
    patch({ rules: [...draft.rules, v] });
    setCustomRule('');
  };

  const next = () => {
    patch({ registrationFeeKobo: nairaStringToKobo(fee) });
    router.push('/association/create/preview');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={4} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Registration fee</Text>
        <Text style={styles.help}>One-off fee charged when a member joins. Leave blank for free.</Text>
        <TextInputField placeholder="₦0" value={fee} onChangeText={(t) => setFee(sanitizeMoneyInput(t))} keyboardType="decimal-pad" maxLength={13} />

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

        {/* Group rules — multi-select. Members accept these when they join. */}
        <Text style={[styles.label, styles.sectionGap]}>Group rules</Text>
        <Text style={styles.help}>Select the rules members must accept when they join. Add your own too.</Text>
        <View style={[styles.card, shadow1]}>
          {GROUP_RULE_OPTIONS.map((rule, i) => {
            const checked = draft.rules.includes(rule);
            return (
              <Pressable key={rule} onPress={() => toggleRule(rule)} style={[styles.ruleRow, i > 0 && styles.toggleDivider]} accessibilityRole="checkbox" accessibilityState={{ checked }}>
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
                <Text style={styles.ruleText}>{rule}</Text>
              </Pressable>
            );
          })}
          {/* Custom rules the admin added */}
          {draft.rules.filter((x) => !GROUP_RULE_OPTIONS.includes(x as (typeof GROUP_RULE_OPTIONS)[number])).map((rule) => (
            <View key={rule} style={[styles.ruleRow, styles.toggleDivider]}>
              <View style={[styles.checkbox, styles.checkboxOn]}><Check size={14} color={Colors.onPrimary} strokeWidth={3} /></View>
              <Text style={styles.ruleText}>{rule}</Text>
              <Pressable onPress={() => toggleRule(rule)} hitSlop={8} accessibilityLabel={`Remove ${rule}`}>
                <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
        </View>
        <View style={styles.addRuleRow}>
          <View style={{ flex: 1 }}>
            <TextInputField placeholder="Add a custom rule" value={customRule} onChangeText={setCustomRule} />
          </View>
          <Pressable onPress={addCustomRule} style={[styles.addRuleBtn, !customRule.trim() && styles.addBtnDisabled]} disabled={!customRule.trim()} accessibilityRole="button" accessibilityLabel="Add rule">
            <Plus size={18} color={Colors.onPrimary} strokeWidth={2.4} />
          </Pressable>
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
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ruleText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  addRuleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  addRuleBtn: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  addBtnDisabled: { opacity: 0.4 },
  toggleLabel: { ...Typography.labelLg, color: Colors.onSurface },
  toggleHelp: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
