import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Plus, Vote } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useElections } from '@/features/association/hooks';
import type { ElectionSummary } from '@/features/association/types/association.types';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  NOMINATION: 'Nominations',
  VOTING: 'Voting open',
  CLOSED: 'Voting closed',
  PUBLISHED: 'Results published',
  CANCELLED: 'Cancelled',
};

// Officer view of every election in the organisation. Writes are gated
// server-side (requireElectionOfficer); this list is the same read members get.
export default function AdminElections() {
  const elections = useElections();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Elections" backFallback="/association/admin" />
      {elections.isLoading ? (
        <StateView kind="loading" message="Loading elections…" />
      ) : elections.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => elections.refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Pressable
            onPress={() => router.push('/association/admin/elections/new')}
            style={[styles.newButton, shadow1]}
            accessibilityRole="button"
            accessibilityLabel="Create a new election"
          >
            <Plus size={18} color={Colors.onPrimary ?? '#fff'} strokeWidth={2.2} />
            <Text style={styles.newButtonText}>New election</Text>
          </Pressable>

          {!elections.data?.length ? (
            <StateView kind="empty" compact icon="Vote" title="No elections yet" message="Create an election to open nominations and voting for members." />
          ) : (
            elections.data.map((e) => <ElectionRow key={e.id} election={e} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ElectionRow({ election }: { election: ElectionSummary }) {
  return (
    <Pressable
      onPress={() => router.push(`/association/admin/elections/${election.id}`)}
      style={[styles.card, shadow1]}
      accessibilityRole="button"
      accessibilityLabel={`Manage election ${election.title}`}
    >
      <View style={styles.iconWrap}><Vote size={22} color={Colors.primary} strokeWidth={2} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={2}>{election.title}</Text>
        <Text style={styles.meta}>{STATUS_LABEL[election.status] ?? election.status} · {election.positionCount} position{election.positionCount === 1 ? '' : 's'}</Text>
      </View>
      <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  scroll: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  newButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: Spacing.sm + 2, marginBottom: Spacing.xs },
  newButtonText: { ...Typography.labelLg, color: Colors.onPrimary ?? '#fff' },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  meta: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 1 },
});
