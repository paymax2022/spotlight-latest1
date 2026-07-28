// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAccessCode, revokeCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const STATUS_COLOR = {
  active: '#10B981',
  used: '#6C5CE7',
  expired: '#94A3B8',
  revoked: '#EF4444',
};

function formatExpiry(iso: string) {
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AccessCodeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { codeId } = useLocalSearchParams<{ codeId: string }>();

  const { data: code, isLoading } = useQuery({
    queryKey: ['access-code', codeId],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      return getAccessCode(ctx.estateId, codeId);
    },
    enabled: !!codeId,
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      return revokeCode(ctx.estateId, codeId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-codes'] });
      queryClient.invalidateQueries({ queryKey: ['access-code', codeId] });
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Failed to revoke'),
  });

  function confirmRevoke() {
    Alert.alert('Revoke Code', 'This will prevent the visitor from using this code. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => revokeMutation.mutate() },
    ]);
  }

  async function shareCode() {
    if (!code) return;
    try {
      await Share.share({
        message: `Hi ${code.visitor_name}! Your estate access code is:\n\n${code.numeric_code}\n\nValid until ${formatExpiry(code.valid_until)}.\n\nPowered by Paymax Estate`,
        title: 'Estate Access Code',
      });
    } catch {}
  }

  if (isLoading || !code) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Text style={styles.loadingText}>Loading code…</Text>
      </SafeAreaView>
    );
  }

  const statusColor = STATUS_COLOR[code.status] ?? '#94A3B8';
  const isActive = code.status === 'active';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.heading}>{code.visitor_name}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '18' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{code.status.toUpperCase()}</Text>
        </View>

        {/* Large numeric code */}
        <View style={styles.codeBox}>
          <Text style={styles.numericCode}>{code.numeric_code}</Text>
          <Text style={styles.codeHint}>Numeric Entry Code</Text>
        </View>

        {/* QR placeholder */}
        <View style={styles.qrBox}>
          <Ionicons name="qr-code-outline" size={100} color={colors.neutral.placeholder} />
          <Text style={styles.qrHint}>QR Code · {code.qr_code.slice(0, 8)}…</Text>
        </View>

        {/* Details */}
        <View style={styles.detailsCard}>
          {[
            { label: 'Type', value: code.code_type.replace(/_/g, ' ') },
            { label: 'Phone', value: code.visitor_phone || '—' },
            { label: 'Vehicle', value: code.vehicle_plate || '—' },
            { label: 'Purpose', value: code.purpose || '—' },
            { label: 'Valid from', value: formatExpiry(code.valid_from) },
            { label: 'Expires', value: formatExpiry(code.valid_until) },
            { label: 'Uses', value: `${code.used_count} / ${code.max_uses}` },
          ].map(({ label, value }) => (
            <View key={label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{label}</Text>
              <Text style={styles.detailValue}>{value}</Text>
            </View>
          ))}
        </View>

        {code.blacklisted && (
          <View style={styles.blacklistAlert}>
            <Ionicons name="ban" size={18} color="#DC2626" />
            <Text style={styles.blacklistText}>This visitor is blacklisted</Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actionsRow}>
          <Pressable style={[styles.actionBtn, { backgroundColor: '#6C63FF' }]} onPress={shareCode}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={styles.actionBtnText}>Share</Text>
          </Pressable>

          <Pressable
            style={styles.actionBtn}
            onPress={() => router.push({ pathname: '/estate/visitors/history', params: { codeId: code.id } } as never)}
          >
            <Ionicons name="time-outline" size={18} color={colors.neutral.text} />
            <Text style={[styles.actionBtnText, { color: colors.neutral.text }]}>History</Text>
          </Pressable>

          {isActive && (
            <Pressable style={[styles.actionBtn, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]} onPress={confirmRevoke} disabled={revokeMutation.isPending}>
              <Ionicons name="close-circle-outline" size={18} color="#DC2626" />
              <Text style={[styles.actionBtnText, { color: '#DC2626' }]}>Revoke</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, gap: 14, alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: colors.neutral.text },
  loadingText: { fontSize: 14, color: colors.neutral.textMuted },
  statusBadge: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 12 },
  statusText: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  codeBox: { width: '100%', backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 },
  numericCode: { fontFamily: 'monospace', fontSize: 48, fontWeight: '900', color: colors.primary.DEFAULT, letterSpacing: 8 },
  codeHint: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', letterSpacing: 1 },
  qrBox: { alignItems: 'center', gap: 6 },
  qrHint: { fontSize: 11, color: colors.neutral.placeholder },
  detailsCard: { width: '100%', backgroundColor: '#fff', borderRadius: 16, padding: 16, gap: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'capitalize' },
  detailValue: { fontSize: 13, color: colors.neutral.text, fontWeight: '500', textTransform: 'capitalize', maxWidth: '60%', textAlign: 'right' },
  blacklistAlert: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, width: '100%' },
  blacklistText: { fontSize: 13, color: '#DC2626', fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: 10, width: '100%' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F1F5F9', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  actionBtnText: { fontWeight: '700', fontSize: 13, color: '#fff' },
});
