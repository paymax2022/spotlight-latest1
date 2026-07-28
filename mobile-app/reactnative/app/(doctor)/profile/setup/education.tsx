import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, EditableListCard, ToggleRow } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import { DEGREE_OPTIONS } from '@/features/doctor/constants';
import type { EducationEntry } from '@/types/doctor.profile';

const blank = (): EducationEntry => ({ id: `edu-${Date.now()}`, institution: '', degree: '', field: '', startYear: new Date().getFullYear(), endYear: undefined, isCurrent: false });
const toYear = (s: string): number => { const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

export default function EducationScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();

  const [list, setList] = useState<EducationEntry[] | null>(null);
  const [editing, setEditing] = useState<EducationEntry | null>(null);

  useEffect(() => {
    if (draft && list === null) setList(draft.education);
  }, [draft, list]);

  const items = list ?? [];
  const set = (patch: Partial<EducationEntry>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  const saveEntry = () => {
    if (!editing || !editing.institution.trim() || !editing.degree.trim()) return;
    setList((prev) => {
      const base = prev ?? [];
      return base.some((x) => x.id === editing.id) ? base.map((x) => (x.id === editing.id ? editing : x)) : [...base, editing];
    });
    setEditing(null);
  };

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { education: items, completedSteps: [...new Set([...draft.completedSteps, 'education' as const])] } });
      router.push('/(doctor)/profile/setup/work-experience');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Education" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || list === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Education" />
        <StateView variant="error" message="We could not load your education history." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Education" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={14} total={19} label="Education history" />

          <SectionCard title="Qualifications" style={styles.card}>
            <Text style={styles.hint}>Add your degrees and qualifications.</Text>

            {items.length === 0 && !editing && <Text style={styles.empty}>No education added yet.</Text>}

            {items.map((e) => (
              <EditableListCard
                key={e.id}
                title={e.institution}
                subtitle={[e.degree, e.field].filter(Boolean).join(' · ')}
                meta={`${e.startYear} – ${e.isCurrent ? 'Present' : e.endYear ?? ''}`}
                onEdit={() => setEditing(e)}
                onRemove={() => setList((prev) => (prev ?? []).filter((x) => x.id !== e.id))}
              />
            ))}

            {editing ? (
              <View style={styles.form}>
                <TextInputField label="Institution" placeholder="e.g. University of Lagos" value={editing.institution} onChangeText={(institution) => set({ institution })} />
                <SelectField label="Degree" placeholder="Select degree" value={editing.degree || undefined} options={DEGREE_OPTIONS} onChange={(degree) => set({ degree })} />
                <TextInputField label="Field of study" placeholder="e.g. Medicine & Surgery" value={editing.field ?? ''} onChangeText={(field) => set({ field })} />
                <View style={styles.row}>
                  <View style={styles.half}>
                    <TextInputField label="Start year" placeholder="2004" value={editing.startYear ? String(editing.startYear) : ''} onChangeText={(v) => set({ startYear: toYear(v) })} keyboardType="number-pad" maxLength={4} />
                  </View>
                  <View style={styles.half}>
                    <TextInputField label="End year" placeholder="2010" value={editing.endYear ? String(editing.endYear) : ''} onChangeText={(v) => set({ endYear: toYear(v) || undefined })} keyboardType="number-pad" maxLength={4} editable={!editing.isCurrent} />
                  </View>
                </View>
                <ToggleRow label="Currently studying here" value={editing.isCurrent} onValueChange={(isCurrent) => set({ isCurrent, endYear: isCurrent ? undefined : editing.endYear })} />
                <View style={styles.formActions}>
                  <PrimaryButton label="Cancel" onPress={() => setEditing(null)} variant="secondary" style={styles.formBtn} />
                  <PrimaryButton label="Save" onPress={saveEntry} disabled={!editing.institution.trim() || !editing.degree.trim()} style={styles.formBtn} />
                </View>
              </View>
            ) : (
              <Pressable style={styles.addBtn} onPress={() => setEditing(blank())} accessibilityRole="button" accessibilityLabel="Add education">
                <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
                <Text style={styles.addText}>Add education</Text>
              </Pressable>
            )}
          </SectionCard>

          <PrimaryButton label="Continue" onPress={handleNext} loading={save.isPending} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  card:        { marginBottom: Spacing.md },
  hint:        { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  empty:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  form:        { marginTop: Spacing.xs, gap: Spacing.xs },
  row:         { flexDirection: 'row', gap: Spacing.sm },
  half:        { flex: 1 },
  formActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  formBtn:     { flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginTop: Spacing.xs },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  btn:         { marginTop: Spacing.sm },
});
