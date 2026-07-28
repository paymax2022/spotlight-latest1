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
import { ReferralHeader, DisclosureCard } from '@/features/referral/components';
import { useResolveCode, useAttributeSignup } from '@/features/referral/foundation/hooks';
import type { CodeResolution } from '@/features/referral/foundation/types';

// M-ONB-10 — Referral code entry (at signup). Optional "Have a referral code?"
// field with inline validation. Invalid → "check code". Blank → explains it
// silently routes to the default/house per §7A. Submit calls attributeSignup.
export default function CodeEntry() {
  const [code, setCode] = useState('');
  const [resolution, setResolution] = useState<CodeResolution | null>(null);
  const resolve = useResolveCode();
  const attribute = useAttributeSignup();

  const trimmed = code.trim();
  const showHouseHint = trimmed.length === 0;

  const onValidate = () => {
    if (!trimmed) { setResolution(null); return; }
    resolve.mutate(trimmed, { onSuccess: setResolution });
  };

  const invalidReasonCopy = (r?: CodeResolution['reason']) => {
    switch (r) {
      case 'self_referral': return 'You can’t use your own code. Leaving it blank is fine.';
      case 'suspended':     return 'This code is no longer active. Check the code or leave it blank.';
      case 'expired':       return 'This code has expired. Check the code or leave it blank.';
      default:              return 'We couldn’t find that code. Please check it and try again.';
    }
  };

  const onSubmit = () => {
    attribute.mutate(trimmed, {
      onSuccess: () => router.replace('/referral/(tabs)/home'),
    });
  };

  const validState = resolution?.valid === true;
  const invalidState = resolution?.valid === false;
  // Blank is always allowed (routes to house); a typed code must validate first.
  const canSubmit = showHouseHint || validState;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ReferralHeader title="Referral code" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.lead}>Have a referral code?</Text>
        <Text style={styles.sub}>Enter a friend’s code so they get credit for inviting you. This step is optional.</Text>

        <View style={styles.field}>
          <TextInputField
            label="Referral code (optional)"
            placeholder="e.g. AMARA10"
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={(t) => { setCode(t); if (resolution) setResolution(null); }}
            onBlur={onValidate}
            returnKeyType="done"
            onSubmitEditing={onValidate}
            error={invalidState ? 'Check the code' : undefined}
          />
          {validState && (
            <View style={styles.okRow}>
              <CircleCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2.2} />
              <Text style={styles.okText}>Valid — you’ll be credited to {resolution?.referrerName}.</Text>
            </View>
          )}
          {invalidState && (
            <View style={styles.errRow}>
              <CircleAlert size={16} color={Colors.error} strokeWidth={2.2} />
              <Text style={styles.errText}>{invalidReasonCopy(resolution?.reason)}</Text>
            </View>
          )}
          {trimmed.length > 0 && !resolution && (
            <PrimaryButton label="Check code" variant="ghost" onPress={onValidate} loading={resolve.isPending} fullWidth={false} style={styles.checkBtn} />
          )}
        </View>

        {/* Blank → silently routes to default/house (§7A). Explain it. */}
        {showHouseHint && (
          <DisclosureCard
            tone="info"
            icon="House"
            title="No code? No problem"
            body="If you leave this blank, your signup is still counted — it’s simply attributed to Spotlight by default. You can add a friend’s code later within a short grace window."
          />
        )}

        <DisclosureCard
          tone="compliant"
          body="Codes credit a real friend for inviting you. You both only earn when there’s genuine, verified activity — never just for signing up."
          style={styles.note}
        />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={showHouseHint ? 'Continue without a code' : 'Continue'}
          onPress={onSubmit}
          disabled={!canSubmit}
          loading={attribute.isPending}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: Spacing.md },
  lead: { ...Typography.titleMd, color: Colors.onSurface },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  field: { gap: Spacing.sm },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  okText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1 },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  errText: { ...Typography.bodySm, color: Colors.error, flex: 1 },
  checkBtn: { alignSelf: 'flex-start' },
  note: { marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
