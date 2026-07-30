import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, EyeOff, Info } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useMatchableCampaign, useSetupMatch } from '@/features/crowdfunding/hooks/useCsr';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';
import { sanitizeMoneyInput, nairaStringToKobo } from '@/utils/money';
import type { MatchRatio } from '@/features/crowdfunding/types/csr.types';

const RATIOS: { value: MatchRatio; label: string; sub: string }[] = [
  { value: '0.5:1', label: '0.5×', sub: '₦50 per ₦100' },
  { value: '1:1', label: '1×', sub: '₦100 per ₦100' },
  { value: '2:1', label: '2×', sub: '₦200 per ₦100' },
];

export default function MatchSetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading } = useMatchableCampaign(id);
  const setup = useSetupMatch();

  const [ratio, setRatio] = useState<MatchRatio>('1:1');
  const [capText, setCapText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  if (isLoading || !c) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Set up match" /><StateView kind="loading" /></SafeAreaView>;

  const capKobo = capText ? nairaStringToKobo(capText) : 0;
  const valid = capKobo >= 100_000;

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Match submitted" showBack={false} />
        <StateView
          kind="empty"
          icon="CircleCheck"
          title="Match submitted for approval"
          message={`Your ${ratio} match (up to ${formatNaira(capKobo)}) for "${c.title}" is pending internal approval. Once approved, contributions will be matched automatically and invoiced.`}
          actionLabel="View my matches"
          onAction={() => router.dismissTo('/crowdfunding/csr/matches')}
        />
      </SafeAreaView>
    );
  }

  const submit = () => {
    setup.mutate({ campaignId: c.id, ratio, capKobo, visibility: anonymous ? 'ANONYMOUS' : 'PUBLIC', message: message.trim() }, { onSuccess: () => setDone(true) });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Set up matching" subtitle={c.title} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Match ratio</Text>
          <View style={styles.ratioRow}>
            {RATIOS.map((r) => {
              const active = ratio === r.value;
              return (
                <Pressable key={r.value} style={[styles.ratio, active && styles.ratioActive]} onPress={() => setRatio(r.value)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                  <Text style={[styles.ratioLabel, active && styles.ratioLabelActive]}>{r.label}</Text>
                  <Text style={[styles.ratioSub, active && styles.ratioSubActive]}>{r.sub}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Matching cap</Text>
          <View style={[styles.amountWrap, capText !== '' && !valid && styles.amountErr]}>
            <Text style={styles.naira}>₦</Text>
            <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="decimal-pad" maxLength={13} value={capText} onChangeText={(t) => setCapText(sanitizeMoneyInput(t))} />
          </View>
          <Text style={styles.hint}>The most your company will contribute in matches. Min ₦1,000.</Text>

          {/* Visibility */}
          <Pressable style={styles.anonRow} onPress={() => setAnonymous((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: anonymous }}>
            <View style={styles.anonLeft}>
              <EyeOff size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <View><Text style={styles.anonLabel}>Match anonymously</Text><Text style={styles.anonSub}>Hide your company name publicly</Text></View>
            </View>
            <View style={[styles.switch, anonymous && styles.switchOn]}><View style={[styles.knob, anonymous && styles.knobOn]} /></View>
          </Pressable>

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Message (optional)</Text>
          <TextInput style={styles.message} placeholder="A note shown alongside your match…" placeholderTextColor={Colors.outline} value={message} onChangeText={setMessage} multiline maxLength={160} textAlignVertical="top" />

          {/* Summary */}
          <View style={styles.summary}>
            <Info size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
            <Text style={styles.summaryText}>
              Up to {formatNaira(capKobo)} will be reserved from your CSR budget and invoiced (plus VAT) as contributions are matched.
            </Text>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Submit match for approval" onPress={submit} disabled={!valid} loading={setup.isPending} />
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
  ratioRow: { flexDirection: 'row', gap: Spacing.sm },
  ratio: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  ratioActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ratioLabel: { ...Typography.titleLg, color: Colors.onSurface },
  ratioLabelActive: { color: Colors.onPrimary },
  ratioSub: { ...Typography.caption, color: Colors.onSurfaceVariant },
  ratioSubActive: { color: Colors.inversePrimary },
  amountWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, height: 64 },
  amountErr: { borderColor: Colors.error },
  naira: { ...Typography.headlineMd, color: Colors.onSurfaceVariant, marginRight: 4 },
  amountInput: { flex: 1, ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: 6 },
  anonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.lg },
  anonLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  anonLabel: { ...Typography.labelLg, color: Colors.onSurface },
  anonSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  message: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 80, ...Typography.bodyMd, color: Colors.onSurface },
  summary: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg },
  summaryText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
