import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ShieldCheck, BookOpen, Wallet, Landmark, CheckCircle2, Clock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import Chip from '@/features/academy/components/Chip';
import { formatNaira } from '@/features/academy/constants';
import { useTutorMe, useOnboardTutor } from '@/features/academy/hooks';

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English Language', 'Further Mathematics', 'Economics', 'Government'];

/**
 * T1 — Tutor onboarding & KYC. Reuses the KYC affordance: submitting requests
 * verification (verifyState → pending), captures subjects + a payout destination
 * (the payout rail). Mock-first; no backend required.
 */
export default function TutorOnboard() {
  const me = useTutorMe();
  const onboard = useOnboardTutor();

  const [bio, setBio] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [rate, setRate] = useState('3500');
  const [payout, setPayout] = useState<'wallet' | 'bank'>('wallet');
  const [bankName, setBankName] = useState('');
  const [acct, setAcct] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (me.isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><StateView kind="loading" message="Loading…" /></SafeAreaView>;

  // Already onboarded → show verification status instead of the form.
  if (me.data?.onboardingComplete) {
    const pending = me.data.verifyState === 'pending';
    const verified = me.data.verifyState === 'verified';
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Tutor verification" />
        <View style={styles.center}>
          <View style={[styles.statusIcon, verified && { backgroundColor: Colors.iconBgTeal }]}>
            {verified ? <CheckCircle2 size={32} color={Colors.teal} /> : <Clock size={32} color={Colors.onWarning} />}
          </View>
          <Text style={styles.statusTitle}>{verified ? 'You’re verified' : 'Verification in review'}</Text>
          <Text style={styles.statusSub}>
            {verified
              ? 'Your KYC checks passed. You can publish your profile, run classes and withdraw earnings.'
              : 'We’ve received your details and KYC. Verification usually completes within a day. You can set up classes meanwhile — payouts unlock once verified.'}
          </Text>
          <Chip label={pending ? 'KYC pending' : verified ? 'KYC verified' : 'Unverified'} color={verified ? Colors.teal : Colors.onWarning} bg={verified ? Colors.iconBgTeal : Colors.iconBgGold} />
        </View>
        <View style={styles.footer}><PrimaryButton label="Go to tutor home" onPress={() => router.replace('/learn/academy/tutor')} /></View>
      </SafeAreaView>
    );
  }

  const toggleSubject = (s: string) => setSubjects((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const rateKobo = Math.max(0, Math.round(Number(rate) || 0) * 100);
  const valid = bio.trim().length >= 10 && subjects.length > 0 && rateKobo > 0 && (payout === 'wallet' || (bankName.trim() && acct.trim().length >= 10));

  const submit = () => {
    setError(null);
    onboard.mutate(
      {
        displayName: me.data?.displayName ?? 'Tutor',
        bio: bio.trim(),
        subjects,
        hourlyRateKobo: rateKobo,
        availability: me.data?.availability ?? [],
        payout: payout === 'wallet' ? { kind: 'wallet' } : { kind: 'bank', bankName: bankName.trim(), accountNumber: acct.trim() },
      },
      {
        onSuccess: () => router.replace('/learn/academy/tutor'),
        onError: (e) => setError(e instanceof Error ? e.message : 'Could not submit'),
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Become a tutor" subtitle="Verify, set subjects & payout" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* KYC affordance */}
        <View style={[styles.kycCard, shadow1]}>
          <View style={styles.kycIcon}><ShieldCheck size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kycTitle}>Verification (KYC)</Text>
            <Text style={styles.kycSub}>We reuse your Paymax KYC. Submitting requests tutor verification — you can’t receive payouts until it clears.</Text>
          </View>
        </View>

        {/* Bio */}
        <Text style={styles.label}>About you</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Tell learners about your teaching experience…"
          placeholderTextColor={Colors.onSurfaceVariant}
          value={bio}
          onChangeText={setBio}
          multiline
        />

        {/* Subjects */}
        <View style={styles.labelRow}>
          <BookOpen size={16} color={Colors.onSurfaceVariant} />
          <Text style={styles.label}>Subjects you teach</Text>
        </View>
        <View style={styles.chipsWrap}>
          {SUBJECTS.map((s) => {
            const on = subjects.includes(s);
            return (
              <Pressable key={s} onPress={() => toggleSubject(s)} style={[styles.pickChip, on && styles.pickChipOn]}>
                <Text style={[styles.pickChipText, on && styles.pickChipTextOn]}>{s}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Rate */}
        <Text style={styles.label}>Hourly rate (₦)</Text>
        <TextInput style={styles.input} keyboardType="number-pad" value={rate} onChangeText={setRate} placeholder="3500" placeholderTextColor={Colors.onSurfaceVariant} />
        <Text style={styles.hint}>Learners will see {formatNaira(rateKobo)}/hr.</Text>

        {/* Payout setup (payout rail) */}
        <Text style={styles.label}>Where should we pay you?</Text>
        <Pressable style={[styles.method, payout === 'wallet' && styles.methodActive]} onPress={() => setPayout('wallet')}>
          <Wallet size={18} color={payout === 'wallet' ? Colors.primary : Colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text style={styles.methodTitle}>Paymax wallet</Text>
            <Text style={styles.methodSub}>Instant, no fees</Text>
          </View>
        </Pressable>
        <Pressable style={[styles.method, payout === 'bank' && styles.methodActive]} onPress={() => setPayout('bank')}>
          <Landmark size={18} color={payout === 'bank' ? Colors.primary : Colors.onSurfaceVariant} />
          <View style={{ flex: 1 }}>
            <Text style={styles.methodTitle}>Bank account</Text>
            <Text style={styles.methodSub}>Settles T+1</Text>
          </View>
        </Pressable>
        {payout === 'bank' ? (
          <>
            <TextInput style={styles.input} placeholder="Bank name (e.g. GTBank)" placeholderTextColor={Colors.onSurfaceVariant} value={bankName} onChangeText={setBankName} />
            <TextInput style={styles.input} placeholder="Account number" placeholderTextColor={Colors.onSurfaceVariant} keyboardType="number-pad" value={acct} onChangeText={setAcct} />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Submit for verification" onPress={submit} loading={onboard.isPending} disabled={!valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  kycCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.cardPadding },
  kycIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  kycTitle: { ...Typography.labelLg, color: Colors.onSurface },
  kycSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginTop: Spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
  input: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 48, color: Colors.onSurface, ...Typography.bodyMd, borderWidth: 1, borderColor: Colors.outlineVariant },
  textArea: { height: 96, paddingTop: Spacing.sm, textAlignVertical: 'top' },
  hint: { ...Typography.caption, color: Colors.onSurfaceVariant },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pickChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  pickChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pickChipText: { ...Typography.labelSm, color: Colors.onSurface },
  pickChipTextOn: { color: Colors.onPrimary, fontWeight: '700' },
  method: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  methodActive: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  methodTitle: { ...Typography.labelLg, color: Colors.onSurface },
  methodSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  error: { ...Typography.bodySm, color: Colors.error, textAlign: 'center', marginTop: Spacing.sm },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  statusIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  statusSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
