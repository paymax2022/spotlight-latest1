import React from 'react';
import { Text, ScrollView, StyleSheet, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GraduationCap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { TeleHeader } from '@/features/telemedicine/components';
import { SectionCard, InfoRow, StateView, TrainingModuleRow } from '@/features/doctor/components';
import { useMandatoryTraining, useCompleteTrainingModule } from '@/features/doctor/hooks';

// ── Section AB — Mandatory training (AB.13) ───────────────────────────────────
// NEW screen: required + optional training modules with a "Mark complete" action
// (TrainingModuleRow). Reuses SectionCard / InfoRow.

export default function MandatoryTrainingScreen() {
  const { data: training, isLoading, isError, refetch } = useMandatoryTraining();
  const complete = useCompleteTrainingModule();

  const handleComplete = async (moduleId: string) => {
    try {
      await complete.mutateAsync({ moduleId });
    } catch {
      Alert.alert('Failed', 'Could not mark the module complete. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Mandatory Training" />
      {isLoading && !training ? (
        <StateView variant="loading" label="Loading training" />
      ) : isError || !training ? (
        <StateView variant="error" message="We could not load your training." onRetry={() => refetch()} />
      ) : training.modules.length === 0 ? (
        <StateView variant="empty" icon={GraduationCap} title="No training assigned" message="Required training will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <SectionCard style={styles.card}>
            <InfoRow label="Completed" value={`${training.completedCount} of ${training.totalRequired} required`} />
            {!!training.nextDueAt && <InfoRow label="Next due" value={new Date(`${training.nextDueAt}T00:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })} />}
          </SectionCard>

          <Text style={styles.groupTitle}>Modules</Text>
          <SectionCard style={styles.card}>
            {training.modules.map((m, i) => (
              <TrainingModuleRow
                key={m.id}
                module={m}
                border={i > 0}
                onComplete={() => handleComplete(m.id)}
                completing={complete.isPending && complete.variables?.moduleId === m.id}
              />
            ))}
          </SectionCard>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  content:    { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  card:       { marginBottom: Spacing.md },
  groupTitle: { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.sm },
});
