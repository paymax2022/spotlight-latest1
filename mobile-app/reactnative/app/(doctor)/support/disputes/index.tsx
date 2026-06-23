import React from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, DisputeRow } from '@/features/doctor/components';
import PrimaryButton from '@/components/PrimaryButton';
import { useDisputes } from '@/features/doctor/hooks';

// ── Section AA — Dispute list (AA.7-14 as one Dispute union) ───────────────────
// NEW screen: the unified dispute list. The eight dispute kinds collapse to one
// Dispute union rendered through the reusable DisputeRow. Tapping a row opens the
// dispute detail; the CTA opens the create-dispute flow.

export default function DisputesScreen() {
  const { data: disputes = [], isLoading, isError, refetch } = useDisputes();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Disputes" />
      {isLoading && disputes.length === 0 ? (
        <StateView variant="loading" label="Loading disputes" />
      ) : isError ? (
        <StateView variant="error" message="We could not load your disputes." onRetry={() => refetch()} />
      ) : disputes.length === 0 ? (
        <View style={styles.emptyWrap}>
          <StateView variant="empty" icon={AlertTriangle} title="No disputes" message="Disputes you raise will appear here." />
          <PrimaryButton label="Raise a dispute" onPress={() => router.push('/(doctor)/support/disputes/new')} style={styles.emptyBtn} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.list}>
            {disputes.map((d) => (
              <DisputeRow key={d.id} dispute={d} onPress={() => router.push({ pathname: '/(doctor)/support/dispute/[id]', params: { id: d.id } })} />
            ))}
          </View>
          <PrimaryButton label="Raise a dispute" onPress={() => router.push('/(doctor)/support/disputes/new')} style={styles.btn} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.background },
  content:   { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  list:      { gap: Spacing.sm, marginBottom: Spacing.lg },
  btn:       { marginTop: Spacing.sm },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.containerMargin },
  emptyBtn:  { marginTop: Spacing.md },
});
