import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, X, GitBranch, Users } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import WizardProgress from '@/features/association/components/WizardProgress';
import { useOrgDraft } from '@/features/association/store/orgDraftStore';
import { APPROVAL_RULE_OPTIONS, CHAPTER_LEVEL_OPTIONS } from '@/features/association/constants/orgWizard.constants';
import type { DraftChapter } from '@/features/association/types/orgDraft.types';

const LEVEL_LABEL: Record<DraftChapter['level'], string> = { REGION: 'Region', STATE: 'State', LOCAL: 'Local' };

export default function WizardStructure() {
  const { draft, patch, addChapter, removeChapter, addCommittee, removeCommittee } = useOrgDraft();
  const [touched, setTouched] = useState(false);
  const [name, setName] = useState('');
  const [level, setLevel] = useState<string>('STATE');
  const [committeeName, setCommitteeName] = useState('');

  const onAddCommittee = () => {
    if (!committeeName.trim()) return;
    addCommittee({ id: `cm_${Date.now()}`, name: committeeName.trim() });
    setCommitteeName('');
  };

  const valid = Boolean(draft.approvalRule);

  const onAdd = () => {
    if (!name.trim()) return;
    addChapter({ id: `ch_${Date.now()}`, name: name.trim(), level: level as DraftChapter['level'] });
    setName('');
  };
  const next = () => { setTouched(true); if (valid) router.push('/association/create/membership'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={2} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Approval rule</Text>
        {touched && !valid ? <Text style={styles.error}>Choose an approval rule</Text> : null}
        <View style={styles.gap}>
          {APPROVAL_RULE_OPTIONS.map((opt) => {
            const active = draft.approvalRule === opt.value;
            return (
              <Pressable key={opt.value} onPress={() => patch({ approvalRule: opt.value })} style={[styles.option, active && styles.optionActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optLabel, active && styles.optLabelActive]}>{opt.label}</Text>
                  <Text style={styles.optHelp}>{opt.help}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, styles.sectionGap]}>Chapters (optional)</Text>
        <Text style={styles.help}>Add the regions, states, or local branches your organisation spans.</Text>

        {draft.chapters.length > 0 ? (
          <View style={styles.gap}>
            {draft.chapters.map((c) => (
              <View key={c.id} style={[styles.chapterRow, shadow1]}>
                <GitBranch size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.chapterName}>{c.name}</Text>
                <Text style={styles.chapterLevel}>{LEVEL_LABEL[c.level]}</Text>
                <Pressable onPress={() => removeChapter(c.id)} hitSlop={8} accessibilityLabel={`Remove ${c.name}`}>
                  <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.addCard}>
          <TextInputField placeholder="Chapter name (e.g. Lagos State)" value={name} onChangeText={setName} />
          <SelectField value={LEVEL_LABEL[level as DraftChapter['level']]} options={CHAPTER_LEVEL_OPTIONS.map((l) => LEVEL_LABEL[l])} onChange={(label) => {
            const found = (CHAPTER_LEVEL_OPTIONS as readonly DraftChapter['level'][]).find((l) => LEVEL_LABEL[l] === label);
            if (found) setLevel(found);
          }} searchable={false} />
          <Pressable onPress={onAdd} style={[styles.addBtn, !name.trim() && styles.addBtnDisabled]} disabled={!name.trim()} accessibilityRole="button" accessibilityLabel="Add chapter">
            <Plus size={16} color={Colors.onPrimary} strokeWidth={2.4} />
            <Text style={styles.addText}>Add chapter</Text>
          </Pressable>
        </View>

        <Text style={[styles.label, styles.sectionGap]}>Committees (optional)</Text>
        <Text style={styles.help}>Create standing committees (e.g. Welfare, Finance, Events).</Text>
        {draft.committees.length > 0 ? (
          <View style={styles.gap}>
            {draft.committees.map((c) => (
              <View key={c.id} style={[styles.chapterRow, shadow1]}>
                <Users size={16} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.chapterName}>{c.name}</Text>
                <Pressable onPress={() => removeCommittee(c.id)} hitSlop={8} accessibilityLabel={`Remove ${c.name}`}>
                  <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.addCard}>
          <TextInputField placeholder="Committee name (e.g. Welfare)" value={committeeName} onChangeText={setCommitteeName} />
          <Pressable onPress={onAddCommittee} style={[styles.addBtn, !committeeName.trim() && styles.addBtnDisabled]} disabled={!committeeName.trim()} accessibilityRole="button" accessibilityLabel="Add committee">
            <Plus size={16} color={Colors.onPrimary} strokeWidth={2.4} />
            <Text style={styles.addText}>Add committee</Text>
          </Pressable>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={touched && !valid} />
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
  error: { ...Typography.labelSm, color: Colors.error },
  gap: { gap: Spacing.sm, marginTop: Spacing.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md },
  optionActive: { borderColor: Colors.primary },
  radio: { width: 22, height: 22, borderRadius: Radius.full, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: Colors.primary },
  optLabel: { ...Typography.labelLg, color: Colors.onSurface },
  optLabelActive: { color: Colors.primary },
  optHelp: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  chapterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  chapterName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  chapterLevel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addCard: { gap: Spacing.sm, marginTop: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary },
  addBtnDisabled: { opacity: 0.4 },
  addText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
