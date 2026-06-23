// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function RepairVendorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();

  const { data: vendor, isLoading, isError, refetch } = useQuery({
    queryKey: ['repair-vendor', id],
    queryFn: async () => {
      const res = await fetch(`/api/repairs/${id}/vendor`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const initials = vendor?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2) ?? '??';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Vendor Info</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load vendor</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.profileCard}>
            <View style={s.avatar}><Text style={s.avatarTxt}>{initials}</Text></View>
            <Text style={s.vendorName}>{vendor?.name}</Text>
            <Text style={s.vendorCat}>{vendor?.service_category}</Text>
            <View style={s.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Ionicons
                  key={n}
                  name={n <= Math.round(vendor?.avg_rating ?? 0) ? 'star' : 'star-outline'}
                  size={20}
                  color="#f59e0b"
                />
              ))}
              <Text style={s.ratingTxt}>{vendor?.avg_rating?.toFixed(1) ?? '—'}</Text>
            </View>
          </View>

          <View style={s.card}>
            <View style={[s.row, s.rowBorder]}>
              <Ionicons name="call-outline" size={18} color={colors.neutral.textMuted} />
              <Text style={s.rowTxt}>{vendor?.phone ?? '—'}</Text>
            </View>
            <View style={s.row}>
              <Ionicons name="briefcase-outline" size={18} color={colors.neutral.textMuted} />
              <Text style={s.rowTxt}>{vendor?.service_category ?? '—'}</Text>
            </View>
          </View>

          <Pressable style={s.callBtn} onPress={() => vendor?.phone && Linking.openURL(`tel:${vendor.phone}`)}>
            <Ionicons name="call" size={20} color="#fff" />
            <Text style={s.callBtnTxt}>Call Vendor</Text>
          </Pressable>

          <Pressable style={s.rateBtn} onPress={() => router.push(`/repairs/${id}/rate` as never)}>
            <Ionicons name="star-outline" size={20} color={colors.primary.DEFAULT} />
            <Text style={s.rateBtnTxt}>Rate Vendor</Text>
          </Pressable>
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
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  profileCard: { backgroundColor: colors.neutral.surface, borderRadius: 20, padding: 24, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 28 },
  vendorName: { fontSize: 20, fontWeight: '700', color: colors.neutral.text },
  vendorCat: { fontSize: 14, color: colors.neutral.textMuted },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ratingTxt: { fontSize: 14, fontWeight: '700', color: colors.neutral.text, marginLeft: 4 },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  rowTxt: { fontSize: 15, color: colors.neutral.text },
  callBtn: { backgroundColor: '#16a34a', borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  callBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  rateBtn: { borderRadius: 14, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  rateBtnTxt: { color: colors.primary.DEFAULT, fontSize: 16, fontWeight: '700' },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
