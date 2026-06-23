// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { guardCheckin, guardCheckout, lookupCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function VisitorConfirmScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { codeId, gateId } = useLocalSearchParams<{ codeId: string; gateId?: string }>();

  const { data: payload, isLoading } = useQuery({
    queryKey: ['guard-lookup', codeId],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return lookupCode(ctx.estateId, { numeric_code: '' });
    },
    enabled: false, // populated from navigation state — real lookup done on scan screen
  });

  // We re-fetch via the code ID stored in the access-code cache.
  const { data: code } = useQuery({
    queryKey: ['access-code', codeId],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      const { getAccessCode } = await import('@/api/estate.api');
      return getAccessCode(ctx.estateId, codeId);
    },
    enabled: !!codeId,
  });

  const checkinMutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !code) throw new Error('Missing data');
      return guardCheckin(ctx.estateId, {
        numeric_code: code.numeric_code,
        gate_id: gateId || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expected-visitors'] });
      Alert.alert('Entry Approved', `${code?.visitor_name} may enter.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: any) => Alert.alert('Denied', e?.message ?? 'Entry denied'),
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing data');
      return guardCheckout(ctx.estateId, codeId, gateId);
    },
    onSuccess: () => {
      Alert.alert('Checkout Recorded', `${code?.visitor_name} has left.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Checkout failed'),
  });

  if (isLoading || !code) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator color={colors.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  const isAllowed = code.status === 'active' && !code.blacklisted;
  const statusColor = isAllowed ? '#10B981' : '#EF4444';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={[styles.statusBanner, { backgroundColor: statusColor + '18', borderColor: statusColor }]}>
          <Ionicons name={isAllowed ? 'checkmark-circle' : 'close-circle'} size={28} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {isAllowed ? 'ENTRY PERMITTED' : 'ENTRY DENIED'}
          </Text>
        </View>

        <View style={styles.visitorCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={32} color={colors.primary.DEFAULT} />
          </View>
          <Text style={styles.name}>{code.visitor_name}</Text>
          {code.visitor_phone ? <Text style={styles.phone}>{code.visitor_phone}</Text> : null}

          <View style={styles.detailsGrid}>
            {[
              { label: 'Code', value: code.numeric_code },
              { label: 'Type', value: code.code_type.replace(/_/g, ' ') },
              { label: 'Vehicle', value: code.vehicle_plate || '—' },
              { label: 'Uses', value: `${code.used_count}/${code.max_uses}` },
              { label: 'Purpose', value: code.purpose || '—' },
              { label: 'Expires', value: new Date(code.valid_until).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
            ].map(({ label, value }) => (
              <View key={label} style={styles.detailItem}>
                <Text style={styles.detailLabel}>{label}</Text>
                <Text style={styles.detailValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {code.blacklisted && (
          <Pressable
            style={styles.blacklistBtn}
            onPress={() => router.push({ pathname: '/estate/guard/blacklist-alert', params: { codeId } } as never)}
          >
            <Ionicons name="ban" size={18} color="#DC2626" />
            <Text style={styles.blacklistText}>View Blacklist Details</Text>
          </Pressable>
        )}

        {isAllowed && (
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.approveBtn, checkinMutation.isPending && styles.disabled]}
              onPress={() => checkinMutation.mutate()}
              disabled={checkinMutation.isPending}
            >
              {checkinMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="enter-outline" size={22} color="#fff" />
                  <Text style={styles.approveBtnText}>Allow Entry</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={[styles.checkoutBtn, checkoutMutation.isPending && styles.disabled]}
              onPress={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
            >
              {checkoutMutation.isPending ? <ActivityIndicator color="#10B981" /> : (
                <>
                  <Ionicons name="exit-outline" size={22} color="#10B981" />
                  <Text style={styles.checkoutBtnText}>Checkout</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        <Pressable style={styles.denyBtn} onPress={() => router.back()}>
          <Text style={styles.denyBtnText}>{isAllowed ? 'Deny Entry' : 'Back'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 20, gap: 14 },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: 1.5 },
  statusText: { fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  visitorCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primary.DEFAULT + '15', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 20, fontWeight: '800', color: colors.neutral.text },
  phone: { fontSize: 14, color: colors.neutral.textMuted },
  detailsGrid: { width: '100%', gap: 8, marginTop: 8 },
  detailItem: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { fontSize: 13, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'capitalize' },
  detailValue: { fontSize: 13, color: colors.neutral.text, fontWeight: '500', textTransform: 'capitalize' },
  blacklistBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12 },
  blacklistText: { fontSize: 13, color: '#DC2626', fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingVertical: 16 },
  approveBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  checkoutBtn: { width: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#F0FDF4', borderRadius: 14, paddingVertical: 16, borderWidth: 1.5, borderColor: '#10B981' },
  checkoutBtnText: { color: '#10B981', fontWeight: '700', fontSize: 14 },
  denyBtn: { alignItems: 'center', paddingVertical: 12 },
  denyBtnText: { fontSize: 15, color: '#EF4444', fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
