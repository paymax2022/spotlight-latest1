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
import { NIGERIAN_STATES } from '@/features/doctor/constants';
import type { ClinicAffiliation } from '@/types/doctor.profile';

const blank = (): ClinicAffiliation => ({ id: `aff-${Date.now()}`, name: '', role: '', state: undefined, city: '', isPrimary: false });

export default function AffiliationsScreen() {
  const { data: draft, isLoading, isError, refetch } = useProfileDraft();
  const save = useSaveProfileDraft();

  const [list, setList] = useState<ClinicAffiliation[] | null>(null);
  const [editing, setEditing] = useState<ClinicAffiliation | null>(null);

  useEffect(() => {
    if (draft && list === null) setList(draft.affiliations);
  }, [draft, list]);

  const items = list ?? [];
  const set = (patch: Partial<ClinicAffiliation>) => setEditing((e) => (e ? { ...e, ...patch } : e));

  const saveEntry = () => {
    if (!editing || !editing.name.trim()) return;
    setList((prev) => {
      const base = prev ?? [];
      const next = base.some((a) => a.id === editing.id) ? base.map((a) => (a.id === editing.id ? editing : a)) : [...base, editing];
      return editing.isPrimary ? next.map((a) => ({ ...a, isPrimary: a.id === editing.id })) : next;
    });
    setEditing(null);
  };

  const handleNext = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync({ draft: { affiliations: items, completedSteps: [...new Set([...draft.completedSteps, 'affiliations' as const])] } });
      router.push('/(doctor)/profile/setup/education');
    } catch { /* surfaced */ }
  };

  if (isLoading && !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Affiliations" />
        <StateView variant="loading" label="Loading" />
      </SafeAreaView>
    );
  }

  if (isError || !draft || list === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Affiliations" />
        <StateView variant="error" message="We could not load your affiliations." onRetry={() => refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Affiliations" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <WizardProgress current={13} total={19} label="Hospital/clinic affiliation" />

          <SectionCard title="Where you practise" style={styles.card}>
            <Text style={styles.hint}>Add the hospitals or clinics you are affiliated with.</Text>

            {items.length === 0 && !editing && <Text style={styles.empty}>No affiliations added yet.</Text>}

            {items.map((a) => (
              <EditableListCard
                key={a.id}
                title={a.name}
                subtitle={a.role}
                meta={[a.city, a.state].filter(Boolean).join(', ')}
                badge={a.isPrimary ? 'Primary' : undefined}
                onEdit={() => setEditing(a)}
                onRemove={() => setList((prev) => (prev ?? []).filter((x) => x.id !== a.id))}
              />
            ))}

            {editing ? (
              <View style={styles.form}>
                <TextInputField label="Clinic / hospital name" placeholder="e.g. Lagoon Medical Centre" value={editing.name} onChangeText={(name) => set({ name })} />
                <TextInputField label="Your role" placeholder="e.g. Consultant" value={editing.role ?? ''} onChangeText={(role) => set({ role })} />
                <SelectField label="State" placeholder="Select state" value={editing.state} options={NIGERIAN_STATES} onChange={(state) => set({ state })} />
                <TextInputField label="City" placeholder="e.g. Lagos" value={editing.city ?? ''} onChangeText={(city) => set({ city })} />
                <ToggleRow label="Primary place of practice" value={editing.isPrimary} onValueChange={(isPrimary) => set({ isPrimary })} />
                <View style={styles.formActions}>
                  <PrimaryButton label="Cancel" onPress={() => setEditing(null)} variant="secondary" style={styles.formBtn} />
                  <PrimaryButton label="Save" onPress={saveEntry} disabled={!editing.name.trim()} style={styles.formBtn} />
                </View>
              </View>
            ) : (
              <Pressable style={styles.addBtn} onPress={() => setEditing(blank())} accessibilityRole="button" accessibilityLabel="Add affiliation">
                <Plus size={18} color={Colors.primary} strokeWidth={2.4} />
                <Text style={styles.addText}>Add an affiliation</Text>
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
  formActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  formBtn:     { flex: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.primaryFixed, marginTop: Spacing.xs },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  btn:         { marginTop: Spacing.sm },
});
