// @ts-nocheck
// Tenant occupancy request form
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

import { createTenancyRequest } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function TenancyRequestScreen() {
  const router = useRouter();
  const { estateId: estateIdParam, propertyId, unitLabel } = useLocalSearchParams<{ estateId?: string; propertyId: string; unitLabel: string }>();
  const [landlordId, setLandlordId] = useState('');
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [agreementUrl, setAgreementUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });
  const estateId = estateIdParam ?? activeContext.data?.estateId;

  const tenancyMutation = useMutation({
    mutationFn: () =>
      createTenancyRequest(estateId!, propertyId, {
        landlord_id: landlordId.trim(),
        lease_start: leaseStart.trim(),
        lease_end: leaseEnd.trim() || undefined,
        agreement_url: agreementUrl.trim() || undefined,
      }),
    onSuccess: () =>
      router.replace({ pathname: '/estate/properties/pending', params: { unitLabel, type: 'tenancy' } } as never),
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Could not submit request.'),
  });

  const validate = () => {
    if (!estateId) return 'Choose an estate before sending an occupancy request';
    if (!landlordId.trim()) return 'Landlord ID is required';
    if (!leaseStart.trim()) return 'Lease start date is required';
    return null;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Tenant Request</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.propBanner}>
          <Ionicons name="home" size={28} color={colors.secondary.DEFAULT} />
          <View>
            <Text style={styles.propLabel}>Requesting occupancy of</Text>
            <Text style={styles.propUnit}>{unitLabel}</Text>
          </View>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.label}>Landlord User ID *</Text>
        <TextInput
          style={styles.input}
          placeholder="Landlord's Paymax user ID"
          placeholderTextColor={colors.neutral.placeholder}
          value={landlordId}
          onChangeText={setLandlordId}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Lease Start Date * (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          placeholder="2025-02-01"
          placeholderTextColor={colors.neutral.placeholder}
          value={leaseStart}
          onChangeText={setLeaseStart}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>Lease End Date (YYYY-MM-DD, optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="2026-01-31"
          placeholderTextColor={colors.neutral.placeholder}
          value={leaseEnd}
          onChangeText={setLeaseEnd}
          keyboardType="numbers-and-punctuation"
        />

        <Text style={styles.label}>Tenancy Agreement URL (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="https://..."
          placeholderTextColor={colors.neutral.placeholder}
          value={agreementUrl}
          onChangeText={setAgreementUrl}
          keyboardType="url"
          autoCapitalize="none"
        />

        <Pressable
          style={[styles.primaryBtn, tenancyMutation.isPending && styles.primaryBtnDisabled]}
          disabled={tenancyMutation.isPending}
          onPress={() => {
            const err = validate();
            if (err) { setError(err); return; }
            setError(null);
            tenancyMutation.mutate();
          }}
        >
          {tenancyMutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Send Occupancy Request</Text>
          }
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.primary.DEFAULT,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  propBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.secondary.DEFAULT + '10', borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: colors.secondary.DEFAULT + '30',
  },
  propLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  propUnit: { fontSize: 17, fontWeight: '800', color: colors.neutral.text, marginTop: 2 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: {
    backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14,
    fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border,
  },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
