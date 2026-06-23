// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const DAYS_OF_WEEK = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function getNext7Days() {
  const days = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function FacilityDetailScreen() {
  const router = useRouter();
  const { facilityId } = useLocalSearchParams();
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState('');
  const days = getNext7Days();

  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });
  const { data: facility, isLoading, isError, refetch } = useQuery({
    queryKey: ['facility', facilityId],
    queryFn: async () => {
      const res = await fetch(`/api/facilities/${facilityId}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!facilityId,
  });

  const slots = facility?.time_slots ?? ['6:00 AM', '8:00 AM', '10:00 AM', '12:00 PM', '2:00 PM', '4:00 PM', '6:00 PM', '8:00 PM'];
  const isClosed = facility?.status === 'closed';

  return (
    <SafeAreaView style={s.safe}>
      <View style={[s.header, { backgroundColor: facility?.color ?? colors.primary.DEFAULT }]}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>{facility?.name ?? 'Facility'}</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load facility</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {/* Photo placeholders */}
          <View style={s.photosRow}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={s.photoBox}><Ionicons name="image-outline" size={24} color={colors.neutral.placeholder} /></View>
            ))}
          </View>

          {/* Info */}
          <View style={s.card}>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Capacity</Text>
              <Text style={s.infoVal}>{facility?.capacity ?? '—'} people</Text>
            </View>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Hours</Text>
              <Text style={s.infoVal}>{facility?.opening_hours ?? '6am – 10pm'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Rate</Text>
              <Text style={s.infoVal}>₦{facility?.rate_kobo ? (facility.rate_kobo / 100).toLocaleString('en-NG') : '—'}{facility?.rate_unit ? ' / ' + facility.rate_unit : ''}</Text>
            </View>
          </View>

          {/* Rules */}
          {facility?.rules ? (
            <View style={s.card}>
              <Text style={s.sectionTitle}>Rules</Text>
              <Text style={s.bodyTxt}>{facility.rules}</Text>
            </View>
          ) : null}

          {/* Date picker */}
          <Text style={s.sectionTitle}>Select Date</Text>
          <FlatList
            horizontal
            data={days}
            keyExtractor={(_, i) => String(i)}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            renderItem={({ item, index }) => (
              <Pressable
                style={[s.dayChip, selectedDay === index && s.dayChipActive]}
                onPress={() => setSelectedDay(index)}
              >
                <Text style={[s.dayChipDay, selectedDay === index && s.dayChipTxtActive]}>{DAYS_OF_WEEK[item.getDay()]}</Text>
                <Text style={[s.dayChipNum, selectedDay === index && s.dayChipTxtActive]}>{item.getDate()}</Text>
              </Pressable>
            )}
          />

          {/* Time slots */}
          <Text style={s.sectionTitle}>Select Time</Text>
          <FlatList
            horizontal
            data={slots}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            renderItem={({ item }) => (
              <Pressable
                style={[s.slotChip, selectedSlot === item && s.slotChipActive]}
                onPress={() => setSelectedSlot(item)}
              >
                <Text style={[s.slotTxt, selectedSlot === item && s.slotTxtActive]}>{item}</Text>
              </Pressable>
            )}
          />

          <Pressable
            style={[s.bookBtn, (isClosed || !selectedSlot) && { opacity: 0.5 }]}
            disabled={isClosed || !selectedSlot}
            onPress={() => router.push(`/facilities/booking?facilityId=${facilityId}&date=${days[selectedDay].toISOString()}&slot=${encodeURIComponent(selectedSlot)}` as never)}
          >
            <Text style={s.bookBtnTxt}>{isClosed ? 'Facility Unavailable' : 'Book Now'}</Text>
          </Pressable>
        </ScrollView>
      )}
      {isClosed && (
        <View style={s.closedOverlay}>
          <Ionicons name="close-circle" size={40} color="#fff" />
          <Text style={s.closedTxt}>Facility Unavailable</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  photosRow: { flexDirection: 'row', gap: 8 },
  photoBox: { flex: 1, height: 90, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.neutral.border },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 0, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  infoLabel: { fontSize: 13, color: colors.neutral.textMuted },
  infoVal: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.neutral.text },
  bodyTxt: { fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
  dayChip: { width: 50, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface, alignItems: 'center', gap: 2 },
  dayChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  dayChipDay: { fontSize: 10, color: colors.neutral.textMuted, fontWeight: '600' },
  dayChipNum: { fontSize: 16, fontWeight: '700', color: colors.neutral.text },
  dayChipTxtActive: { color: '#fff' },
  slotChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.neutral.border, backgroundColor: colors.neutral.surface },
  slotChipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  slotTxt: { fontSize: 13, fontWeight: '500', color: colors.neutral.text },
  slotTxtActive: { color: '#fff', fontWeight: '700' },
  bookBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  bookBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  closedOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(107,114,128,0.92)', padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'center' },
  closedTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
