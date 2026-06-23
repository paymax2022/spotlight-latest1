// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

function DocumentApprovalRow({ item, onApprove, onReject }) {
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  return (
    <View style={s.approvalCard}>
      <View style={s.cardTopRow}>
        <View style={s.fileIcon}><Ionicons name="document-text" size={20} color={colors.primary.DEFAULT} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{item.name}</Text>
          <Text style={s.sub}>{item.uploaded_by} · {item.type?.replace(/_/g, ' ')}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: '#fef3c7' }]}><Text style={[s.badgeTxt, { color: '#92400e' }]}>Pending</Text></View>
      </View>

      {!showReject ? (
        <View style={s.actionRow}>
          <Pressable style={s.approveBtn} onPress={() => onApprove(item.id)}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={s.approveBtnTxt}>Approve</Text>
          </Pressable>
          <Pressable style={s.rejectBtn} onPress={() => setShowReject(true)}>
            <Ionicons name="close" size={16} color="#dc2626" />
            <Text style={s.rejectBtnTxt}>Reject</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 8, marginTop: 8 }}>
          <TextInput
            style={s.reasonInput}
            placeholder="Rejection reason..."
            placeholderTextColor={colors.neutral.placeholder}
            value={rejectReason}
            onChangeText={setRejectReason}
          />
          <View style={s.actionRow}>
            <Pressable style={s.rejectConfirmBtn} onPress={() => { onReject(item.id, rejectReason); setShowReject(false); }}>
              <Text style={s.approveBtnTxt}>Confirm Rejection</Text>
            </Pressable>
            <Pressable style={s.cancelBtn} onPress={() => setShowReject(false)}>
              <Text style={s.cancelBtnTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

export default function DocumentApprovalScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['pending-docs'],
    queryFn: async () => {
      const res = await fetch('/api/documents/pending');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id) => {
      const res = await fetch(`/api/documents/${id}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pending-docs'] }); },
    onError: () => Alert.alert('Error', 'Approval failed.'),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }) => {
      const res = await fetch(`/api/documents/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pending-docs'] }); },
    onError: () => Alert.alert('Error', 'Rejection failed.'),
  });

  const docs = data ?? [];

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={s.hTitle}>Approval Queue ({docs.length})</Text>
        <View style={{ width: 38 }} />
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary.DEFAULT} />
      ) : isError ? (
        <View style={s.errCard}>
          <Text style={s.errTxt}>Failed to load queue</Text>
          <Pressable onPress={() => refetch()}><Text style={s.retryTxt}>Retry</Text></Pressable>
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <DocumentApprovalRow
              item={item}
              onApprove={(id) => approveMutation.mutate(id)}
              onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
            />
          )}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={48} color={colors.neutral.placeholder} />
              <Text style={s.emptyTxt}>No pending documents</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  approvalCard: { backgroundColor: colors.neutral.surface, borderRadius: 16, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  fileIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.neutral.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  sub: { fontSize: 12, color: colors.neutral.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 10, backgroundColor: '#16a34a' },
  approveBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: '#dc2626' },
  rejectBtnTxt: { color: '#dc2626', fontSize: 14, fontWeight: '700' },
  reasonInput: { backgroundColor: colors.neutral.surfaceAlt, borderRadius: 10, padding: 12, fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border },
  rejectConfirmBtn: { flex: 1, height: 40, borderRadius: 10, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  cancelBtn: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.neutral.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnTxt: { color: colors.neutral.textMuted, fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 10, marginTop: 60 },
  emptyTxt: { fontSize: 14, color: colors.neutral.textMuted },
  errCard: { margin: 20, padding: 16, backgroundColor: '#fee2e2', borderRadius: 12, alignItems: 'center', gap: 8 },
  errTxt: { color: '#991b1b', fontSize: 14 },
  retryTxt: { color: colors.primary.DEFAULT, fontWeight: '700', fontSize: 14 },
});
