import React from 'react';
import { ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Lightbulb, Flame, Activity, Leaf } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, AlertCard } from '@/features/doctor/components';
import { useImprovementRecommendations } from '@/features/doctor/hooks';
import type { ImprovementPriority } from '@/types/doctor.batch6';

const PRIORITY_TONE: Record<ImprovementPriority, 'critical' | 'warning' | 'info'> = {
  high:   'critical',
  medium: 'warning',
  low:    'info',
};
const PRIORITY_ICON: Record<ImprovementPriority, LucideIcon> = {
  high:   Flame,
  medium: Activity,
  low:    Leaf,
};

// Z.12: improvement recommendations. Reuses AlertCard (priority-toned) to list
// each recommendation with an estimated uplift CTA.
export default function ImprovementRecommendationsScreen() {
  const { data: recs = [], isLoading, isError, refetch } = useImprovementRecommendations();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Improve Your Score" />

      {isLoading && recs.length === 0 ? (
        <StateView variant="loading" label="Loading recommendations" />
      ) : isError ? (
        <StateView variant="error" message="We could not load recommendations." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {recs.length === 0 ? (
            <StateView variant="empty" icon={Lightbulb} title="You're doing great" message="No improvement recommendations right now." />
          ) : (
            recs.map((r) => (
              <AlertCard
                key={r.id}
                icon={PRIORITY_ICON[r.priority]}
                tone={PRIORITY_TONE[r.priority]}
                title={r.title}
                body={typeof r.potentialUpliftPct === 'number' ? `${r.detail}\n\nPotential impact: up to +${r.potentialUpliftPct}% quality score.` : r.detail}
              />
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
});
