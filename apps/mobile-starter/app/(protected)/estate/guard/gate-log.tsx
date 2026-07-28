// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listAccessCodes } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

// Gate log shows recently-used codes as a proxy for recent gate activity
// (full checkin history requires per-code queries; a proper gate log
//  query will be added when a gate_id-scoped view endpoint is built).

const STATUS_ICON = {
  active: { name: 'checkmark-circle', color: '#10B981' },
  used: { name: 'checkmark-done-circle', color: '#6C5CE7' },
  expired: { name: 'time', color: '#94A3B8' },
  revoked: { name: 'close-circle', color: '#EF4444' },
};

export default function GateLogScreen() {
  const [tab, setTab] = useState<'active' | 'used'>('active');

  const { data: codes = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['gate-log-codes', tab],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listAccessCodes(ctx.estateId, tab);
    },
    refetchInterval: 30_000,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={codes}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary.DEFAULT} />}
        ListHeaderComponent={
          <>
            <Text style={styles.heading}>Gate Activity Log</Text>
            <View style={styles.tabRow}>
              {(['active', 'used'] as const).map((t) => (
                <View key={t} style={[styles.tab, tab === t && styles.tabActive]}>
                  <Text
                    style={[styles.tabText, tab === t && styles.tabTextActive]}
                    onPress={() => setTab(t)}
                  >{t === 'active' ? 'Active' : 'Used / Entered'}</Text>
                </View>
              ))}
            </View>
          </>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : <View style={styles.empty}><Text style={styles.emptyText}>No {tab} codes.</Text></View>
        }
        renderItem={({ item }) => {
          const ic = STATUS_ICON[item.status] ?? STATUS_ICON.active;
          return (
            <View style={styles.row}>
              <Ionicons name={ic.name as any} size={20} color={ic.color} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.visitor_name}</Text>
                <Text style={styles.meta}>
                  {item.numeric_code} · {item.code_type.replace(/_/g, ' ')}
                  {item.vehicle_plate ? ` · ${item.vehicle_plate}` : ''}
                </Text>
              </View>
              <Text style={styles.time}>
                {new Date(item.valid_from).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 8 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text, marginBottom: 10 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9' },
  tabActive: { backgroundColor: colors.primary.DEFAULT },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  tabTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  name: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  meta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  time: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
});
