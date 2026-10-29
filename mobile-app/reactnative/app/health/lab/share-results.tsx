import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldCheck } from 'lucide-react-native';

import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useShareResult } from '@/features/health/lab/hooks';

export default function ShareResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const share = useShareResult();

  const [granteeEmail, setGranteeEmail] = useState('');
  const [days, setDays] = useState(30);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canShare = /^S+@S+.S+$/.test(granteeEmail.trim());

  const onShare = async () => {
    if (!canShare) return;
    setError(null);
    try {
      await share.mutateAsync({ resultId: id, granteeEmail: granteeEmail.trim(), days });
      setDone(true);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ? msg.replace(/^lab:s*/, '') : 'Could not share these results. Please try again.');
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Share results" subtitle="Consent-protected" />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Shared securely"
          message="Access has been granted and logged. You can revoke this consent at any time from your privacy settings."
          actionLabel="Done"
          onAction={() => goBack('/health/lab')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Share results" subtitle="Consent-protected" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.explainer}>
            <View style={styles.iconWrap}>
              <ShieldCheck size={22} color={Colors.teal} />
            </View>
            <View style={styles.explainerBody}>
              <Text style={styles.explainerTitle}>You stay in control</Text>
              <Text style={styles.explainerText}>
                Sharing creates an access-logged consent grant under NDPA. The recipient gets
                secure, read-only access — and you can revoke it at any time.
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <TextInputField
              label="Recipient's Spotlight email"
              value={granteeEmail}
              onChangeText={setGranteeEmail}
              placeholder="doctor@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <View style={styles.gap} />
            <Text style={styles.durationLabel}>Access lasts</Text>
            <View style={styles.durationRow}>
              {[7, 30, 90].map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDays(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: days === d }}
                  style={[styles.durationChip, days === d && styles.durationChipOn]}
                >
                  <Text style={[styles.durationText, days === d && styles.durationTextOn]}>{d} days</Text>
                </Pressable>
              ))}
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label="Share securely"
            onPress={onShare}
            disabled={!canShare}
            loading={share.isPending}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  durationLabel: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  durationRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  durationChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerLow,
  },
  durationChipOn: { backgroundColor: Colors.primary },
  durationText: { ...Typography.labelMd, color: Colors.onSurface },
  durationTextOn: { color: Colors.white },
  errorText: { ...Typography.bodySm, color: Colors.error, marginTop: Spacing.sm },
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: {
    padding: Spacing.containerMargin,
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  explainer: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.iconBgTeal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerBody: { flex: 1 },
  explainerTitle: {
    ...Typography.titleMd,
    color: Colors.onSurface,
    marginBottom: Spacing.xs,
  },
  explainerText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...shadow1,
  },
  gap: { height: Spacing.md },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
