import React from 'react';
import { ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Clock, ShieldQuestion } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { rememberResume } from '@/lib/resume';
import { createSupabaseClient } from '@/lib/supabase';
import { getKycProfile } from '@/features/crowdfunding/api/kyc';

// Crowdfunding has no bespoke KYC/KYB of its own — creators go through the same
// tiered identity verification every other vertical uses (finance/kyc). This
// screen reads the real profile and, when unverified, deep-links into the
// existing kyc-verify step-up flow rather than a crowdfunding-specific one.

type Row = { label: string; state: 'done' | 'pending' | 'todo' | 'loading' };

export default function VerificationSettings() {
  const pathname = usePathname();

  const kyc = useQuery({ queryKey: ['crowdfunding', 'kyc-me'], queryFn: getKycProfile });
  const email = useQuery({
    queryKey: ['crowdfunding', 'email-verified'],
    queryFn: async () => {
      const { data } = await createSupabaseClient().auth.getSession();
      return !!data.session?.user?.email_confirmed_at;
    },
  });

  const identityVerified = kyc.data?.status === 'verified' && (kyc.data?.tier ?? 0) >= 1;
  const identityPending = kyc.data?.status === 'pending';

  const rows: Row[] = [
    { label: 'Email verified', state: email.isLoading ? 'loading' : email.data ? 'done' : 'todo' },
    { label: 'Phone verified', state: kyc.isLoading ? 'loading' : kyc.data?.phoneVerified ? 'done' : 'todo' },
    { label: 'Identity (KYC)', state: kyc.isLoading ? 'loading' : identityVerified ? 'done' : identityPending ? 'pending' : 'todo' },
  ];

  function startVerification() {
    rememberResume({ pathname, params: {} });
    router.push({ pathname: '/kyc-verify', params: { target: '1', stepUp: '1' } });
  }

  const headline = identityVerified
    ? 'ID Verified'
    : identityPending
      ? 'Verification in review'
      : 'Verify to unlock full access';
  const sub = identityVerified
    ? 'You can create campaigns and withdraw funds.'
    : identityPending
      ? 'Your documents are being reviewed. This can take up to 24 hours.'
      : 'Verify your identity to create campaigns and withdraw funds.';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Verification" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}>
          {identityVerified ? (
            <BadgeCheck size={32} color={Colors.secondary} strokeWidth={2} />
          ) : identityPending ? (
            <Clock size={32} color={Colors.secondary} strokeWidth={2} />
          ) : (
            <ShieldQuestion size={32} color={Colors.onSurfaceVariant} strokeWidth={2} />
          )}
          <Text style={styles.badgeTitle}>{headline}</Text>
          <Text style={styles.badgeSub}>{sub}</Text>
        </View>
        <View style={styles.card}>
          {rows.map((it, i, arr) => (
            <View key={it.label} style={[styles.row, i < arr.length - 1 && styles.rowBorder]}>
              <Text style={styles.label}>{it.label}</Text>
              {it.state === 'loading' ? (
                <ActivityIndicator size="small" color={Colors.onSurfaceVariant} />
              ) : it.state === 'done' ? (
                <View style={styles.doneChip}><BadgeCheck size={13} color={Colors.tertiaryContainer} strokeWidth={2.2} /><Text style={styles.doneText}>Verified</Text></View>
              ) : it.state === 'pending' ? (
                <View style={styles.pendChip}><Clock size={13} color={'#B65A00'} strokeWidth={2} /><Text style={styles.pendText}>In review</Text></View>
              ) : (
                <View style={styles.pendChip}><Clock size={13} color={'#B65A00'} strokeWidth={2} /><Text style={styles.pendText}>Not started</Text></View>
              )}
            </View>
          ))}
        </View>
        {!identityVerified && !identityPending ? (
          <View style={styles.cta}><PrimaryButton label="Verify your identity" onPress={startVerification} /></View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: 60 },
  badge: { alignItems: 'center', gap: 4, paddingVertical: Spacing.lg },
  badgeTitle: { ...Typography.titleLg, color: Colors.onSurface },
  badgeSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  doneText: { ...Typography.caption, color: Colors.tertiaryContainer, fontWeight: '600' as const },
  pendChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.iconBgOrange, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  pendText: { ...Typography.caption, color: '#B65A00', fontWeight: '600' as const },
  cta: { marginTop: Spacing.lg },
});
