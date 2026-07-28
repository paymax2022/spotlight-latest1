// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { blacklistVisitor, getAccessCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function BlacklistScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { codeId } = useLocalSearchParams<{ codeId: string }>();

  const { data: code } = useQuery({
    queryKey: ['access-code', codeId],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      return getAccessCode(ctx.estateId, codeId);
    },
    enabled: !!codeId,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId || !codeId) throw new Error('Missing params');
      return blacklistVisitor(ctx.estateId, codeId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['access-codes'] });
      queryClient.invalidateQueries({ queryKey: ['access-code', codeId] });
      Alert.alert('Blacklisted', 'Visitor has been blacklisted and their code revoked.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.response?.data?.error ?? e?.message ?? 'Failed to blacklist. Only estate admins can blacklist visitors.'),
  });

  function confirmBlacklist() {
    Alert.alert(
      'Blacklist Visitor',
      `Blacklisting ${code?.visitor_name ?? 'this visitor'} will permanently revoke their access and flag their name for future entry attempts.\n\nThis action requires estate admin permission.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Blacklist', style: 'destructive', onPress: () => mutation.mutate() },
      ]
    );
  }

  if (!code) return null;

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={styles.iconWrap}>
        <Ionicons name="ban" size={56} color="#DC2626" />
      </View>

      <Text style={styles.heading}>Blacklist Visitor</Text>

      <View style={styles.visitorCard}>
        <Text style={styles.visitorName}>{code.visitor_name}</Text>
        {code.visitor_phone ? <Text style={styles.visitorPhone}>{code.visitor_phone}</Text> : null}
        {code.vehicle_plate ? <Text style={styles.visitorPlate}>{code.vehicle_plate}</Text> : null}
        <Text style={styles.codeNum}>Code: {code.numeric_code}</Text>
      </View>

      <Text style={styles.warningText}>
        Blacklisting this visitor will immediately revoke their code and mark them as a security concern in the estate records. This can only be done by an estate administrator.
      </Text>

      <View style={styles.actions}>
        <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={[styles.blacklistBtn, mutation.isPending && styles.disabled]} onPress={confirmBlacklist} disabled={mutation.isPending}>
          <Ionicons name="ban" size={18} color="#fff" />
          <Text style={styles.blacklistText}>Blacklist</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 22, fontWeight: '800', color: '#DC2626' },
  visitorCard: { backgroundColor: '#FFF7ED', borderRadius: 16, padding: 20, alignItems: 'center', gap: 4, width: '100%', borderWidth: 1, borderColor: '#FED7AA' },
  visitorName: { fontSize: 18, fontWeight: '800', color: colors.neutral.text },
  visitorPhone: { fontSize: 14, color: colors.neutral.textMuted },
  visitorPlate: { fontSize: 13, color: colors.neutral.textMuted },
  codeNum: { fontFamily: 'monospace', fontSize: 20, fontWeight: '700', color: '#C2410C', letterSpacing: 3, marginTop: 4 },
  warningText: { fontSize: 13, color: colors.neutral.textMuted, textAlign: 'center', lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 12, width: '100%' },
  cancelBtn: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontWeight: '700', fontSize: 15, color: colors.neutral.text },
  blacklistBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#DC2626', borderRadius: 12, paddingVertical: 14 },
  blacklistText: { fontWeight: '700', fontSize: 15, color: '#fff' },
  disabled: { opacity: 0.5 },
});
