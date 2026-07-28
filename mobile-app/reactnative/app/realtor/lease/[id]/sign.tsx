import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, PenLine } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useLease, useSignLease } from '@/features/realtor/hooks/useRealtorLease';

export default function SignLeaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lease = useLease(String(id));
  const sign = useSignLease();
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();

  const canSign = name.trim().length > 2 && agreed;

  const submit = async () => {
    if (!canSign) { setError('Type your full name and accept the terms to sign.'); return; }
    setError(undefined);
    try {
      const updated = await sign.mutateAsync({ leaseId: String(id), signatureName: name.trim(), agreed });
      router.replace(`/realtor/lease/${updated.id}/pay`);
    } catch {
      setError('Could not sign the lease. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Sign lease" subtitle={lease.data?.listingTitle} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.intro}>
          <Text style={styles.introText}>
            By typing your full legal name below you are applying a binding electronic signature to this tenancy agreement.
          </Text>
        </View>

        <View style={styles.sigBox}>
          <PenLine size={18} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.sigPreview}>{name.trim() || 'Your signature'}</Text>
        </View>

        <TextInputField label="Full legal name" placeholder="As on your ID" value={name} onChangeText={setName} autoCapitalize="words" />

        <Pressable style={styles.agree} onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
          <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
            {agreed ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
          <Text style={styles.agreeText}>
            I have read and agree to the lease terms, including the rent schedule, caution deposit and clauses.
          </Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Apply signature" onPress={submit} loading={sign.isPending} disabled={!canSign} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl },
  intro: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.lg },
  introText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  sigBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    height: 80, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant,
    borderStyle: 'dashed', backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing.lg, marginBottom: Spacing.lg,
  },
  sigPreview: { ...Typography.headlineMd, color: Colors.primary, fontStyle: 'italic' },
  agree: {
    flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  agreeText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1, lineHeight: 20 },
  error: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.md },
  footer: {
    paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest,
  },
});
