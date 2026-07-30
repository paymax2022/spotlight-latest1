import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useOffer, useInvestorProfile, useSubscribe } from '@/features/crowdfunding/hooks/useInvestment';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';

export default function InvestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: o, isLoading } = useOffer(id);
  const { data: profile } = useInvestorProfile();
  const subscribe = useSubscribe();

  const [amountText, setAmountText] = useState('');
  const [acceptedRisk, setAcceptedRisk] = useState(false);
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);

  if (isLoading || !o) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Invest" /><StateView kind="loading" /></SafeAreaView>;

  const amountKobo = amountText ? nairaStringToKobo(amountText) : 0;
  const belowMin = amountKobo > 0 && amountKobo < o.minTicketKobo;
  const remainingLimit = (profile?.annualLimitKobo ?? 0) - (profile?.investedThisYearKobo ?? 0);
  const overLimit = amountKobo > remainingLimit;
  const valid = amountKobo >= o.minTicketKobo && !overLimit && acceptedRisk && acceptedAgreement;

  const invest = () => {
    subscribe.mutate(
      { offerId: o.id, amountKobo, acceptedRisk, acceptedAgreement },
      {
        onSuccess: (cert) => {
          const p = new URLSearchParams({ reference: cert.reference, title: cert.offerTitle, issuer: cert.issuerName, amount: String(cert.amountKobo), units: cert.unitsOrPct, lockIn: cert.lockInUntil });
          router.replace(`/crowdfunding/investment/certificate?${p.toString()}`);
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Invest" subtitle={o.title} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Investment amount</Text>
          <View style={[styles.amountWrap, (belowMin || overLimit) && styles.amountErr]}>
            <Text style={styles.naira}>₦</Text>
            <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" maxLength={13} value={amountText} onChangeText={(t) => setAmountText(sanitizeMoneyInput(t))} />
          </View>
          <Text style={styles.minHint}>Minimum {formatNaira(o.minTicketKobo)}</Text>
          {belowMin && <Text style={styles.err}>Below the minimum ticket.</Text>}

          {/* Limit warning */}
          <View style={[styles.limitCard, overLimit && styles.limitCardErr]}>
            <AlertTriangle size={16} color={overLimit ? Colors.error : Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={[styles.limitText, overLimit && { color: Colors.error }]}>
              {overLimit
                ? `This exceeds your remaining annual limit of ${formatNaira(remainingLimit)}.`
                : `Remaining annual investment limit: ${formatNaira(remainingLimit)}.`}
            </Text>
          </View>

          {/* Risk + agreement */}
          <Pressable style={styles.checkRow} onPress={() => setAcceptedRisk((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: acceptedRisk }}>
            <View style={[styles.checkbox, acceptedRisk && styles.checkboxOn]}>{acceptedRisk && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}</View>
            <Text style={styles.checkText}>I understand my capital is at risk and returns are not guaranteed.</Text>
          </Pressable>
          <Pressable style={styles.checkRow} onPress={() => setAcceptedAgreement((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: acceptedAgreement }}>
            <View style={[styles.checkbox, acceptedAgreement && styles.checkboxOn]}>{acceptedAgreement && <Check size={13} color={Colors.onPrimary} strokeWidth={3} />}</View>
            <Text style={styles.checkText}>I have read and accept the <Text style={styles.link}>subscription agreement</Text> and offer document.</Text>
          </Pressable>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={amountKobo > 0 ? `Invest ${formatNaira(amountKobo)}` : 'Invest'} onPress={invest} disabled={!valid} loading={subscribe.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  amountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, height: 64 },
  amountErr: { borderColor: Colors.error },
  naira: { ...Typography.headlineMd, color: Colors.onSurfaceVariant, marginRight: 4 },
  amountInput: { flex: 1, ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  minHint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 6 },
  err: { ...Typography.labelSm, color: Colors.error, marginTop: 4 },
  limitCard: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg },
  limitCardErr: { backgroundColor: Colors.errorContainer },
  limitText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, marginTop: Spacing.lg },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  link: { color: Colors.secondary, fontWeight: '600' as const },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
