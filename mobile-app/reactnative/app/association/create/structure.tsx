import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, X, Users, MapPin, ShieldCheck } from 'lucide-react-native';
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
import { APPROVAL_RULE_OPTIONS, STRUCTURE_TYPE_OPTIONS } from '@/features/association/constants/orgWizard.constants';
import { STATE_NAMES } from '@/data/nigeria';
import type { StructureType } from '@/features/association/types/orgDraft.types';

const stateId = (state: string) => `st_${state}`;

/** Stable id for the single-structure chapter row, so editing replaces it. */
const SINGLE_CHAPTER_ID = 'ch_single';

/**
 * What the backend names a chapter when the founder names none. Mirrors
 * association.DefaultChapterName in backend/internal/association/service_ext.go;
 * shown here only so the hint tells the truth about what will be created.
 */
const DEFAULT_CHAPTER_NAME = 'Home';

export default function WizardStructure() {
  const {
    draft, patch,
    addStateLeader, updateStateLeader, removeStateLeader,
    addChapter, removeChapter,
    addCommittee, removeCommittee,
  } = useOrgDraft();
  const [touched, setTouched] = useState(false);
  const [committeeName, setCommitteeName] = useState('');

  const statewide = draft.structureType === 'STATEWIDE';
  const isSelected = (state: string) => draft.stateLeaders.some((l) => l.state === state);

  const setStructure = (t: StructureType) => {
    patch({ structureType: t });
    // Leaving statewide clears the state config so it isn't published by accident.
    if (t === 'SINGLE' && draft.stateLeaders.length > 0) {
      draft.stateLeaders.forEach((l) => removeChapter(l.id));
      patch({ stateLeaders: [] });
    }
    // And the reverse: the single-structure chapter belongs to the SINGLE path
    // only. Left behind, it would publish alongside the state chapters as a
    // stray extra the founder never sees on this screen again.
    if (t === 'STATEWIDE') {
      removeChapter(SINGLE_CHAPTER_ID);
    }
  };

  const toggleState = (state: string) => {
    const id = stateId(state);
    if (isSelected(state)) {
      removeStateLeader(id);
      removeChapter(id);
    } else {
      addStateLeader({ id, state, leaderName: '', leaderContact: '', canApproveMembers: true });
      addChapter({ id, name: state, level: 'STATE' });
    }
  };

  // The single-structure chapter is one row, edited in place — not a list to
  // add to. Typing replaces it; clearing it removes the row entirely so the
  // backend sees "no chapters named" and applies its default, rather than an
  // empty-named chapter.
  const setSingleChapter = (name: string) => {
    patch({ chapters: name.trim() ? [{ id: SINGLE_CHAPTER_ID, name, level: 'LOCAL' }] : [] });
  };

  const onAddCommittee = () => {
    if (!committeeName.trim()) return;
    addCommittee({ id: `cm_${Date.now()}`, name: committeeName.trim() });
    setCommitteeName('');
  };

  const valid = Boolean(draft.approvalRule) && (!statewide || draft.stateLeaders.length > 0);

  const next = () => { setTouched(true); if (valid) router.push('/association/create/membership'); };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Create organisation" />
      <WizardProgress step={2} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Approval rule */}
        <Text style={styles.label}>Approval rule</Text>
        {touched && !draft.approvalRule ? <Text style={styles.error}>Choose an approval rule</Text> : null}
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

        {/* Leadership structure */}
        <Text style={[styles.label, styles.sectionGap]}>Leadership structure</Text>
        <Text style={styles.help}>Does the association operate across states, or as one central body?</Text>
        <View style={styles.gap}>
          {STRUCTURE_TYPE_OPTIONS.map((opt) => {
            const active = draft.structureType === opt.value;
            return (
              <Pressable key={opt.value} onPress={() => setStructure(opt.value)} style={[styles.option, active && styles.optionActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optLabel, active && styles.optLabelActive]}>{opt.label}</Text>
                  <Text style={styles.optHelp}>{opt.help}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Statewide: pick states + appoint leaders (only when STATEWIDE) */}
        {statewide ? (
          <>
            <Text style={[styles.label, styles.sectionGap]}>Applicable states</Text>
            <Text style={styles.help}>Select the states this association operates in.</Text>
            {touched && draft.stateLeaders.length === 0 ? <Text style={styles.error}>Select at least one state</Text> : null}
            <View style={styles.stateGrid}>
              {STATE_NAMES.map((state) => {
                const active = isSelected(state);
                return (
                  <Pressable key={state} onPress={() => toggleState(state)} style={[styles.stateChip, active && styles.stateChipActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                    <Text style={[styles.stateChipText, active && styles.stateChipTextActive]}>{state}</Text>
                  </Pressable>
                );
              })}
            </View>

            {draft.stateLeaders.length > 0 ? (
              <>
                <Text style={[styles.label, styles.sectionGap]}>State leaders</Text>
                <Text style={styles.help}>Appoint a leader per state and choose whether they can approve members there.</Text>
                <View style={styles.gap}>
                  {draft.stateLeaders.map((l) => (
                    <View key={l.id} style={[styles.leaderCard, shadow1]}>
                      <View style={styles.leaderHead}>
                        <MapPin size={16} color={Colors.primary} strokeWidth={2} />
                        <Text style={styles.leaderState}>{l.state}</Text>
                        <Pressable onPress={() => toggleState(l.state)} hitSlop={8} accessibilityLabel={`Remove ${l.state}`}>
                          <X size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />
                        </Pressable>
                      </View>
                      <TextInputField placeholder="State leader name" value={l.leaderName} onChangeText={(v) => updateStateLeader(l.id, { leaderName: v })} />
                      <TextInputField placeholder="Leader phone or email (optional)" value={l.leaderContact} onChangeText={(v) => updateStateLeader(l.id, { leaderContact: v })} autoCapitalize="none" />
                      <View style={styles.mandateRow}>
                        <ShieldCheck size={16} color={Colors.secondary} strokeWidth={2} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.mandateLabel}>Can approve members</Text>
                          <Text style={styles.mandateHelp}>Mandate this leader to act on and approve members in {l.state}.</Text>
                        </View>
                        <Switch
                          value={l.canApproveMembers}
                          onValueChange={(v) => updateStateLeader(l.id, { canApproveMembers: v })}
                          trackColor={{ true: Colors.primary, false: Colors.outlineVariant }}
                          thumbColor={Colors.white}
                          accessibilityLabel={`Can approve members in ${l.state}`}
                        />
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {/* Chapter — a plain optional field, not a picker.
            The state multi-select above is the STATEWIDE path, where chapters
            are derived from the states chosen. An organisation that is not
            organised by state still wants somewhere to file its members, and
            forcing that through a list of Nigerian states was the wrong shape
            for it. Left blank, the backend names the chapter "Home" — every
            organisation ends up with at least one either way. */}
        {!statewide ? (
          <>
            <Text style={[styles.label, styles.sectionGap]}>Chapter (optional)</Text>
            <Text style={styles.help}>Name your first chapter or branch. Leave it blank and we&apos;ll call it &ldquo;{DEFAULT_CHAPTER_NAME}&rdquo;.</Text>
            <TextInputField
              placeholder={`e.g. Ikeja Branch — blank means "${DEFAULT_CHAPTER_NAME}"`}
              value={draft.chapters[0]?.name ?? ''}
              onChangeText={setSingleChapter}
            />
          </>
        ) : null}

        {/* Committees (always available) */}
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
  stateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  stateChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  stateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stateChipText: { ...Typography.labelMd, color: Colors.onSurface },
  stateChipTextActive: { color: Colors.onPrimary, fontWeight: '700' as const },
  leaderCard: { gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  leaderHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  leaderState: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  mandateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  mandateLabel: { ...Typography.labelMd, color: Colors.onSurface },
  mandateHelp: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 2 },
  chapterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  chapterName: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  addCard: { gap: Spacing.sm, marginTop: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary },
  addBtnDisabled: { opacity: 0.4 },
  addText: { ...Typography.labelMd, color: Colors.onPrimary, fontWeight: '700' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
