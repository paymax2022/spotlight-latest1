import React, { useEffect, useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Sparkles, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useStaysStore } from '@/features/stays/store';
import { useGuestProfile } from '@/features/stays/hooks';
import { StaysColors } from '@/features/stays/constants/stays.constants';
import type { LeadGuest } from '@/features/stays/types';
import { useAccountIdentity } from '@/features/account/identity';

export default function LeadGuestScreen() {
  const { leadGuest, setLeadGuest } = useStaysStore();
  const profile = useGuestProfile();
  const account = useAccountIdentity();
  const [form, setForm] = useState<LeadGuest>(leadGuest ?? { fullName: '', email: '', phone: '', country: 'Nigeria' });
  const [prefilled, setPrefilled] = useState(false);

  // Prefill once from profile/KYC if the form is empty. The signed-in account
  // is the fallback: when the stays profile call fails or returns nothing, the
  // app still knows the guest's name, email and phone, and asking for them
  // again would be asking for details it already has. Everything stays
  // EDITABLE — the lead guest is not always the account holder.
  useEffect(() => {
    if (leadGuest || form.fullName) return;
    const p = profile.data;
    const seeded = {
      fullName: p?.fullName || account.fullName,
      email:    p?.email    || account.email,
      phone:    p?.phone    || account.phone,
      country:  p?.country  || 'Nigeria',
    };
    if (!seeded.fullName && !seeded.email && !seeded.phone) return;
    setForm(seeded);
    setPrefilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data, account.fullName, account.email, account.phone]);

  const update = (p: Partial<LeadGuest>) => setForm((s) => ({ ...s, ...p }));
  const valid = form.fullName.trim().length > 1 && /\S+@\S+/.test(form.email) && form.phone.trim().length >= 7;

  const next = () => {
    setLeadGuest(form);
    router.push('/stays/book/occupants');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Lead guest" subtitle="Step 2 of 5" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {profile.isLoading ? (
          <StateView kind="loading" message="Loading your details…" compact />
        ) : (
          <>
            {prefilled ? (
              <View style={styles.prefill}>
                <Sparkles size={16} color={StaysColors.accent} strokeWidth={2} />
                <Text style={styles.prefillText}>
                  {profile.data
                    ? `Prefilled from your verified profile (KYC Tier ${profile.data.kycTier ?? '—'})`
                    : 'Prefilled from your account. Edit anything if the lead guest is someone else.'}
                </Text>
              </View>
            ) : null}

            <TextInputField label="Full name" value={form.fullName} onChangeText={(t) => update({ fullName: t })} placeholder="As on your ID" autoCapitalize="words" />
            <TextInputField label="Email" value={form.email} onChangeText={(t) => update({ email: t })} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
            <PhoneNumberInput label="Phone" value={form.phone} onChange={({ e164, nsn }) => ((t) => update({ phone: t }))(e164 || nsn)} />
            <TextInputField label="Country" value={form.country} onChangeText={(t) => update({ country: t })} placeholder="Nigeria" />

            <View style={styles.consent}>
              <ShieldCheck size={16} color={StaysColors.ok} strokeWidth={2} />
              <Text style={styles.consentText}>
                Your details are shared with the hotel only to confirm your stay (NDPA 2023). You'll confirm consent before booking.
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={!valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  prefill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md },
  prefillText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  consent: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.xs },
  consentText: { ...Typography.caption, color: Colors.onSurface, flex: 1, lineHeight: 16 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
