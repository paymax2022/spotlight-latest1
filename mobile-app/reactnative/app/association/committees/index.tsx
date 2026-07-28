import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Users, ChevronRight, Check, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import StateView from '@/components/StateView';
import { useCommittees } from '@/features/association/hooks/useCommunity';
import { formatCount } from '@/features/association/utils/associationFormatters';
import type { CommitteeSummary } from '@/features/association/types/community.types';

export default function CommitteesList() {
  const committees = useCommittees();
  const mine = (committees.data ?? []).filter((c) => c.joinStatus === 'MEMBER');
  const others = (committees.data ?? []).filter((c) => c.joinStatus !== 'MEMBER');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Committees" />
      {committees.isLoading ? (
        <StateView kind="loading" message="Loading committees…" />
      ) : committees.isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => committees.refetch()} />
      ) : (committees.data?.length ?? 0) === 0 ? (
        <StateView kind="empty" icon="Users" title="No committees" message="Committees will appear here." />
      ) : (
        <FlatList
          data={others}
          keyExtractor={(c) => c.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            mine.length > 0 ? (
              <>
                <SectionHeader title="My committees" style={styles.firstHeader} />
                <View style={styles.gap}>
                  {mine.map((c) => <CommitteeCard key={c.id} committee={c} />)}
                </View>
                {others.length > 0 ? <SectionHeader title="Discover" style={styles.sectionGap} /> : null}
              </>
            ) : <SectionHeader title="All committees" style={styles.firstHeader} />
          }
          renderItem={({ item }) => <CommitteeCard committee={item} />}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        />
      )}
    </SafeAreaView>
  );
}

function CommitteeCard({ committee: c }: { committee: CommitteeSummary }) {
  return (
    <Pressable
      onPress={() => router.push(`/association/committees/${c.id}`)}
      accessibilityRole="button"
      accessibilityLabel={c.name}
      style={({ pressed }) => [styles.card, shadow1, pressed && styles.pressed]}
    >
      <View style={styles.iconBox}><Users size={20} color={Colors.primary} strokeWidth={2} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
        <Text style={styles.purpose} numberOfLines={1}>{c.purpose}</Text>
        <Text style={styles.meta}>{formatCount(c.memberCount, 'members')}</Text>
      </View>
      {c.joinStatus === 'MEMBER' ? (
        <View style={[styles.statusChip, { backgroundColor: Colors.iconBgTeal }]}>
          {c.myRole && c.myRole !== 'Member' ? <Text style={[styles.statusText, { color: Colors.teal }]}>{c.myRole}</Text>
            : <><Check size={11} color={Colors.teal} strokeWidth={2.6} /><Text style={[styles.statusText, { color: Colors.teal }]}>Member</Text></>}
        </View>
      ) : c.joinStatus === 'PENDING' ? (
        <View style={[styles.statusChip, { backgroundColor: Colors.iconBgGold }]}>
          <Clock size={11} color={Colors.gold} strokeWidth={2.4} /><Text style={[styles.statusText, { color: Colors.gold }]}>Pending</Text>
        </View>
      ) : (
        <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 120 },
  firstHeader: { paddingHorizontal: 0, marginTop: Spacing.sm },
  sectionGap: { paddingHorizontal: 0, marginTop: Spacing.lg },
  gap: { gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md },
  pressed: { opacity: 0.9 },
  iconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  purpose: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  meta: { ...Typography.caption, color: Colors.outline },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  statusText: { ...Typography.caption, fontWeight: '700' as const },
});
