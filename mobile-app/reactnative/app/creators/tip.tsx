import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X, HandCoins, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useStorefront, useSendTip } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira, NL5_DISCLOSURE } from '@/features/creators/constants/creators.constants';
import { sanitizeMoneyInput } from '@/utils/money';

const PRESETS = [50_000, 100_000, 200_000, 500_000];

export default function TipScreen() {
  const { creatorId } = useLocalSearchParams<{ creatorId: string }>();
  const store = useStorefront(creatorId ?? '');
  const sendTip = useSendTip();
  const pay = usePurchasePayment();

  const [amountKobo, setAmountKobo] = useState<number>(100_000);
  const [custom, setCustom] = useState('');
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  const effectiveKobo = useMemo(() => {
    const c = parseInt(custom.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(c) && c > 0 ? c * 100 : amountKobo;
  }, [custom, amountKobo]);

  const onPay = () => {
    if (!creatorId) return;
    pay.start({
      amountKobo: effectiveKobo,
      title: `Tip ${store.data?.creator.displayName ?? 'creator'}`,
      charge: () => sendTip.mutateAsync({ creatorId, amountKobo: effectiveKobo, message: message || undefined }),
      onPaid: () => setDone(true),
    });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} /></Pressable>
          <Text style={styles.headerTitle}>Tip sent</Text>
          <View style={styles.iconBtn} />
        </View>
        <StateView kind="empty" icon="CheckCircle2" title="Thank you!" message={`Your ${formatNaira(effectiveKobo)} tip was sent to ${store.data?.creator.displayName ?? 'the creator'}.`} actionLabel="Done" onAction={() => goBack('/creators')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Send a tip</Text>
        <View style={styles.iconBtn} />
      </View>

      {store.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : store.isError || !store.data ? (
        <StateView kind="error" title="Couldn't load creator" actionLabel="Retry" onAction={() => store.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.creatorCard}>
            <View style={[styles.icon, { backgroundColor: store.data.creator.avatarColor }]}><HandCoins size={20} color="#FFFFFF" /></View>
            <View>
              <Text style={styles.creatorName}>{store.data.creator.displayName}</Text>
              <Text style={styles.creatorHandle}>{store.data.creator.handle}</Text>
            </View>
          </View>

          <Text style={styles.label}>Choose an amount</Text>
          <View style={styles.presetGrid}>
            {PRESETS.map((p) => {
              const sel = !custom && amountKobo === p;
              return (
                <Pressable key={p} style={[styles.preset, sel && styles.presetSel]} onPress={() => { setCustom(''); setAmountKobo(p); }}>
                  <Text style={[styles.presetText, sel && styles.presetTextSel]}>{formatNaira(p)}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Or enter a custom amount (₦)</Text>
          <TextInput style={styles.input} placeholder="e.g. 2500" placeholderTextColor={CreatorsColors.muted} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={custom} onChangeText={(v) => setCustom(sanitizeMoneyInput(v))} />

          <Text style={styles.label}>Message (optional)</Text>
          <TextInput style={[styles.input, styles.multiline]} placeholder="Say something nice…" placeholderTextColor={CreatorsColors.muted} value={message} onChangeText={setMessage} multiline />

          <View style={styles.disclosure}><Text style={styles.disclosureText}>{NL5_DISCLOSURE}</Text></View>

          <PrimaryButton label={`Tip ${formatNaira(effectiveKobo)}`} onPress={onPay} disabled={effectiveKobo <= 0} style={{ marginTop: Spacing.md }} />
          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      )}

      <PaymentSheet controller={pay} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm, gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { ...Typography.titleLg, color: Colors.onSurface, flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, gap: Spacing.xs },
  creatorCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: CreatorsColors.surfaceAlt, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  icon: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  creatorName: { ...Typography.titleMd, color: CreatorsColors.text },
  creatorHandle: { ...Typography.bodySm, color: CreatorsColors.muted },
  label: { ...Typography.labelMd, color: CreatorsColors.text, marginTop: Spacing.md, marginBottom: 6 },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  preset: { flexGrow: 1, minWidth: '45%', alignItems: 'center', paddingVertical: 14, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: CreatorsColors.border, backgroundColor: CreatorsColors.surface },
  presetSel: { borderColor: CreatorsColors.brand, backgroundColor: CreatorsColors.brandBg },
  presetText: { ...Typography.titleMd, color: CreatorsColors.text },
  presetTextSel: { color: CreatorsColors.brand },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: CreatorsColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: CreatorsColors.surface },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  disclosure: { backgroundColor: CreatorsColors.warnBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  disclosureText: { ...Typography.labelSm, color: CreatorsColors.warnText },
});
