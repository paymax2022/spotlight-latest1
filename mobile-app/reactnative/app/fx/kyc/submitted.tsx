import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { useSubmitKyc } from '@/features/fx/hooks/useFxKyc';
import { kycDraft } from '@/features/fx/utils/kycDraft';
import type { KycSubmission } from '@/features/fx/types/fx.types';

export default function KycSubmittedScreen() {
  const submit = useSubmitKyc();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const d = kycDraft.current;
    const submission: KycSubmission = {
      accountType: d.accountType,
      consents: d.consents,
      identity: d.identity,
      business: d.accountType === 'business' ? d.business : undefined,
      directors: d.accountType === 'business' ? d.directors : undefined,
      businessDocsUploaded: d.accountType === 'business' ? d.businessDocsUploaded : undefined,
    };
    submit.mutate(submission);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = submit.isPending || (!submit.isSuccess && !submit.isError);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        {pending ? (
          <>
            <View style={styles.ring}><ActivityIndicator size="large" color={Colors.primary} /></View>
            <Text style={styles.title}>Submitting your details…</Text>
            <Text style={styles.sub}>Encrypting and sending your verification securely.</Text>
          </>
        ) : submit.isError ? (
          <>
            <View style={[styles.ring, styles.ringError]}><MailCheck size={56} color={Colors.error} strokeWidth={1.8} /></View>
            <Text style={styles.title}>Couldn't submit</Text>
            <Text style={styles.sub}>Something went wrong sending your verification. Please try again.</Text>
          </>
        ) : (
          <>
            <View style={[styles.ring, styles.ringDone]}><MailCheck size={56} color={Colors.tertiaryContainer} strokeWidth={1.8} /></View>
            <Text style={styles.title}>Verification submitted 🎉</Text>
            <Text style={styles.sub}>
              Thanks! We've received your details{submit.data?.status === 'review' ? ' and they\'re with our compliance team for review' : ''}. We'll notify you as soon as there's an update.
            </Text>
          </>
        )}
      </View>

      {!pending ? (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {submit.isError ? (
            <PrimaryButton label="Back to verification" onPress={() => router.dismissTo('/fx/kyc')} />
          ) : (
            <PrimaryButton label="View status" onPress={() => router.replace('/fx/kyc/status')} />
          )}
        </SafeAreaView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  ring: { width: 104, height: 104, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  ringDone: { backgroundColor: Colors.iconBgTeal },
  ringError: { backgroundColor: Colors.errorContainer },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center', marginTop: Spacing.sm },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
