import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, Phone, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { GUARDIAN_CONSENT_COPY } from '@/features/academy/constants';
import { useMe, useLinkGuardian, useRecordConsent } from '@/features/academy/hooks';

/**
 * A7 — Guardian consent / link. Minor links to a guardian; consent is recorded
 * with an audit trail. Until consent is granted, purchases/redemptions/community
 * stay locked (enforced fail-closed in the data layer).
 */
export default function GuardianConsentScreen() {
  const { data: me } = useMe();
  const [phone, setPhone] = useState('');
  const [acked, setAcked] = useState(false);
  const linkGuardian = useLinkGuardian();
  const recordConsent = useRecordConsent();

  const phoneValid = /^0\d{10}$/.test(phone.trim()) || /^\+?\d{11,14}$/.test(phone.trim());
  const consentGranted = me?.guardianConsent === 'granted';

  const linkAndConsent = () => {
    linkGuardian.mutate(phone, {
      onSuccess: () => {
        // In the real flow the guardian approves on their device; we simulate
        // an immediate grant in mock so the slice is end-to-end runnable.
        recordConsent.mutate({ minorId: me?.id ?? 'usr_self', granted: true });
      },
    });
  };

  const proceed = () => router.push('/learn/academy/onboarding/class');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Guardian consent" subtitle="Step 3 of 4 · Child safety" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.banner}>
          <ShieldCheck size={22} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.bannerText}>{GUARDIAN_CONSENT_COPY}</Text>
        </View>

        {consentGranted ? (
          <View style={styles.grantedCard}>
            <Check size={22} color={Colors.teal} strokeWidth={2.5} />
            <Text style={styles.grantedText}>Consent recorded. Your guardian can manage permissions at any time.</Text>
          </View>
        ) : (
          <>
            <TextInputField
              label="Parent / guardian phone number"
              placeholder="0803 000 0000"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              leftIcon={<Phone size={18} color={Colors.outline} />}
            />
            <Pressable style={styles.ackRow} onPress={() => setAcked((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: acked }}>
              <View style={[styles.checkbox, acked && styles.checkboxOn]}>
                {acked ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
              </View>
              <Text style={styles.ackText}>My parent/guardian is aware and will approve this request.</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
      <View style={styles.footer}>
        {consentGranted ? (
          <PrimaryButton label="Continue" onPress={proceed} />
        ) : (
          <>
            <PrimaryButton
              label="Send consent request"
              onPress={linkAndConsent}
              disabled={!phoneValid || !acked}
              loading={linkGuardian.isPending || recordConsent.isPending}
            />
            <Pressable onPress={proceed} style={styles.skip}>
              <Text style={styles.skipText}>Skip for now (some features stay locked)</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, padding: Spacing.md, borderRadius: Radius.md, marginBottom: Spacing.lg },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  grantedCard: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', backgroundColor: Colors.iconBgTeal, padding: Spacing.md, borderRadius: Radius.md },
  grantedText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  ackRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: Spacing.xs },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ackText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, gap: Spacing.sm },
  skip: { alignItems: 'center', paddingVertical: Spacing.sm },
  skipText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
