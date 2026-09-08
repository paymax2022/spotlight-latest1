import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldCheck } from 'lucide-react-native';

import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';

import { useShareResult } from '@/features/health/lab/hooks';

export default function ShareResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const share = useShareResult();

  const [granteeName, setGranteeName] = useState('');
  const [scopeNote, setScopeNote] = useState('');
  const [done, setDone] = useState(false);

  const canShare = granteeName.trim().length > 0;

  const onShare = async () => {
    if (!canShare) return;
    try {
      await share.mutateAsync({
        resultId: id,
        granteeName: granteeName.trim(),
        scopeNote: scopeNote.trim() || undefined,
      });
      setDone(true);
    } catch {
      // mutation error state can be surfaced; keep form for retry
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
              label="Who are you sharing with?"
              value={granteeName}
              onChangeText={setGranteeName}
              placeholder="e.g. Dr. Eze, Reddington Hospital"
            />
            <View style={styles.gap} />
            <TextInputField
              label="Add a note (optional)"
              value={scopeNote}
              onChangeText={setScopeNote}
              placeholder="What this is for, or any context"
              multiline
            />
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
