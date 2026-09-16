import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CircleCheck, CircleAlert, House } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import StateView from '@/components/StateView';
import { ReferralHeader, DisclosureCard, GraceCountdown, StateBadge } from '@/features/referral/components';
import { useAttribution, useClaimCode } from '@/features/referral/foundation/hooks';
import type { ClaimCodeResult } from '@/features/referral/foundation/types';

// M-INV-10 — Claim a referral code (late). Enter a forgotten code within the
// grace window; on a valid claim attribution reassigns from the house to the
// real referrer (§7A.3). After the window closes, attribution is locked.
export default function ClaimCode() {
  const { data, isLoading, isError, refetch } = useAttribution();
  const claim = useClaimCode();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ClaimCodeResult | null>(null);
  const [expired, setExpired] = useState(false);

  const locked = !!data && (data.status === 'locked' || data.isHouse === false || expired);
  const success = result?.ok === true;

  const errorCopy = (e?: ClaimCodeResult['error']) => {
    switch (e) {
      case 'window_closed':   return 'The grace window has closed. Attribution is now locked.';
      case 'self_referral':   return 'You can’t claim your own code.';
      case 'already_claimed': return 'A code has already been claimed for your account.';
      case 'no_attribution':  return 'There is no referral to claim on this account yet.';
      default:                return 'We couldn’t find that code. Please check it and try again.';
    }
  };

  const onSubmit = () => {
    claim.mutate(code.trim(), {
      onSuccess: (r) => { setResult(r); if (r.error === 'window_closed') setExpired(true); },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Claim a referral code" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !data ? (
        <StateView kind="error" title="Couldn't load your status" actionLabel="Retry" onAction={refetch} />
      ) : success ? (
        <View style={styles.center}>
          <StateView
            kind="empty"
            icon="CircleCheck"
            title="Code claimed"
            message={`Your signup is now credited to ${result?.attribution?.referrerName}. The house attribution was reversed.`}
            actionLabel="Done"
            onAction={() => router.replace('/referral/(tabs)/home')}
          />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Current attribution + countdown */}
            <View style={styles.statusCard}>
              <View style={styles.statusHead}>
                <View style={styles.statusIcon}><House size={18} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusTitle}>
                    {data.isHouse ? 'Currently attributed to Spotlight' : `Already credited to ${data.referrerName}`}
                  </Text>
                  <Text style={styles.statusSub}>
                    {data.isHouse
                      ? 'No friend got credit for inviting you yet.'
                      : 'Your attribution is already set.'}
                  </Text>
                </View>
                {data.status === 'grace' && !locked ? <StateBadge label="Grace window" tone="warn" /> : <StateBadge label="Locked" tone="neutral" />}
              </View>
              <GraceCountdown expiresAt={data.graceExpiresAt} onExpire={() => setExpired(true)} />
            </View>

            {locked ? (
              <DisclosureCard
                tone="warn"
                title="This can no longer be changed"
                body="The grace window has closed (or your attribution is already set), so a code can’t be claimed now. If you believe this is an error, contact support."
              />
            ) : (
              <>
                <Text style={styles.lead}>Forgot to enter a code?</Text>
                <Text style={styles.sub}>Add your friend’s code before the window closes and we’ll move the credit to them.</Text>

                <View style={styles.field}>
                  <TextInputField
                    label="Referral code"
                    placeholder="e.g. AMARA10"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={code}
                    onChangeText={(t) => { setCode(t); if (result) setResult(null); }}
                    returnKeyType="done"
                    onSubmitEditing={onSubmit}
                    error={result?.ok === false ? 'Check the code' : undefined}
                  />
                  {result?.ok === false && (
                    <View style={styles.errRow}>
                      <CircleAlert size={16} color={Colors.error} strokeWidth={2.2} />
                      <Text style={styles.errText}>{errorCopy(result.error)}</Text>
                    </View>
                  )}
                </View>

                <DisclosureCard
                  tone="compliant"
                  body="Claiming a code just gives the right friend credit for inviting you. You both only earn from genuine, verified activity."
                />
              </>
            )}
          </ScrollView>

          {!locked && (
            <View style={styles.footer}>
              <PrimaryButton label="Claim code" onPress={onSubmit} disabled={!code.trim()} loading={claim.isPending} />
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  statusCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { ...Typography.labelLg, color: Colors.onSurface },
  statusSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  lead: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  field: { gap: Spacing.sm },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  errText: { ...Typography.bodySm, color: Colors.error, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
