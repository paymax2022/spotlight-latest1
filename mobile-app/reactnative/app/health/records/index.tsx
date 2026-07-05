import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import SegmentedControl from '@/components/SegmentedControl';
import { RecordCard } from '@/features/health/components';
import { useSubjects, useRecords } from '@/features/health/hooks';

export default function RecordsVaultScreen() {
  const [subjectId, setSubjectId] = useState<string>('all');
  const { data: subjects } = useSubjects();
  const { data: records, isLoading, isError, refetch, isRefetching } = useRecords(
    subjectId === 'all' ? undefined : { subjectId },
  );

  const segments = useMemo(
    () => [
      { value: 'all', label: 'All' },
      ...(subjects ?? []).map((s) => ({ value: s.id, label: s.name })),
    ],
    [subjects],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Records vault" subtitle="Patient & pet health records" />

      {/* NDPA assurance strip (HL-8) */}
      <View style={styles.privacy}>
        <Lock size={13} color={Colors.teal} strokeWidth={2} />
        <Text style={styles.privacyText}>Encrypted & access-logged. Only shared with your consent.</Text>
      </View>

      <View style={styles.segmentWrap}>
        <SegmentedControl options={segments} value={subjectId} onChange={setSubjectId} scrollable />
      </View>

      {isLoading ? (
        <StateView kind="loading" message="Loading records…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load records" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={records ?? []}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <RecordCard
              record={item}
              showSubject={subjectId === 'all'}
              onPress={() => router.push({ pathname: '/health/records/[id]', params: { id: item.id } })}
            />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="FileHeart"
              title="No records here"
              message="Records from consults, prescriptions and lab tests will appear here."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: Spacing.containerMargin,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 7,
  },
  privacyText: { ...Typography.caption, color: Colors.tertiaryContainer, flex: 1 },
  segmentWrap: { marginBottom: Spacing.md },
  list: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 100, flexGrow: 1 },
});
