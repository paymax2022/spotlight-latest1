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
import PrimaryButton from '@/components/PrimaryButton';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, StateView, WizardProgress, EditableListCard, ToggleRow } from '@/features/doctor/components';
import { useProfileDraft, useSaveProfileDraft } from '@/features/doctor/hooks';
import type { WorkExperienceEntry } from '@/types/doctor.profile';

const blank = (): WorkExperienceEntry => ({ id: `work-${Date.now()}`, organisation: '', role: '', location: '', startYear: new Date().getFullYear(), endYear: undefined, isCurrent: false, description: '' });
const toYear = (s: string): number => { const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

export default function WorkExperienceScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();

  const [list, setList] = useState<WorkExperienceEntry[] | null>(null);
  const [editing, setEditing] = useState<WorkExperienceEntry | null>(null);

  useEffect(() => {
    if (draft && list === null) setList(draft.workExperience);
  }, [draft, list]);

  const items = list ?? [];
  const set = (patch: Partial<WorkExperienceEntry>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  const saveEntry = () => {
    if (!editing || !editing.organisation.trim() || !editing.role.trim()) return;
    setList((prev) => {
      const base = prev ?? [];
      return base.some((x) => x.id === editing.id) ? base.map((x) => (x.id === editing.id ? editing : x)) : [...base, editing];
    });
    setEditing(null);
  };

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { workExperience: items, completedSteps: [...new Set([...draft.completedSteps, 'work_experience' as const])] } });
      router.push('/(doctor)/profile/setup/pricing');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Work experience" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || list === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Work experience" />
        <StateView variant="error" message="We could not load your work experience." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Work experience" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={15} total={19} label="Work experience" />

          <SectionCard title="Employment history" style={styles.card}>
            <Text style={styles.hint}>Add your relevant clinical roles.</Text>

            {items.length === 0 && !editing && <Text style={styles.empty}>No work experience added yet.</Text>}

            {items.map((w) => (
              <EditableListCard
                key={w.id}
                title={w.organisation}
                subtitle={w.role}
                meta={`${w.startYear} – ${w.isCurrent ? 'Present' : w.endYear ?? ''}${w.location ? ` · ${w.location}` : ''}`}
                badge={w.isCurrent ? 'Current' : undefined}
                onEdit={() => setEditing(w)}
                onRemove={() => setList((prev) => (prev ?? []).filter((x) => x.id !== w.id))}
              />
            ))}

            {editing ? (
              <View style={styles.form}>
                <TextInputField label="Organisation" placeholder="e.g. Lagoon Medical Centre" value={editing.organisation} onChangeText={(organisation) => set({ organisation })} />
                <TextInputField label="Role" placeholder="e.g. Consultant Family Physician" value={editing.role} onChangeText={(role) => set({ role })} />
                <TextInputField label="Location" placeholder="e.g. Lagos, NG" value={editing.location ?? ''} onChangeText={(location) => set({ location })} />
                <View style={styles.row}>
                  <View style={styles.half}>
                    <TextInputField label="Start year" placeholder="2018" value={editing.startYear ? String(editing.startYear) : ''} onChangeText={(v) => set({ startYear: toYear(v) })} keyboardType="number-pad" maxLength={4} />
                  </View>
                  <View style={styles.half}>
                    <TextInputField label="End year" placeholder="2022" value={editing.endYear ? String(editing.endYear) : ''} onChangeText={(v) => set({ endYear: toYear(v) || undefined })} keyboardType="number-pad" maxLength={4} editable={!editing.isCurrent} />
                  </View>
                </View>
                <ToggleRow label="I currently work here" value={editing.isCurrent} onValueChange={(isCurrent) => set({ isCurrent, endYear: isCurrent ? undefined : editing.endYear })} />
                <TextInputField label="Description (optional)" placeholder="Key responsibilities" value={editing.description ?? ''} onChangeText={(description) => set({ description })} multiline style={styles.textArea} />
                <View style={styles.formActions}>
                  <PrimaryButton label="Cancel" onPress={() => setEditing(null)} variant="secondary" style={styles.formBtn} />
                  <PrimaryButton label="Save" onPress={saveEntry} disabled={!editing.organisation.trim() || !editing.role.trim()} style={styles.formBtn} />
                </View>
              </View>
            ) : (
              <Pressable style={styles.addBtn} onPress={() => setEditing(blank())} accessibilityRole="button" accessibilityLabel="Add work experience">
                <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
                <Text style={styles.addText}>Add work experience</Text>
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
  textArea:    { minHeight: 80, textAlignVertical: 'top' },
  formActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  formBtn:     { flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginTop: Spacing.xs },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  btn:         { marginTop: Spacing.sm },
});
