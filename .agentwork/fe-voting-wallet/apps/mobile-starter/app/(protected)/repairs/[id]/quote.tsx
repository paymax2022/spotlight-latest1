// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

export default function RepairQuoteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [comment, setComment] = require('react').useState('');

  const { data: quote, isLoading, isError, refetch } = useQuery({
    queryKey: ['repair-quote', id],
    queryFn: async () => {
      const res = await fetch(`/api/repairs/${id}/quote`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!id,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/repairs/${id}/quote/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { Alert.alert('Approved', 'Quote approved successfully.', [{ text: 'OK', onPress: () => router.back() }]); },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/repairs/${id}/quote/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { Alert.alert('Rejected', 'Quote rejected.', [{ text: 'OK', onPress: () => router.back() }]); },
  });

  const amountNGN = quote?.amount_kobo ? (quote.amount_kobo / 100).toLocaleString('en-NG') : '—';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Vendor Quote</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load quote</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.amountCard}>
            <Text style={s.amountLabel}>Quoted Amount</Text>
            <Text style={s.amountVal}>₦{amountNGN}</Text>
          </View>

          <View style={s.card}>
            <Text style={s.sectionTitle}>Scope of Work</Text>
            <Text style={s.bodyTxt}>{quote?.scope ?? 'No details provided.'}</Text>
          </View>

          {quote?.materials?.length > 0 && (
            <View style={s.card}>
              <Text style={s.sectionTitle}>Materials</Text>
              {quote.materials.map((m, i) => (
                <View key={i} style={[s.matRow, i < quote.materials.length - 1 && s.rowBorder]}>
                  <Ionicons name="cube-outline" size={16} color={colors.neutral.textMuted} />
                  <Text style={s.matTxt}>{m}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.card}>
            <View style={[s.infoRow, s.rowBorder]}>
              <Text style={s.infoLabel}>Estimated Duration</Text>
              <Text style={s.infoVal}>{quote?.estimated_duration ?? '—'}</Text>
            </View>
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Submitted</Text>
              <Text style={s.infoVal}>{quote?.submitted_at ? new Date(quote.submitted_at).toLocaleDateString('en-NG') : '—'}</Text>
            </View>
          </View>

          <Text style={s.label}>Comments (optional)</Text>
          <TextInput
            style={[s.input, { height: 80, textAlignVertical: 'top' }]}
            placeholder="Add a comment..."
            placeholderTextColor={colors.neutral.placeholder}
            value={comment}
            onChangeText={setComment}
            multiline
          />

          <View style={s.actionsRow}>
            <Pressable style={[s.rejectBtn, rejectMutation.isPending && { opacity: 0.6 }]} onPress={() => rejectMutation.mutate()} disabled={rejectMutation.isPending}>
              <Text style={s.rejectBtnTxt}>{rejectMutation.isPending ? '…' : 'Reject'}</Text>
            </Pressable>
            <Pressable style={[s.approveBtn, approveMutation.isPending && { opacity: 0.6 }]} onPress={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
              <Text style={s.approveBtnTxt}>{approveMutation.isPending ? '…' : 'Approve'}</Text>
            </Pressable>
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
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  amountCard: { backgroundColor: colors.primary.DEFAULT, borderRadius: 20, padding: 24, alignItems: 'center', gap: 6 },
  amountLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  amountVal: { fontSize: 36, fontWeight: '800', color: '#fff' },
  card: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.neutral.textMuted },
  bodyTxt: { fontSize: 14, color: colors.neutral.text, lineHeight: 22 },
  matRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  matTxt: { fontSize: 14, color: colors.neutral.text },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  infoLabel: { fontSize: 13, color: colors.neutral.textMuted },
  infoVal: { fontSize: 13, fontWeight: '600', color: colors.neutral.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: { backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  actionsRow: { flexDirection: 'row', gap: 12 },
  rejectBtn: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  rejectBtnTxt: { color: '#dc2626', fontSize: 16, fontWeight: '700' },
  approveBtn: { flex: 1, height: 52, borderRadius: 14, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  approveBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
