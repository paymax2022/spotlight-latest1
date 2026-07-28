// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

type Check = { label: string; pass: boolean; reason?: string };

export default function VoterEligibility() {
  const router = useRouter();
  const [checks, setChecks] = useState<Check[]>([]);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasDuesIssue, setHasDuesIssue] = useState(false);

  useEffect(() => {
    fetch('/api/estate/elections/eligibility')
      .then(r => r.json())
      .then(d => {
        const data = d.data ?? d;
        const checkList: Check[] = [
          { label: 'Residency Status', pass: !!data.is_resident, reason: data.is_resident ? undefined : 'You are not registered as a resident.' },
          { label: 'Payment Status', pass: !data.has_dues, reason: data.has_dues ? 'You have outstanding dues.' : undefined },
          { label: 'KYC Verification', pass: !!data.kyc_verified, reason: data.kyc_verified ? undefined : 'Identity verification incomplete.' },
        ];
        setChecks(checkList);
        setEligible(checkList.every(c => c.pass));
        setHasDuesIssue(!!data.has_dues);
      })
      .catch(() => {
        // Fallback for demo
        setChecks([
          { label: 'Residency Status', pass: true },
          { label: 'Payment Status', pass: false, reason: 'You have outstanding dues.' },
          { label: 'KYC Verification', pass: true },
        ]);
        setEligible(false);
        setHasDuesIssue(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator size="large" color={colors.primary.DEFAULT} />
      </SafeAreaView>
    );
  }

  const failedChecks = checks.filter(c => !c.pass);

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.hBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={s.hTitle}>Voter Eligibility</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {eligible === true && (
          <View style={s.eligibleBanner}>
            <Ionicons name="checkmark-circle" size={22} color={colors.secondary.emerald} />
            <Text style={s.eligibleText}>You are eligible to vote</Text>
          </View>
        )}
        {eligible === false && (
          <View style={s.ineligibleBanner}>
            <Ionicons name="close-circle" size={22} color={colors.secondary.red} />
            <Text style={s.ineligibleText}>You cannot vote because:</Text>
          </View>
        )}

        {eligible === false && (
          <View style={s.reasonsList}>
            {failedChecks.map((c, i) => (
              <View key={i} style={s.reasonRow}>
                <Ionicons name="alert-circle-outline" size={16} color={colors.secondary.red} />
                <Text style={s.reasonText}>{c.reason}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.checksCard}>
          {checks.map((c, i) => (
            <View key={i} style={[s.checkRow, i < checks.length - 1 && s.checkRowBorder]}>
              <Text style={s.checkLabel}>{c.label}</Text>
              <View style={[s.checkBadge, c.pass ? s.checkBadgePass : s.checkBadgeFail]}>
                <Ionicons name={c.pass ? 'checkmark' : 'close'} size={14} color="#fff" />
                <Text style={s.checkBadgeText}>{c.pass ? 'Verified' : 'Failed'}</Text>
              </View>
            </View>
          ))}
        </View>

        {hasDuesIssue && (
          <Pressable style={s.clearDuesBtn} onPress={() => router.push('/estate/dues' as never)}>
            <Ionicons name="card-outline" size={18} color="#fff" />
            <Text style={s.clearDuesBtnText}>Clear My Dues to Become Eligible</Text>
          </Pressable>
        )}

        <Pressable style={s.ghostBtn} onPress={() => router.back()}>
          <Text style={s.ghostBtnText}>Back to Elections</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.neutral.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT },
  hBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  hTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  body: { padding: 16, paddingBottom: 40 },
  eligibleBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#d1fae5', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#6ee7b7' },
  eligibleText: { fontSize: 15, fontWeight: '700', color: '#065f46' },
  ineligibleBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fef2f2', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#fecaca' },
  ineligibleText: { fontSize: 15, fontWeight: '700', color: colors.secondary.red },
  reasonsList: { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 20 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  reasonText: { fontSize: 13, color: colors.secondary.red, flex: 1 },
  checksCard: { backgroundColor: colors.neutral.surface, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: colors.neutral.border },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  checkRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  checkLabel: { fontSize: 14, color: colors.neutral.text, fontWeight: '600' },
  checkBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  checkBadgePass: { backgroundColor: colors.secondary.emerald },
  checkBadgeFail: { backgroundColor: colors.secondary.red },
  checkBadgeText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  clearDuesBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.secondary.red, borderRadius: 12, paddingVertical: 16, marginBottom: 12 },
  clearDuesBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  ghostBtn: { borderWidth: 1, borderColor: colors.neutral.border, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ghostBtnText: { fontSize: 14, color: colors.neutral.textMuted, fontWeight: '600' },
});
