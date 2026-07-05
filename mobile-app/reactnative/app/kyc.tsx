import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Platform, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Clock } from 'lucide-react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { getKycProfile, initiateKyc, KycDocumentType, KycStatus } from '@/api/kyc.api';

const DOC_TYPE_LABELS: Record<string, KycDocumentType> = {
  BVN:                'BVN',
  NIN:                'NIN',
  'International Passport': 'PASSPORT',
  "Driver's Licence": 'DRIVERS_LICENSE',
};
const DOC_TYPE_OPTIONS = Object.keys(DOC_TYPE_LABELS);

const STATUS_META: Record<string, { label: string; color: string; Icon: React.ComponentType<any> }> = {
  verified:   { label: 'Verified',   color: '#16A34A',        Icon: ShieldCheck },
  pending:    { label: 'In Review',  color: Colors.secondary, Icon: Clock },
  rejected:   { label: 'Rejected',   color: Colors.error,     Icon: ShieldAlert },
  unverified: { label: 'Unverified', color: Colors.outline,   Icon: ShieldQuestion },
};

function statusMeta(status: KycStatus) {
  return STATUS_META[status] ?? STATUS_META.unverified;
}

export default function KycScreen() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['kyc', 'me'],
    queryFn:  getKycProfile,
  });

  const [docLabel, setDocLabel] = useState('');
  const [docNumber, setDocNumber] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      initiateKyc({
        documentType:   DOC_TYPE_LABELS[docLabel],
        documentNumber: docNumber.trim(),
        requestedTier:  1,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kyc', 'me'] });
      setDocNumber('');
      setDocLabel('');
      Alert.alert('Submitted', 'Your verification is now in review. We will notify you once it is processed.');
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Could not submit your documents. Please try again.';
      Alert.alert('Submission failed', message);
    },
  });

  const canSubmit = !!docLabel && docNumber.trim().length >= 5 && !submit.isPending;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Identity Verification" />
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (isError || !data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Identity Verification" />
        <View style={styles.center}>
          <StateView
            kind="error"
            title="Couldn't load verification status"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const meta = statusMeta(data.status);
  const showForm = data.status === 'unverified' || data.status === 'rejected';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Identity Verification" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
      >
        {/* Status card */}
        <View style={[styles.statusCard, shadow1]}>
          <View style={[styles.statusIcon, { backgroundColor: `${meta.color}1A` }]}>
            <meta.Icon size={26} color={meta.color} strokeWidth={2} />
          </View>
          <Text style={[styles.statusLabel, { color: meta.color }]}>{meta.label}</Text>
          <Text style={styles.tierText}>Tier {data.tier}</Text>
          {data.submittedAt ? (
            <Text style={styles.metaText}>
              Submitted {new Date(data.submittedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          ) : null}
          {data.verifiedAt ? (
            <Text style={styles.metaText}>
              Verified {new Date(data.verifiedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          ) : null}
        </View>

        {data.status === 'pending' ? (
          <View style={styles.infoBox}>
            <Clock size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.infoText}>
              Your documents are being reviewed. This usually takes a few minutes but can take up to 24 hours.
            </Text>
          </View>
        ) : null}

        {showForm ? (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {data.status === 'rejected' ? 'Resubmit your details' : 'Verify your identity'}
            </Text>
            <Text style={styles.formSub}>
              Provide a valid government document to raise your transaction limits.
            </Text>

            <SelectField
              label="Document Type"
              placeholder="Select document"
              value={docLabel}
              options={DOC_TYPE_OPTIONS}
              onChange={setDocLabel}
              searchable={false}
            />
            <TextInputField
              label="Document Number"
              placeholder="Enter the number on your document"
              value={docNumber}
              onChangeText={setDocNumber}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <PrimaryButton
              label={submit.isPending ? 'Submitting…' : 'Submit for Verification'}
              onPress={() => submit.mutate()}
              loading={submit.isPending}
              disabled={!canSubmit}
            />
          </View>
        ) : null}

        {data.status === 'verified' ? (
          <PrimaryButton label="Done" onPress={() => router.back()} variant="secondary" />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 40 : Spacing.xl },
  statusCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  statusIcon: { width: 56, height: 56, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  statusLabel: { ...Typography.titleLg, fontWeight: '700' as const },
  tierText:   { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  metaText:   { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  infoBox: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  infoText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1, lineHeight: 18 },
  formCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerHigh,
  },
  formTitle: { ...Typography.titleMd, color: Colors.onSurface },
  formSub:   { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
});
