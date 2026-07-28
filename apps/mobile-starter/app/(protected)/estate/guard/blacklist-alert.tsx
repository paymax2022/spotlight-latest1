// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAccessCode } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function BlacklistAlertScreen() {
  const router = useRouter();
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

  return (
    <SafeAreaView style={[styles.safe, styles.center]}>
      <View style={styles.pulseIcon}>
        <Ionicons name="ban" size={72} color="#DC2626" />
      </View>

      <Text style={styles.title}>ENTRY DENIED</Text>
      <Text style={styles.subtitle}>BLACKLISTED VISITOR</Text>

      {code && (
        <View style={styles.card}>
          <Text style={styles.cardName}>{code.visitor_name}</Text>
          {code.visitor_phone ? <Text style={styles.cardDetail}>{code.visitor_phone}</Text> : null}
          {code.vehicle_plate ? <Text style={styles.cardDetail}>{code.vehicle_plate}</Text> : null}
          <Text style={styles.cardCode}>Code: {code.numeric_code}</Text>
        </View>
      )}

      <Text style={styles.instruction}>
        Do not grant entry. Alert your supervisor immediately if the visitor attempts to force entry.
      </Text>

      <Pressable
        style={styles.reportBtn}
        onPress={() => router.push('/estate/guard/incident' as never)}
      >
        <Ionicons name="warning-outline" size={18} color="#fff" />
        <Text style={styles.reportBtnText}>File Incident Report</Text>
      </Pressable>

      <Pressable style={styles.backBtn} onPress={() => router.replace('/estate/guard' as never)}>
        <Text style={styles.backBtnText}>Back to Gate</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1A0000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  pulseIcon: { width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(220,38,38,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#DC2626' },
  title: { fontSize: 32, fontWeight: '900', color: '#EF4444', letterSpacing: 4 },
  subtitle: { fontSize: 14, fontWeight: '700', color: '#DC2626', letterSpacing: 3 },
  card: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 20, alignItems: 'center', gap: 6, width: '100%', borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)' },
  cardName: { fontSize: 18, fontWeight: '800', color: '#fff' },
  cardDetail: { fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  cardCode: { fontFamily: 'monospace', fontSize: 16, fontWeight: '700', color: '#EF4444', letterSpacing: 3, marginTop: 4 },
  instruction: { fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  reportBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#DC2626', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14, width: '100%', justifyContent: 'center' },
  reportBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backBtn: { paddingVertical: 10 },
  backBtnText: { fontSize: 14, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },
});
