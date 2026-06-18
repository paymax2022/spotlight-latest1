// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const DEFAULT_FACILITIES = [
  { key: 'clubhouse', label: 'Clubhouse', icon: 'home-outline', color: '#7c3aed' },
  { key: 'event_hall', label: 'Event Hall', icon: 'people-outline', color: '#2563eb' },
  { key: 'swimming_pool', label: 'Swimming Pool', icon: 'water', color: '#0d9488' },
  { key: 'gym', label: 'Gym', icon: 'barbell-outline', color: '#16a34a' },
  { key: 'tennis_court', label: 'Tennis Court', icon: 'tennisball-outline', color: '#d97706' },
  { key: 'football_pitch', label: 'Football Pitch', icon: 'football-outline', color: '#059669' },
  { key: 'bbq_area', label: 'BBQ Area', icon: 'flame-outline', color: '#f97316' },
  { key: 'meeting_room', label: 'Meeting Room', icon: 'business-outline', color: '#7c3aed' },
  { key: 'sauna', label: 'Sauna', icon: 'thermometer-outline', color: '#db2777' },
];

export default function FacilitiesScreen() {
  const router = useRouter();
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const estateId = ctx?.estateId ?? '';

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['facilities', estateId],
    queryFn: async () => {
      if (!estateId) return DEFAULT_FACILITIES;
      const res = await fetch(`/api/estates/${estateId}/facilities`);
      if (!res.ok) return DEFAULT_FACILITIES;
      return res.json();
    },
    enabled: true,
    placeholderData: DEFAULT_FACILITIES,
  });

  const facilities = data ?? DEFAULT_FACILITIES;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Amenities & Booking</Text>
        <Pressable style={s.hBtn} onPress={() => router.push('/facilities/my-bookings' as never)}>
          <Ionicons name="bookmark-outline" size={20} color="#fff" />
        </Pressable>
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        >
          <View style={s.grid}>
            {facilities.map((fac) => {
              const def = DEFAULT_FACILITIES.find((d) => d.key === fac.key) ?? DEFAULT_FACILITIES[0];
              const color = def.color;
              const icon = def.icon;
              const available = fac.available !== false;
              return (
                <Pressable
                  key={fac.key ?? fac.id}
                  style={s.tile}
                  onPress={() => router.push(`/facilities/${fac.id ?? fac.key}` as never)}
                >
                  <View style={[s.tileIcon, { backgroundColor: color + '22' }]}>
                    <Ionicons name={icon} size={28} color={color} />
                  </View>
                  <Text style={s.tileName} numberOfLines={1}>{fac.label ?? fac.name}</Text>
                  <View style={s.availRow}>
                    <View style={[s.availDot, { backgroundColor: available ? '#16a34a' : '#9ca3af' }]} />
                    <Text style={[s.availTxt, { color: available ? '#16a34a' : '#9ca3af' }]}>{available ? 'Available' : 'Unavailable'}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '30.5%', backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 14, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  tileIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontSize: 11, fontWeight: '600', color: colors.neutral.text, textAlign: 'center' },
  availRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  availDot: { width: 6, height: 6, borderRadius: 3 },
  availTxt: { fontSize: 10, fontWeight: '600' },
});
