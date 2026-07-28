// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getMyKyc, initiateKyc } from '@/api/kyc.api';
import { AppLoader } from '@/components/ui/AppLoader';
import { colors } from '@/theme';

const DOC_TYPES = [
  { key: 'bvn', label: 'BVN', icon: 'card-outline' },
  { key: 'nin', label: 'NIN', icon: 'finger-print-outline' },
  { key: 'passport', label: 'Passport', icon: 'document-outline' },
  { key: 'drivers_license', label: "Driver's License", icon: 'car-outline' },
];

const TIER_INFO = [
  { tier: 0, label: 'Basic', limit: '₦50,000/day', color: '#6b7280' },
  { tier: 1, label: 'Tier 1', limit: '₦200,000/day', color: '#F39C12' },
  { tier: 2, label: 'Tier 2', limit: '₦500,000/day', color: '#0051d5' },
  { tier: 3, label: 'Tier 3', limit: 'Unlimited', color: '#00B894' },
];

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    none: { color: '#6b7280', bg: '#f3f4f6', label: 'Not Started' },
    pending: { color: '#F39C12', bg: '#FEF3C7', label: 'Pending' },
    submitted: { color: '#0051d5', bg: '#DBEAFE', label: 'Under Review' },
    verified: { color: '#00B894', bg: '#D1FAE5', label: 'Verified' },
    failed: { color: '#dc2626', bg: '#FEE2E2', label: 'Failed' },
  };
  const s = map[status] ?? map.none;
  return (
    <View style={[styles.chip, { backgroundColor: s.bg }]}>
      <Text style={[styles.chipText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

export default function KycScreen() {
  const router = useRouter();
  const [docType, setDocType] = useState('bvn');
  const [docNumber, setDocNumber] = useState('');
  const [requestedTier, setRequestedTier] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const query = useQuery({ queryKey: ['kyc-me'], queryFn: getMyKyc });

  const mutation = useMutation({
    mutationFn: () => initiateKyc({ document_type: docType, document_number: docNumber.trim(), requested_tier: requestedTier }),
    onSuccess: () => { setDone(true); query.refetch(); },
    onError: (err: any) => setError(err?.message || 'Submission failed. Try again.'),
  });

  if (query.isLoading) return <AppLoader />;

  const profile = query.data;
  const currentTier = profile?.kyc_tier ?? 0;
  const kycStatus = profile?.kyc_status ?? 'none';
  const isVerified = kycStatus === 'verified';
  const isPending = kycStatus === 'submitted' || kycStatus === 'pending';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>KYC Verification</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Current Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusCardTop}>
            <View>
              <Text style={styles.statusCardLabel}>Current Level</Text>
              <Text style={styles.statusCardTier}>
                {TIER_INFO[currentTier]?.label ?? `Tier ${currentTier}`}
              </Text>
            </View>
            <StatusChip status={kycStatus} />
          </View>
          <Text style={styles.statusCardLimit}>
            Daily limit: {TIER_INFO[currentTier]?.limit ?? '—'}
          </Text>
        </View>

        {/* Tier Ladder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tier Benefits</Text>
          <View style={styles.tiersCard}>
            {TIER_INFO.map((t, idx) => (
              <View key={t.tier} style={[styles.tierRow, idx < TIER_INFO.length - 1 && styles.tierRowBorder]}>
                <View style={[styles.tierDot, { backgroundColor: t.color }]} />
                <Text style={styles.tierLabel}>{t.label}</Text>
                <Text style={styles.tierLimit}>{t.limit}</Text>
                {currentTier === t.tier && (
                  <Ionicons name="checkmark-circle" size={18} color={t.color} />
                )}
              </View>
            ))}
          </View>
        </View>

        {/* Upgrade Form */}
        {!isVerified && !isPending && !done && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Upgrade Your Tier</Text>

            <Text style={styles.fieldLabel}>Target Tier</Text>
            <View style={styles.tierBtns}>
              {[1, 2, 3].map((t) => (
                <Pressable
                  key={t}
                  style={[styles.tierBtn, requestedTier === t && styles.tierBtnActive]}
                  onPress={() => setRequestedTier(t)}
                >
                  <Text style={[styles.tierBtnText, requestedTier === t && styles.tierBtnTextActive]}>
                    {TIER_INFO[t]?.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Document Type</Text>
            <View style={styles.docTypes}>
              {DOC_TYPES.map((d) => (
                <Pressable
                  key={d.key}
                  style={[styles.docType, docType === d.key && styles.docTypeActive]}
                  onPress={() => setDocType(d.key)}
                >
                  <Ionicons name={d.icon as never} size={18} color={docType === d.key ? '#fff' : colors.neutral.textMuted} />
                  <Text style={[styles.docTypeText, docType === d.key && styles.docTypeTextActive]}>{d.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Document Number</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                placeholder={docType === 'bvn' ? '11-digit BVN' : 'Enter document number'}
                placeholderTextColor={colors.neutral.placeholder}
                value={docNumber}
                onChangeText={setDocNumber}
                keyboardType="default"
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={16} color="#dc2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submitBtn, mutation.isPending && styles.submitBtnDisabled]}
              onPress={() => {
                setError(null);
                if (!docNumber.trim()) { setError('Please enter your document number'); return; }
                mutation.mutate();
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit for Verification</Text>}
            </Pressable>
          </View>
        )}

        {(isPending || done) && (
          <View style={styles.pendingBox}>
            <Ionicons name="time-outline" size={40} color="#F39C12" />
            <Text style={styles.pendingTitle}>Under Review</Text>
            <Text style={styles.pendingSub}>Your documents are being reviewed. This typically takes 1-2 business days.</Text>
          </View>
        )}

        {isVerified && (
          <View style={styles.verifiedBox}>
            <Ionicons name="shield-checkmark" size={40} color="#00B894" />
            <Text style={styles.verifiedTitle}>Identity Verified</Text>
            <Text style={styles.verifiedSub}>Your account is fully verified at Tier {currentTier}.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 20, paddingBottom: 40 },
  statusCard: {
    backgroundColor: colors.primary.dark,
    borderRadius: 16,
    padding: 20,
  },
  statusCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  statusCardLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  statusCardTier: { fontSize: 22, fontWeight: '800', color: '#fff' },
  statusCardLimit: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  chipText: { fontSize: 12, fontWeight: '700' },
  section: {},
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.neutral.text, marginBottom: 12 },
  tiersCard: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  tierRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.neutral.border },
  tierDot: { width: 10, height: 10, borderRadius: 5 },
  tierLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.neutral.text },
  tierLimit: { fontSize: 13, color: colors.neutral.textMuted },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.neutral.text, marginBottom: 8 },
  tierBtns: { flexDirection: 'row', gap: 10 },
  tierBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.neutral.surface,
    borderWidth: 1,
    borderColor: colors.neutral.border,
    alignItems: 'center',
  },
  tierBtnActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  tierBtnText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  tierBtnTextActive: { color: '#fff' },
  docTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  docType: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.neutral.surface,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  docTypeActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  docTypeText: { fontSize: 13, color: colors.neutral.textMuted },
  docTypeTextActive: { color: '#fff' },
  inputBox: {
    backgroundColor: colors.neutral.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.neutral.border,
  },
  input: { fontSize: 14, color: colors.neutral.text },
  errorBox: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10,
  },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  submitBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pendingBox: { alignItems: 'center', gap: 12, padding: 24, backgroundColor: '#FEF3C7', borderRadius: 16 },
  pendingTitle: { fontSize: 18, fontWeight: '700', color: '#92400E' },
  pendingSub: { fontSize: 13, color: '#92400E', textAlign: 'center' },
  verifiedBox: { alignItems: 'center', gap: 12, padding: 24, backgroundColor: '#D1FAE5', borderRadius: 16 },
  verifiedTitle: { fontSize: 18, fontWeight: '700', color: '#065F46' },
  verifiedSub: { fontSize: 13, color: '#065F46', textAlign: 'center' },
});
