import React from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShieldBan, ShieldCheck } from 'lucide-react-native';
import { confirmAsync } from '@/lib/confirm';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useResidents, useBanResident, useRestoreResident } from '@/features/estateadmin/hooks';
import type { AdminResident } from '@/features/estateadmin/api';

export default function AdminResidentsScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useResidents();
  const ban = useBanResident();
  const restore = useRestoreResident();

  const confirmBan = async (r: AdminResident) => {
    const ok = await confirmAsync({ title: 'Ban resident?', message: `${r.unit || r.userId} will lose access to the estate until restored.`, confirmLabel: 'Ban', destructive: true });
    if (ok) ban.mutate({ userId: r.userId });
  };

  const renderItem = ({ item }: { item: AdminResident }) => (
    <View style={styles.card}>
      <View style={styles.info}>
        <Text style={styles.unit}>{item.unit || 'No unit'}</Text>
        <Text style={styles.sub}>{item.role}{item.banned ? ' · banned' : ''}{item.deleted ? ' · deleted' : ''}</Text>
      </View>
      {item.deleted ? null : item.banned ? (
        <Pressable style={[styles.btn, styles.restore]} disabled={restore.isPending} onPress={() => restore.mutate(item.userId)}>
          <ShieldCheck size={15} color={Colors.teal} strokeWidth={2} />
          <Text style={[styles.btnText, { color: Colors.teal }]}>Restore</Text>
        </Pressable>
      ) : (
        <Pressable style={[styles.btn, styles.banBtn]} disabled={ban.isPending} onPress={() => confirmBan(item)}>
          <ShieldBan size={15} color={Colors.error} strokeWidth={2} />
          <Text style={[styles.btnText, { color: Colors.error }]}>Ban</Text>
        </Pressable>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Residents" subtitle="Manage access" />
      {isLoading ? (
        <StateView kind="loading" message="Loading residents…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshing={isRefetching}
          onRefresh={refetch}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          ListEmptyComponent={<StateView kind="empty" icon="Users" title="No residents" message="Residents you add will appear here." />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  list: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerLow, padding: Spacing.md, ...shadow1 },
  info: { flex: 1, gap: 2 },
  unit: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.labelSm, color: Colors.outline },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  banBtn: { backgroundColor: Colors.errorContainer },
  restore: { backgroundColor: Colors.iconBgTeal },
  btnText: { ...Typography.labelMd, fontWeight: '700' },
});
