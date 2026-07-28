// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { listAccessCodes } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const CODE_TYPES = [
  { type: 'one_time', label: 'One Time', icon: 'person-outline', color: '#6C63FF' },
  { type: 'multi_day', label: 'Multi Day', icon: 'calendar-outline', color: '#3B82F6' },
  { type: 'recurring', label: 'Recurring', icon: 'repeat-outline', color: '#10B981' },
  { type: 'delivery', label: 'Delivery', icon: 'cube-outline', color: '#F59E0B' },
  { type: 'ridehailing', label: 'Ride', icon: 'car-outline', color: '#8B5CF6' },
  { type: 'staff', label: 'Staff', icon: 'briefcase-outline', color: '#EF4444' },
  { type: 'contractor', label: 'Contractor', icon: 'construct-outline', color: '#06B6D4' },
  { type: 'family', label: 'Family', icon: 'people-outline', color: '#EC4899' },
];

export default function VisitorsIndexScreen() {
  const router = useRouter();

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ['access-codes', 'active'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return listAccessCodes(ctx.estateId, 'active');
    },
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.heading}>Visitor Access</Text>
            <Text style={styles.sub}>
              {isLoading ? '…' : `${codes.length} active code${codes.length !== 1 ? 's' : ''}`}
            </Text>
          </View>
          <Pressable style={styles.listBtn} onPress={() => router.push('/estate/visitors/list' as never)}>
            <Ionicons name="list-outline" size={18} color={colors.primary.DEFAULT} />
            <Text style={styles.listBtnText}>All Codes</Text>
          </Pressable>
        </View>

        {/* Quick-create grid */}
        <Text style={styles.sectionLabel}>Create Access Code</Text>
        <View style={styles.typeGrid}>
          {CODE_TYPES.map((ct) => (
            <Pressable
              key={ct.type}
              style={styles.typeTile}
              onPress={() => router.push({ pathname: '/estate/visitors/create', params: { codeType: ct.type } } as never)}
            >
              <View style={[styles.typeIcon, { backgroundColor: ct.color + '18' }]}>
                <Ionicons name={ct.icon as any} size={24} color={ct.color} />
              </View>
              <Text style={styles.typeLabel}>{ct.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Active codes preview */}
        <Text style={styles.sectionLabel}>Active Codes</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary.DEFAULT} style={{ marginTop: 16 }} />
        ) : codes.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="person-add-outline" size={40} color={colors.neutral.placeholder} />
            <Text style={styles.emptyText}>No active codes. Create one above.</Text>
          </View>
        ) : (
          codes.slice(0, 5).map((c) => (
            <Pressable
              key={c.id}
              style={styles.codeCard}
              onPress={() => router.push({ pathname: '/estate/visitors/code', params: { codeId: c.id } } as never)}
            >
              <View style={styles.numericBadge}>
                <Text style={styles.numericText}>{c.numeric_code}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.visitorName}>{c.visitor_name}</Text>
                <Text style={styles.codeMeta}>
                  {c.code_type.replace('_', ' ')} · expires {new Date(c.valid_until).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.neutral.placeholder} />
            </Pressable>
          ))
        )}

        {codes.length > 5 && (
          <Pressable style={styles.viewAllBtn} onPress={() => router.push('/estate/visitors/list' as never)}>
            <Text style={styles.viewAllText}>View all {codes.length} codes →</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 13, color: colors.neutral.textMuted, marginTop: 2 },
  listBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.primary.DEFAULT, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  listBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary.DEFAULT },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.neutral.textMuted, marginTop: 4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeTile: { width: '22%', alignItems: 'center', gap: 6 },
  typeIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { fontSize: 11, fontWeight: '600', color: colors.neutral.text, textAlign: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  emptyText: { fontSize: 14, color: colors.neutral.textMuted },
  codeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  numericBadge: { width: 52, height: 44, borderRadius: 10, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  numericText: { fontFamily: 'monospace', fontSize: 16, fontWeight: '800', color: colors.primary.DEFAULT, letterSpacing: 2 },
  visitorName: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  codeMeta: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2, textTransform: 'capitalize' },
  viewAllBtn: { alignItems: 'center', paddingVertical: 10 },
  viewAllText: { fontSize: 13, color: colors.secondary.DEFAULT, fontWeight: '600' },
});
