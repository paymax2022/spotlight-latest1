import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X, ShieldCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useEarnings, useRequestPayout, useCompletePayoutKyc } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira, PAYOUT_KYC_NOTICE } from '@/features/creators/constants/creators.constants';

export default function Payout() {
  const earnings = useEarnings();
  const requestPayout = useRequestPayout();
  const completeKyc = useCompletePayoutKyc();

  const [amount, setAmount] = useState('');
  const [legalName, setLegalName] = useState('');
  const [kycRef, setKycRef] = useState('');
  const [done, setDone] = useState(false);

  const availableKobo = earnings.data?.availableKobo ?? 0;
  const kycDone = !!earnings.data?.payoutKycDone;
  const amountKobo = (parseInt(amount.replace(/[^0-9]/g, ''), 10) || 0) * 100;
  const overLimit = amountKobo > availableKobo;

  const onCompleteKyc = async () => {
    await completeKyc.mutateAsync({ legalName, kycRef });
    earnings.refetch();
  };

  const onWithdraw = async () => {
    await requestPayout.mutateAsync({ amountKobo });
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}><X size={22} color={Colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Payout requested</Text><View style={styles.iconBtn} /></View>
        <StateView kind="empty" icon="CheckCircle2" title="Payout on the way" message={`${formatNaira(amountKobo)} is being sent to your bank. It usually arrives within 24 hours.`} actionLabel="Done" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Withdraw earnings</Text>
        <View style={styles.iconBtn} />
      </View>

      {earnings.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : earnings.isError || !earnings.data ? (
        <StateView kind="error" title="Couldn't load earnings" actionLabel="Retry" onAction={() => earnings.refetch()} />
      ) : !kycDone ? (
        // ── Payout KYC gate ──
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.gateBanner}>
            <ShieldAlert size={22} color={CreatorsColors.warnText} />
            <Text style={styles.gateBannerText}>{PAYOUT_KYC_NOTICE}</Text>
          </View>
          <Text style={styles.label}>Legal full name</Text>
          <TextInput style={styles.input} placeholder="As on your ID" placeholderTextColor={CreatorsColors.muted} value={legalName} onChangeText={setLegalName} />
          <Text style={styles.label}>BVN / NIN reference</Text>
          <TextInput style={styles.input} placeholder="11-digit reference" placeholderTextColor={CreatorsColors.muted} keyboardType="number-pad" value={kycRef} onChangeText={setKycRef} />
          <PrimaryButton label="Complete KYC" onPress={onCompleteKyc} disabled={legalName.trim().length < 3 || kycRef.trim().length < 5} loading={completeKyc.isPending} style={{ marginTop: Spacing.lg }} />
        </ScrollView>
      ) : (
        // ── Withdraw form ──
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.kycOk}><ShieldCheck size={16} color={CreatorsColors.ok} /><Text style={styles.kycOkText}>Identity verified — you can withdraw.</Text></View>
          <View style={styles.availCard}>
            <Text style={styles.availLabel}>Available</Text>
            <Text style={styles.availValue}>{formatNaira(availableKobo)}</Text>
          </View>
          <Text style={styles.label}>Amount to withdraw (₦)</Text>
          <TextInput style={styles.input} placeholder="0" placeholderTextColor={CreatorsColors.muted} keyboardType="number-pad" value={amount} onChangeText={setAmount} />
          <Pressable onPress={() => setAmount(String(Math.floor(availableKobo / 100)))}><Text style={styles.maxLink}>Withdraw all</Text></Pressable>
          {overLimit ? <Text style={styles.error}>Amount exceeds your available balance.</Text> : null}
          <PrimaryButton label="Withdraw to bank" onPress={onWithdraw} disabled={amountKobo <= 0 || overLimit} loading={requestPayout.isPending} style={{ marginTop: Spacing.lg }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  gateBanner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: CreatorsColors.warnBg, borderRadius: Radius.lg, padding: Spacing.md },
  gateBannerText: { ...Typography.labelSm, color: CreatorsColors.warnText, flex: 1 },
  kycOk: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CreatorsColors.okBg, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  kycOkText: { ...Typography.labelMd, color: CreatorsColors.ok },
  availCard: { backgroundColor: CreatorsColors.surfaceAlt, borderRadius: Radius.lg, padding: Spacing.cardPadding, marginTop: Spacing.md },
  availLabel: { ...Typography.labelMd, color: CreatorsColors.muted },
  availValue: { ...Typography.headlineMd, color: CreatorsColors.text, marginTop: 2 },
  label: { ...Typography.labelMd, color: CreatorsColors.text, marginTop: Spacing.md, marginBottom: 6 },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: CreatorsColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: CreatorsColors.surface },
  maxLink: { ...Typography.labelMd, color: CreatorsColors.brand, marginTop: Spacing.sm },
  error: { ...Typography.labelSm, color: CreatorsColors.danger, marginTop: Spacing.sm },
});
