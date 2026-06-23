import React, { useState } from 'react';
import { ScrollView, View, Text, Pressable, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Gift, EyeOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { SUGGESTED_AMOUNTS_KOBO, MIN_CONTRIBUTION_KOBO } from '@/features/crowdfunding/constants/crowdfunding.constants';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function ContributeAmountScreen() {
  const { id, rewardTierId } = useLocalSearchParams<{ id: string; rewardTierId?: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  const tier = c?.rewardTiers.find((t) => t.id === rewardTierId) ?? null;
  const [amountKobo, setAmountKobo] = useState<number>(tier?.amountKobo ?? 0);
  const [customText, setCustomText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [message, setMessage] = useState('');

  const onCustom = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    setCustomText(digits);
    setAmountKobo(digits ? Number(digits) * 100 : 0);
  };

  const belowMin = amountKobo > 0 && amountKobo < (tier?.amountKobo ?? MIN_CONTRIBUTION_KOBO);
  const valid = amountKobo >= (tier?.amountKobo ?? MIN_CONTRIBUTION_KOBO);

  const proceed = () => {
    const params = new URLSearchParams({
      amountKobo: String(amountKobo),
      anonymous: anonymous ? '1' : '0',
    });
    if (message.trim()) params.set('message', message.trim());
    if (tier) params.set('rewardTierId', tier.id);
    router.push(`/crowdfunding/contribute/${id}/summary?${params.toString()}`);
  };

  if (isLoading) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Contribute" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !c) return <SafeAreaView style={styles.safe} edges={['top']}><ScreenHeader title="Contribute" /><StateView kind="error" title="Couldn't load campaign" actionLabel="Retry" onAction={refetch} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Contribute" subtitle={c.title} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {tier && (
            <View style={styles.tierCard}>
              <Gift size={18} color={'#B65A00'} strokeWidth={2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tierTitle}>{tier.title}</Text>
                <Text style={styles.tierMeta}>Minimum {formatNaira(tier.amountKobo)}{tier.estimatedDelivery ? ` · est. ${tier.estimatedDelivery}` : ''}</Text>
              </View>
            </View>
          )}

          <Text style={styles.label}>Choose an amount</Text>
          <View style={styles.grid}>
            {SUGGESTED_AMOUNTS_KOBO.map((amt) => {
              const active = amountKobo === amt && customText === '';
              return (
                <Pressable
                  key={amt}
                  style={[styles.amountChip, active && styles.amountChipActive]}
                  onPress={() => { setAmountKobo(amt); setCustomText(''); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.amountText, active && styles.amountTextActive]}>{formatNaira(amt)}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Or enter a custom amount</Text>
          <View style={[styles.customWrap, belowMin && styles.customWrapError]}>
            <Text style={styles.naira}>₦</Text>
            <TextInput
              style={styles.customInput}
              placeholder="0"
              placeholderTextColor={Colors.outline}
              keyboardType="number-pad"
              value={customText}
              onChangeText={onCustom}
            />
          </View>
          {belowMin && (
            <Text style={styles.errorText}>Minimum contribution is {formatNaira(tier?.amountKobo ?? MIN_CONTRIBUTION_KOBO)}</Text>
          )}

          {/* Message */}
          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Add a message of support (optional)</Text>
          <TextInput
            style={styles.messageInput}
            placeholder="Wishing you all the best…"
            placeholderTextColor={Colors.outline}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={200}
            textAlignVertical="top"
          />

          {/* Anonymous */}
          <Pressable style={styles.anonRow} onPress={() => setAnonymous((v) => !v)} accessibilityRole="switch" accessibilityState={{ checked: anonymous }}>
            <View style={styles.anonLeft}>
              <EyeOff size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
              <View>
                <Text style={styles.anonLabel}>Contribute anonymously</Text>
                <Text style={styles.anonSub}>Your name stays private to the public</Text>
              </View>
            </View>
            <View style={[styles.switch, anonymous && styles.switchOn]}><View style={[styles.knob, anonymous && styles.knobOn]} /></View>
          </Pressable>
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label={valid ? `Continue · ${formatNaira(amountKobo)}` : 'Continue'} onPress={proceed} disabled={!valid} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.lg },
  tierCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgOrange, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  tierTitle: { ...Typography.labelLg, color: Colors.onSurface },
  tierMeta: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  amountChip: { width: '31.5%', paddingVertical: Spacing.md, alignItems: 'center', borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.outlineVariant },
  amountChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  amountText: { ...Typography.labelLg, color: Colors.onSurface },
  amountTextActive: { color: Colors.onPrimary },
  customWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, paddingHorizontal: Spacing.md, height: 64 },
  customWrapError: { borderColor: Colors.error },
  naira: { ...Typography.headlineMd, color: Colors.onSurfaceVariant, marginRight: 4 },
  customInput: { flex: 1, ...Typography.headlineMd, color: Colors.onSurface, padding: 0 },
  errorText: { ...Typography.labelSm, color: Colors.error, marginTop: 6 },
  messageInput: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 80, ...Typography.bodyMd, color: Colors.onSurface },
  anonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.lg },
  anonLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flex: 1 },
  anonLabel: { ...Typography.labelLg, color: Colors.onSurface },
  anonSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
