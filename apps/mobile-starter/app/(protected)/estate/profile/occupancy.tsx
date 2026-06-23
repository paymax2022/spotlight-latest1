// @ts-nocheck
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProfile, upsertProfile } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

const OCCUPANCY_TYPES = ['resident', 'tenant', 'homeowner', 'landlord'];

export default function OccupancyScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [occupancyType, setOccupancyType] = useState('resident');
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [agreementUrl, setAgreementUrl] = useState('');
  const [ownershipDocUrl, setOwnershipDocUrl] = useState('');
  const [ready, setReady] = useState(false);

  useQuery({
    queryKey: ['estate-profile'],
    queryFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return getProfile(ctx.estateId);
    },
    onSuccess: (p) => {
      if (!ready) {
        setOccupancyType(p.occupancy_type ?? 'resident');
        setLeaseStart(p.lease_start ?? '');
        setLeaseEnd(p.lease_end ?? '');
        setAgreementUrl(p.agreement_url ?? '');
        setOwnershipDocUrl(p.ownership_doc_url ?? '');
        setReady(true);
      }
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const ctx = await getActiveEstateContext();
      if (!ctx.estateId) throw new Error('No active estate');
      return upsertProfile(ctx.estateId, {
        occupancy_type: occupancyType,
        lease_start: leaseStart || null,
        lease_end: leaseEnd || null,
        agreement_url: agreementUrl,
        ownership_doc_url: ownershipDocUrl,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estate-profile'] });
      Alert.alert('Saved', 'Occupancy details updated.');
      router.back();
    },
    onError: (e: any) => Alert.alert('Error', e?.message ?? 'Save failed'),
  });

  const isTenant = occupancyType === 'tenant';
  const isOwner = occupancyType === 'homeowner' || occupancyType === 'landlord';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Occupancy Details</Text>
        <Text style={styles.sub}>Your occupancy status helps the estate manage records accurately.</Text>

        <Text style={styles.label}>Occupancy Type</Text>
        <View style={styles.chipRow}>
          {OCCUPANCY_TYPES.map((t) => (
            <Pressable
              key={t}
              style={[styles.chip, occupancyType === t && styles.chipActive]}
              onPress={() => setOccupancyType(t)}
            >
              <Text style={[styles.chipText, occupancyType === t && styles.chipTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {isTenant && (
          <>
            <Text style={styles.label}>Lease Start</Text>
            <TextInput style={styles.input} value={leaseStart} onChangeText={setLeaseStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.neutral.placeholder} />

            <Text style={styles.label}>Lease End</Text>
            <TextInput style={styles.input} value={leaseEnd} onChangeText={setLeaseEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.neutral.placeholder} />

            <Text style={styles.label}>Tenancy Agreement URL</Text>
            <TextInput style={styles.input} value={agreementUrl} onChangeText={setAgreementUrl} placeholder="https://r2.paymax.app/…" placeholderTextColor={colors.neutral.placeholder} autoCapitalize="none" keyboardType="url" />
          </>
        )}

        {isOwner && (
          <>
            <Text style={styles.label}>Ownership Document URL</Text>
            <TextInput style={styles.input} value={ownershipDocUrl} onChangeText={setOwnershipDocUrl} placeholder="https://r2.paymax.app/…" placeholderTextColor={colors.neutral.placeholder} autoCapitalize="none" keyboardType="url" />
          </>
        )}

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {isTenant
              ? 'Tenancy details will be cross-referenced with the landlord\'s records.'
              : isOwner
              ? 'Ownership document will be verified by the estate admin.'
              : 'Standard resident status. No additional documents required.'
            }
          </Text>
        </View>

        <Pressable
          style={[styles.saveBtn, mutation.isPending && styles.disabled]}
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Occupancy Details</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.neutral.background },
  scroll: { padding: 20, gap: 10 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.neutral.text },
  sub: { fontSize: 14, color: colors.neutral.textMuted, lineHeight: 20, marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted, marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  chipActive: { backgroundColor: colors.primary.DEFAULT, borderColor: colors.primary.DEFAULT },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  chipTextActive: { color: '#fff' },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 15, color: colors.neutral.text, borderWidth: 1, borderColor: '#E2E8F0' },
  infoBox: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 14, marginTop: 4 },
  infoText: { fontSize: 13, color: '#3B82F6', lineHeight: 19 },
  saveBtn: { backgroundColor: colors.primary.DEFAULT, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
