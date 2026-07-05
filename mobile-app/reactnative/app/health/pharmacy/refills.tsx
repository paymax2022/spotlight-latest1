import React from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RefreshCw, Calendar, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useRefills, useScheduleRefill } from '@/features/health/pharmacy/hooks';
import { formatDate } from '@/features/health/constants/health.constants';

export default function RefillsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useRefills();
  const schedule = useScheduleRefill();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Refills" subtitle="Never run out of your meds" />

      {isLoading ? (
        <StateView kind="loading" message="Loading refills…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={isRefetching}
          renderItem={({ item }) => {
            const dueSoon = +new Date(item.dueAt) - Date.now() < 7 * 86_400_000;
            return (
              <View style={[styles.card, shadow1]}>
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: Colors.iconBgTeal }]}>
                    <RefreshCw size={20} color={Colors.teal} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.medicationName}</Text>
                    <Text style={styles.form}>{item.form}</Text>
                  </View>
                </View>

                <View style={styles.dueRow}>
                  <Calendar size={13} color={dueSoon ? Colors.error : Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={[styles.due, dueSoon && styles.dueSoon]}>Due {formatDate(item.dueAt)}</Text>
                </View>

                {/* Auto refill */}
                <View style={styles.autoRow}>
                  <Text style={styles.autoLabel}>Auto-refill reminder</Text>
                  <Switch
                    value={item.autoRefill}
                    onValueChange={(v) => schedule.mutate({ id: item.id, autoRefill: v })}
                    trackColor={{ true: Colors.teal, false: Colors.outlineVariant }}
                    thumbColor={Colors.white}
                  />
                </View>

                {item.scheduled ? (
                  <View style={styles.scheduled}>
                    <CircleCheck size={15} color={Colors.teal} strokeWidth={2} />
                    <Text style={styles.scheduledText}>Refill scheduled</Text>
                  </View>
                ) : (
                  <Pressable
                    style={styles.orderBtn}
                    onPress={() =>
                      item.productId
                        ? router.push({ pathname: '/health/pharmacy/product/[id]', params: { id: item.productId } })
                        : schedule.mutate({ id: item.id, autoRefill: item.autoRefill })
                    }
                  >
                    <Text style={styles.orderText}>Order refill now</Text>
                  </Pressable>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <StateView
              kind="empty"
              icon="RefreshCw"
              title="No refills due"
              message="We'll remind you when your medications are running low."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 100, flexGrow: 1 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  form: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  due: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  dueSoon: { color: Colors.error },
  autoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  autoLabel: { ...Typography.bodyMd, color: Colors.onSurface },
  scheduled: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.sm + 2 },
  scheduledText: { ...Typography.labelMd, color: Colors.tertiaryContainer },
  orderBtn: {
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: Colors.secondary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.sm + 2,
    alignItems: 'center',
  },
  orderText: { ...Typography.labelMd, color: Colors.secondary },
});
