// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';
import { Linking } from 'react-native';

const QUICK_ACTIONS = [
  { label: 'Estate Security', icon: 'shield-outline', color: '#dc2626', tel: null },
  { label: 'Emergency 112', icon: 'call-outline', color: '#dc2626', tel: '112' },
  { label: 'Medical Alert', icon: 'medkit-outline', color: '#f97316', route: '/emergency/medical' },
  { label: 'Report Incident', icon: 'flag-outline', color: '#2563eb', route: '/emergency/incident/create' },
];

export default function EmergencyHubScreen() {
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, refetch, isFetching } = useQuery({
    queryKey: ['active-incidents', estateId],
    queryFn: async () => {
      if (!estateId) return [];
      const res = await fetch(`/api/estates/${estateId}/incidents?active=true`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!estateId,
  });

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.05, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const incidents = data ?? [];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Emergency</Text>
        <Pressable style={s.hBtn} onPress={() => router.push('/emergency/incident/list' as never)}>
          <Ionicons name="list-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      <FlatList
        data={incidents}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        contentContainerStyle={s.content}
        ListHeaderComponent={
          <>
            {/* PANIC button */}
            <View style={s.panicSection}>
              <Animated.View style={{ transform: [{ scale: pulse }] }}>
                <Pressable style={s.panicBtn} onPress={() => router.push('/emergency/panic' as never)}>
                  <Ionicons name="warning" size={40} color="#fff" />
                  <Text style={s.panicTxt}>PANIC</Text>
                </Pressable>
              </Animated.View>
              <Text style={s.panicHint}>Press for immediate assistance</Text>
            </View>

            {/* Quick actions */}
            <View style={s.grid}>
              {QUICK_ACTIONS.map((a) => (
                <Pressable
                  key={a.label}
                  style={[s.actionTile, { borderTopColor: a.color }]}
                  onPress={() => {
                    if (a.tel) Linking.openURL(`tel:${a.tel}`);
                    else if (a.route) router.push(a.route as never);
                  }}
                >
                  <View style={[s.actionIcon, { backgroundColor: a.color + '22' }]}>
                    <Ionicons name={a.icon} size={24} color={a.color} />
                  </View>
                  <Text style={s.actionLabel}>{a.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* Security status */}
            <View style={s.statusCard}>
              <View style={s.statusDot} />
              <Text style={s.statusTxt}>Security Response: Active</Text>
            </View>

            <Text style={s.sectionLabel}>Active Incidents</Text>
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={s.incidentRow} onPress={() => router.push(`/emergency/incident/${item.id}` as never)}>
            <Ionicons name="alert-circle" size={20} color="#dc2626" />
            <View style={{ flex: 1 }}>
              <Text style={s.incidentTitle}>{item.title}</Text>
              <Text style={s.incidentSub}>{item.location} · {new Date(item.created_at).toLocaleTimeString('en-NG')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="shield-checkmark-outline" size={40} color="#16a34a" />
            <Text style={[s.emptyTxt, { color: '#16a34a' }]}>Estate is secure</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff5f5' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#dc2626' },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  panicSection: { alignItems: 'center', gap: 12, marginBottom: 8 },
  panicBtn: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', gap: 4, shadowColor: '#dc2626', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 12 },
  panicTxt: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  panicHint: { fontSize: 13, color: '#dc2626', fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionTile: { width: '48%', backgroundColor: colors.neutral.surface, borderRadius: 14, padding: 16, gap: 10, borderTopWidth: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 3 },
  actionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#dcfce7', borderRadius: 12, padding: 14 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#16a34a' },
  statusTxt: { fontSize: 14, color: '#166534', fontWeight: '600' },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  incidentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14 },
  incidentTitle: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  incidentSub: { fontSize: 12, color: colors.neutral.textMuted },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 20 },
  emptyTxt: { fontSize: 14, fontWeight: '600' },
});
