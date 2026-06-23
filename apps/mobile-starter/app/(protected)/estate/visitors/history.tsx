// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAccessCode, getCheckinHistory } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const EVENT_CONFIG = {
  arrived: { icon: 'enter-outline', color: '#10B981', label: 'Arrived' },
  checked_out: { icon: 'exit-outline', color: '#EF4444', label: 'Checked out' },
};

export default function CheckinHistoryScreen() {
  const { codeId } = useLocalSearchParams<{ codeId: string }>();

  const { data: code } = useQuery({
    queryKey: ['access-code', codeId],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      return getAccessCode(ctx.estateId, codeId);
    },
    enabled: !!codeId,
  });

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['checkin-history', codeId],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      return getCheckinHistory(ctx.estateId, codeId);
    },
    enabled: !!codeId,
  });

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={history}
        keyExtractor={(h) => h.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading}>Gate History</Text>
            {code && <Text style={styles.sub}>{code.visitor_name} · Code {code.numeric_code}</Text>}
          </View>
        }
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 40 }} />
            : (
              <View style={styles.empty}>
                <Ionicons name="time-outline" size={40} color={colors.neutral.placeholder} />
                <Text style={styles.emptyText}>No gate activity recorded yet.</Text>
              </View>
            )
        }
        renderItem={({ item }) => {
          const cfg = EVENT_CONFIG[item.event] ?? EVENT_CONFIG.arrived;
          return (
            <View style={styles.eventCard}>
              <View style={[styles.eventIcon, { backgroundColor: cfg.color + '18' }]}>
                <Ionicons name={cfg.icon as any} size={22} color={cfg.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventLabel}>{cfg.label}</Text>
                <Text style={styles.eventTime}>
                  {new Date(item.captured_at).toLocaleString('en-NG', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
                {item.gate_id ? <Text style={styles.gateId}>Gate: {item.gate_id}</Text> : null}
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  list: { padding: 20, gap: 10 },
  header: { marginBottom: 8 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  empty: { alignItems: 'center', gap: 10, marginTop: 40 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  eventCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  eventIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eventLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  eventTime: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  gateId: { fontSize: 11, color: colors.neutral.placeholder, marginTop: 2 },
});
