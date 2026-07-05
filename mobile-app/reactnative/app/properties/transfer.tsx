import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useRequestPropertyTransfer } from '@/features/properties/hooks';

type TransferType = 'ownership' | 'tenancy';

export default function PropertyTransferScreen() {
  const params = useLocalSearchParams<{ propertyId?: string; unit?: string }>();
  const propertyId = params.propertyId ?? '';
  const [toUserId, setToUserId] = useState('');
  const [transferType, setTransferType] = useState<TransferType>('tenancy');
  const [reason, setReason] = useState('');
  const transfer = useRequestPropertyTransfer();

  const canSubmit = !!propertyId && toUserId.trim().length > 0 && !transfer.isPending;

  const onSubmit = () => {
    transfer.mutate(
      { id: propertyId, toUserId: toUserId.trim(), transferType, reason: reason.trim() || undefined },
      { onSuccess: () => router.back() },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request transfer" subtitle={params.unit ? `Property ${params.unit}` : 'Property transfer'} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {!propertyId ? <Text style={styles.error}>Missing property. Open this from a property.</Text> : null}

          <Text style={styles.label}>Transfer type</Text>
          <View style={styles.chips}>
            {(['ownership', 'tenancy'] as TransferType[]).map((t) => {
              const active = t === transferType;
              return (
                <Text key={t} onPress={() => setTransferType(t)} style={[styles.chip, active && styles.chipActive]}>
                  {t === 'ownership' ? 'Ownership' : 'Tenancy'}
                </Text>
              );
            })}
          </View>

          <TextInputField label="Transfer to (user ID)" value={toUserId} onChangeText={setToUserId} placeholder="recipient user uuid" autoCapitalize="none" />
          <TextInputField label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="Why is this transfer requested?" multiline numberOfLines={4} style={styles.reason} />

          <Text style={styles.hint}>An estate admin must approve this request before the property's {transferType === 'ownership' ? 'landlord' : 'tenant'} is updated.</Text>
          {transfer.isError ? <Text style={styles.error}>Couldn't submit the request. Please try again.</Text> : null}
          <PrimaryButton label={transfer.isPending ? 'Submitting…' : 'Submit request'} onPress={onSubmit} loading={transfer.isPending} disabled={!canSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { padding: Spacing.containerMargin, gap: Spacing.md },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  chips: { flexDirection: 'row', gap: Spacing.sm },
  chip: { ...Typography.labelMd, color: Colors.onSurfaceVariant, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden' },
  chipActive: { color: Colors.onPrimary, backgroundColor: Colors.primary },
  reason: { minHeight: 90, textAlignVertical: 'top' },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error },
});
