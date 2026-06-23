import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import DatePickerField from '@/components/DatePickerField';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, EditableListCard } from '@/features/doctor/components';
import { useSaveCarePlan } from '@/features/doctor/hooks';
import { CHRONIC_CONDITION_OPTIONS, CARE_PLAN_REVIEW_OPTIONS } from '@/features/doctor/constants';

const CURRENT_YEAR = new Date().getFullYear();

interface MilestoneDraft { title: string; dueDate: string }

// Section Q (Q13) — create a long-term care plan with milestones (EditableListCard
// for the repeatable milestone list).
export default function NewCarePlanScreen() {
  const { patientId, patientName } = useLocalSearchParams<{ patientId?: string; patientName?: string }>();
  const save = useSaveCarePlan();

  const [condition, setCondition] = useState('');
  const [goal, setGoal] = useState('');
  const [reviewEvery, setReviewEvery] = useState('');
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);

  const [mTitle, setMTitle] = useState('');
  const [mDue, setMDue] = useState('');

  const canSubmit = !!(patientId || true) && condition.trim().length > 0 && goal.trim().length > 0 && !!reviewEvery;

  const addMilestone = () => {
    if (!mTitle.trim() || !mDue) return;
    setMilestones((prev) => [...prev, { title: mTitle.trim(), dueDate: mDue }]);
    setMTitle('');
    setMDue('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      Alert.alert('Incomplete', 'Add a condition, goal and review cadence.');
      return;
    }
    try {
      const result = await save.mutateAsync({
        patientId: patientId ? String(patientId) : 'pat-4',
        condition: condition.trim(),
        goal: goal.trim(),
        reviewEvery,
        milestones,
      });
      Alert.alert('Care plan saved', `${result.ref} has been created.`, [
        { text: 'Done', onPress: () => router.replace('/(doctor)/care-plans') },
      ]);
    } catch {
      Alert.alert('Failed', 'Could not save the care plan. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="New Care Plan" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!patientName && <Text style={styles.patientLine}>For {patientName}</Text>}

          <SelectField label="Condition" placeholder="Select condition" value={condition} options={CHRONIC_CONDITION_OPTIONS} onChange={setCondition} />
          <TextInputField label="Goal" value={goal} onChangeText={setGoal} placeholder="e.g. HbA1c < 7%" />
          <SelectField label="Review every" placeholder="Select cadence" value={reviewEvery} options={CARE_PLAN_REVIEW_OPTIONS} onChange={setReviewEvery} searchable={false} />

          <SectionCard title="Milestones" style={styles.card}>
            {milestones.length === 0 ? (
              <Text style={styles.muted}>No milestones added yet.</Text>
            ) : (
              milestones.map((m, i) => (
                <EditableListCard
                  key={`${m.title}-${i}`}
                  title={m.title}
                  subtitle={`Due ${new Date(`${m.dueDate}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                  onRemove={() => setMilestones((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))
            )}
            <View style={styles.addBox}>
              <TextInputField label="Milestone" value={mTitle} onChangeText={setMTitle} placeholder="e.g. Quarterly HbA1c review" />
              <DatePickerField label="Due date" value={mDue} onChange={setMDue} minYear={CURRENT_YEAR} maxYear={CURRENT_YEAR + 3} />
              <Pressable style={styles.addBtn} onPress={addMilestone} accessibilityRole="button" accessibilityLabel="Add milestone">
                <Plus size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.addText}>Add milestone</Text>
              </Pressable>
            </View>
          </SectionCard>

          <PrimaryButton label="Save care plan" onPress={handleSubmit} loading={save.isPending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  flex:        { flex: 1 },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  patientLine: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  card:        { marginBottom: Spacing.md },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  addBox:      { marginTop: Spacing.sm },
  addBtn:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  addText:     { ...Typography.labelMd, color: Colors.primary },
  btn:         { marginTop: Spacing.sm },
});
