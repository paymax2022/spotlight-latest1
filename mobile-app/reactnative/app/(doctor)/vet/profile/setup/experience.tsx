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
import { useVetProfileDraft, useSaveVetProfileDraft } from '@/features/doctor/hooks';
import type { WorkExperienceEntry } from '@/types/doctor.batch1';

const blank = (): WorkExperienceEntry => ({ id: `exp-${Date.now()}`, organisation: '', role: '', location: '', startYear: new Date().getFullYear(), isCurrent: true });

const toYear = (s: string): number => { const n = parseInt(s.replace(/[^0-9]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };

export default function VetExperienceScreen() {
  const { data: draft, isLoading, isError, refetch } = useVetProfileDraft();
  const save = useSaveVetProfileDraft();

  const [list, setList] = useState<WorkExperienceEntry[] | null>(null);
  const [editing, setEditing] = useState<WorkExperienceEntry | null>(null);

  useEffect(() => {
    if (draft && list === null) setList(draft.workExperience);
  }, [draft, list]);

  const items = list ?? [];
  const set = (patch: Partial<WorkExperienceEntry>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  const saveEntry = () => {
    if (!editing || !editing.organisation.trim()) return;
    setList((prev) => {
      const base = prev ?? [];
      return base.some((x) => x.id === editing.id) ? base.map((x) => (x.id === editing.id ? editing : x)) : [...base, editing];
    });
    setEditing(null);
  };

  const totalYears = items.reduce((sum, e) => sum + Math.max(0, (e.endYear ?? new Date().getFullYear()) - e.startYear), 0);

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { workExperience: items, yearsExperience: totalYears, completedSteps: [...new Set([...draft.completedSteps, 'experience' as const])] } });
      router.push('/(doctor)/vet/profile/setup/pricing');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Experience history" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || list === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Experience history" />
        <StateView variant="error" message="We could not load your experience." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Experience history" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={8} total={10} label="Experience history" />

          <SectionCard title="Your work history" style={styles.card}>
            <Text style={styles.hint}>Add your veterinary roles. We total your years of experience automatically.</Text>

            {items.length === 0 && !editing && <Text style={styles.empty}>No experience added yet.</Text>}

            {items.map((e) => (
              <EditableListCard
                key={e.id}
                title={e.organisation}
                subtitle={e.role}
                meta={`${e.startYear} – ${e.isCurrent ? 'Present' : e.endYear ?? ''}${e.location ? ` · ${e.location}` : ''}`}
                badge={e.isCurrent ? 'Current' : undefined}
                onEdit={() => setEditing(e)}
                onRemove={() => setList((prev) => (prev ?? []).filter((x) => x.id !== e.id))}
              />
            ))}

            {editing ? (
              <View style={styles.form}>
                <TextInputField label="Organisation" placeholder="e.g. Greenfield Vet Clinic" value={editing.organisation} onChangeText={(organisation) => set({ organisation })} />
                <TextInputField label="Role" placeholder="e.g. Consultant Veterinarian" value={editing.role} onChangeText={(role) => set({ role })} />
                <TextInputField label="Location" placeholder="e.g. Lagos, NG" value={editing.location ?? ''} onChangeText={(location) => set({ location })} />
                <View style={styles.yearRow}>
                  <View style={styles.half}>
                    <TextInputField label="Start year" placeholder="2018" value={editing.startYear ? String(editing.startYear) : ''} onChangeText={(v) => set({ startYear: toYear(v) })} keyboardType="number-pad" />
                  </View>
                  <View style={styles.half}>
                    <TextInputField label="End year" placeholder="2024" value={editing.endYear ? String(editing.endYear) : ''} onChangeText={(v) => set({ endYear: v ? toYear(v) : undefined })} keyboardType="number-pad" editable={!editing.isCurrent} />
                  </View>
                </View>
                <ToggleRow label="I currently work here" value={editing.isCurrent} onValueChange={(isCurrent) => set({ isCurrent, endYear: isCurrent ? undefined : editing.endYear })} />
                <View style={styles.formActions}>
                  <PrimaryButton label="Cancel" onPress={() => setEditing(null)} variant="secondary" style={styles.formBtn} />
                  <PrimaryButton label="Save" onPress={saveEntry} disabled={!editing.organisation.trim()} style={styles.formBtn} />
                </View>
              </View>
            ) : (
              <Pressable style={styles.addBtn} onPress={() => setEditing(blank())} accessibilityRole="button" accessibilityLabel="Add experience">
                <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
                <Text style={styles.addText}>Add experience</Text>
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
  yearRow:     { flexDirection: 'row', gap: Spacing.sm },
  half:        { flex: 1 },
  formActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  formBtn:     { flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginTop: Spacing.xs },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  btn:         { marginTop: Spacing.sm },
});
