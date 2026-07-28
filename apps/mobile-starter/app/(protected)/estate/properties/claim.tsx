// @ts-nocheck
// Claim ownership of a property by uploading a document URL
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

import { claimOwnership } from '@/api/estate.api';
import { getActiveEstateContext } from '@/features/estate/estateContext';
import { colors } from '@/theme';

export default function ClaimOwnershipScreen() {
  const router = useRouter();
  const { estateId: estateIdParam, propertyId, unitLabel } = useLocalSearchParams<{ estateId?: string; propertyId: string; unitLabel: string }>();
  const [docUrl, setDocUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeContext = useQuery({
    queryKey: ['active-estate-context'],
    queryFn: getActiveEstateContext,
  });
  const estateId = estateIdParam ?? activeContext.data?.estateId;

  const claimMutation = useMutation({
    mutationFn: () => claimOwnership(estateId!, propertyId, docUrl.trim()),
    onSuccess: () =>
      router.replace({ pathname: '/estate/properties/pending', params: { unitLabel } } as never),
    onError: (err: { response?: { data?: { error?: string } } }) =>
      setError(err?.response?.data?.error || 'Could not submit claim.'),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Claim Ownership</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.propBanner}>
          <Ionicons name="home" size={32} color={colors.primary.DEFAULT} />
          <View>
            <Text style={styles.propBannerLabel}>Claiming ownership of</Text>
            <Text style={styles.propBannerUnit}>{unitLabel}</Text>
          </View>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color={colors.secondary.DEFAULT} />
          <Text style={styles.infoText}>
            Upload your Certificate of Occupancy (C of O), deed of assignment, or any official
            document proving your ownership. The estate admin will verify and approve.
          </Text>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color="#dc2626" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.label}>Document URL *</Text>
        <TextInput
          style={styles.input}
          placeholder="https://... (upload to R2 / cloud storage first)"
          placeholderTextColor={colors.neutral.placeholder}
          value={docUrl}
          onChangeText={setDocUrl}
          keyboardType="url"
          autoCapitalize="none"
        />
        <Text style={styles.hint}>
          In production, tap Upload Document to get a presigned URL, then paste it here.
        </Text>

        <Pressable
          style={[styles.primaryBtn, (!docUrl.trim() || claimMutation.isPending) && styles.primaryBtnDisabled]}
          disabled={!docUrl.trim() || claimMutation.isPending}
          onPress={() => {
            if (!estateId) {
              setError('Choose an estate before submitting a claim.');
              return;
            }
            setError(null);
            claimMutation.mutate();
          }}
        >
          {claimMutation.isPending
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.primaryBtnText}>Submit Ownership Claim</Text>
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
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  propBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.primary.DEFAULT + '10', borderRadius: 14, padding: 16,
    borderWidth: 1.5, borderColor: colors.primary.DEFAULT + '30',
  },
  propBannerLabel: { fontSize: 12, color: colors.neutral.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  propBannerUnit: { fontSize: 18, fontWeight: '800', color: colors.neutral.text, marginTop: 2 },
  infoBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: colors.secondary.DEFAULT + '12', padding: 14, borderRadius: 12,
  },
  infoText: { flex: 1, fontSize: 13, color: colors.neutral.text, lineHeight: 20 },
  errorBox: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#FEE2E2', padding: 12, borderRadius: 10 },
  errorText: { color: '#dc2626', fontSize: 13, flex: 1 },
  label: { fontSize: 13, fontWeight: '600', color: colors.neutral.textMuted },
  input: {
    backgroundColor: colors.neutral.surface, borderRadius: 12, padding: 14,
    fontSize: 14, color: colors.neutral.text, borderWidth: 1, borderColor: colors.neutral.border,
  },
  hint: { fontSize: 12, color: colors.neutral.placeholder, marginTop: -8 },
  primaryBtn: {
    backgroundColor: colors.primary.DEFAULT, borderRadius: 14, height: 54,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
