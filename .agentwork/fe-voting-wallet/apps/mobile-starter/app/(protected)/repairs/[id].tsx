// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STEPS = ['Submitted', 'Inspecting', 'Assigned', 'In Progress', 'Completed'];

const URGENCY_C = {
  low: { bg: '#dcfce7', text: '#166534' },
  medium: { bg: '#fef3c7', text: '#92400e' },
  urgent: { bg: '#fee2e2', text: '#991b1b' },
};

export default function RepairDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { data: ctx } = useQuery({ queryKey: ['active-estate-ctx'], queryFn: getActiveEstateContext });

  const { data: ticket, isLoading, isError, refetch } = useQuery({
    queryKey: ['repair', id],
    queryFn: async () => {
      const res = await fetch(`/api/repairs/${id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/repairs/${id}/confirm`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { Alert.alert('Done', 'Completion confirmed.'); refetch(); },
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/repairs/${id}/reopen`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { Alert.alert('Done', 'Ticket reopened.'); refetch(); },
  });

  const currentStep = STEPS.findIndex((s) => s.toLowerCase().replace(' ', '_') === ticket?.status) ?? 0;
  const uc = URGENCY_C[ticket?.urgency] ?? URGENCY_C.low;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Ticket #{String(id).slice(0, 8)}</Text>
        <Pressable style={s.hBtn} onPress={() => router.push(`/repairs/${id}/status` as never)}>
          <Ionicons name="time-outline" size={20} color="#fff" />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load ticket</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          {/* Step tracker */}
          <View style={s.card}>
            <View style={s.stepTrack}>
              {STEPS.map((step, i) => (
                <View key={step} style={{ flex: 1, alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                    {i > 0 && <View style={[s.stepLine, i <= currentStep && s.stepLineActive]} />}
                    <View style={[s.stepDot, i <= currentStep && s.stepDotActive]}>
                      {i <= currentStep && <Ionicons name="checkmark" size={10} color="#fff" />}
                    </View>
                    {i < STEPS.length - 1 && <View style={[s.stepLine, i < currentStep && s.stepLineActive]} />}
                  </View>
                  <Text style={[s.stepLabel, i <= currentStep && s.stepLabelActive]} numberOfLines={2}>{step}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Details */}
          <View style={s.card}>
            <View style={[s.cardRow, s.rowBorder]}>
              <Text style={s.detailLabel}>Title</Text>
              <Text style={s.detailVal}>{ticket?.title}</Text>
            </View>
            <View style={[s.cardRow, s.rowBorder]}>
              <Text style={s.detailLabel}>Category</Text>
              <Text style={s.detailVal}>{ticket?.category}</Text>
            </View>
            <View style={[s.cardRow, s.rowBorder]}>
              <Text style={s.detailLabel}>Location</Text>
              <Text style={s.detailVal}>{ticket?.location}</Text>
            </View>
            <View style={[s.cardRow, s.rowBorder]}>
              <Text style={s.detailLabel}>Urgency</Text>
              <View style={[s.badge, { backgroundColor: uc.bg }]}><Text style={[s.badgeTxt, { color: uc.text }]}>{ticket?.urgency}</Text></View>
            </View>
            <View style={s.cardRow}>
              <Text style={s.detailLabel}>Submitted</Text>
              <Text style={s.detailVal}>{ticket?.created_at ? new Date(ticket.created_at).toLocaleDateString('en-NG') : '—'}</Text>
            </View>
          </View>

          {/* Description */}
          {ticket?.description ? (
            <View style={s.card}>
              <Text style={[s.detailLabel, { padding: 14, paddingBottom: 4 }]}>Description</Text>
              <Text style={s.descTxt}>{ticket.description}</Text>
            </View>
          ) : null}

          {/* Vendor */}
          {ticket?.vendor ? (
            <View style={s.card}>
              <Text style={[s.detailLabel, { padding: 14, paddingBottom: 8 }]}>Assigned Vendor</Text>
              <View style={s.vendorRow}>
                <View style={s.vendorAvatar}>
                  <Text style={s.vendorInitials}>{ticket.vendor.name?.split(' ').map((n) => n[0]).join('').slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.title}>{ticket.vendor.name}</Text>
                  <Text style={s.sub}>{ticket.vendor.category}</Text>
                </View>
                <Pressable style={s.callBtn} onPress={() => Linking.openURL(`tel:${ticket.vendor.phone}`)}>
                  <Ionicons name="call" size={18} color="#fff" />
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Photos */}
          <View style={s.card}>
            <Text style={[s.detailLabel, { padding: 14, paddingBottom: 8 }]}>Photos</Text>
            <View style={s.photosRow}>
              {[1, 2, 3].map((n) => (
                <View key={n} style={s.photoBox}>
                  <Ionicons name="image-outline" size={24} color={colors.neutral.placeholder} />
                </View>
              ))}
            </View>
          </View>

          {/* Actions */}
          {ticket?.status === 'completed' && (
            <Pressable style={s.confirmBtn} onPress={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              <Text style={s.primaryBtnTxt}>{confirmMutation.isPending ? 'Confirming…' : 'Confirm Completion'}</Text>
            </Pressable>
          )}
          {ticket?.status === 'resolved' && (
            <Pressable style={s.ghostBtn} onPress={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}>
              <Text style={s.ghostBtnTxt}>{reopenMutation.isPending ? 'Reopening…' : 'Reopen Ticket'}</Text>
            </Pressable>
          )}
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
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  stepTrack: { flexDirection: 'row', paddingVertical: 20, paddingHorizontal: 8 },
  stepDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: colors.primary.DEFAULT },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.neutral.border },
  stepLineActive: { backgroundColor: colors.primary.DEFAULT },
  stepLabel: { fontSize: 9, color: colors.neutral.placeholder, textAlign: 'center', marginTop: 4 },
  stepLabelActive: { color: colors.primary.DEFAULT, fontWeight: '600' },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  detailLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600' },
  detailVal: { fontSize: 14, color: colors.neutral.text, fontWeight: '500', textAlign: 'right', flex: 1, marginLeft: 16 },
  descTxt: { fontSize: 14, color: colors.neutral.text, lineHeight: 22, padding: 14, paddingTop: 0 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  vendorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 14 },
  vendorAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary.DEFAULT, alignItems: 'center', justifyContent: 'center' },
  vendorInitials: { color: '#fff', fontWeight: '700', fontSize: 16 },
  callBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  photosRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  photoBox: { flex: 1, height: 80, backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.neutral.border },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  confirmBtn: { backgroundColor: '#16a34a', borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  ghostBtn: { borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary.DEFAULT },
  primaryBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ghostBtnTxt: { color: colors.primary.DEFAULT, fontSize: 16, fontWeight: '700' },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
