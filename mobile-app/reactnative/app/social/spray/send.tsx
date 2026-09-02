import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Droplets, Trophy, Radio } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import SprayButton from '@/features/social/components/spray-SprayButton';
import { useSprayTarget, useSendSpray, formatNaira, SPRAY_PRESETS_KOBO, SPRAY_DISCLOSURE } from '@/features/social/spray';
import { SocialColors } from '@/features/social/constants/social.constants';
import { sanitizeMoneyInput } from '@/utils/money';
import { HomeMenuButton } from '@/components/HomeMenu';

export default function SpraySend() {
  // targetId is supplied when wired from a live/event; falls back to a demo live.
  const params = useLocalSearchParams<{ targetId?: string }>();
  const targetId = params.targetId ?? 'live_tope';
  const target = useSprayTarget(targetId);
  const spray = useSendSpray(targetId);
  const pay = usePurchasePayment();

  const [amountKobo, setAmountKobo] = useState<number>(SPRAY_PRESETS_KOBO[1]);
  const [custom, setCustom] = useState('');
  const [done, setDone] = useState(false);

  const effectiveKobo = useMemo(() => {
    const c = parseInt(custom.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(c) && c > 0 ? c * 100 : amountKobo;
  }, [custom, amountKobo]);

  const onSpray = () => {
    pay.start({
      amountKobo: effectiveKobo,
      title: `Spray ${target.data?.hostName ?? ''}`,
      charge: () => spray.mutateAsync(effectiveKobo),
      onPaid: () => setDone(true),
    });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn}><ArrowLeft size={22} color={Colors.onSurface} /></Pressable><Text style={styles.headerTitle}>Sprayed!</Text><View style={styles.iconBtn} /></View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <StateView kind="empty" icon="Droplets" title="💸 Sprayed!" message={`You sprayed ${formatNaira(effectiveKobo)} on ${target.data?.title ?? 'the live'}.`} actionLabel="See leaderboard" onAction={() => router.replace(`/social/spray/leaderboard?targetId=${targetId}`)} />
          <HomeMenuButton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/social')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Spray</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pressable onPress={() => router.push(`/social/spray/leaderboard?targetId=${targetId}`)} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Leaderboard"><Trophy size={20} color={Colors.onSurface} /></Pressable>
          <HomeMenuButton />
        </View>
      </View>

      {target.isLoading ? (
        <StateView kind="loading" message="Loading…" />
      ) : target.isError || !target.data ? (
        <StateView kind="error" title="Couldn't load spray" actionLabel="Retry" onAction={() => target.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.targetCard, { backgroundColor: target.data.avatarColor }]}>
            <View style={styles.liveTag}><Radio size={12} color="#FFFFFF" /><Text style={styles.liveText}>{target.data.context === 'live' ? 'LIVE' : 'EVENT'}</Text></View>
            <Text style={styles.targetTitle}>{target.data.title}</Text>
            <Text style={styles.targetHost}>Hosted by {target.data.hostName} · {target.data.hostHandle}</Text>
          </View>

          <Text style={styles.label}>Pick an amount to spray</Text>
          <View style={styles.grid}>
            {SPRAY_PRESETS_KOBO.map((p) => (
              <SprayButton key={p} amountKobo={p} selected={!custom && amountKobo === p} onPress={() => { setCustom(''); setAmountKobo(p); }} style={styles.gridItem} />
            ))}
          </View>

          <Text style={styles.label}>Or custom amount (₦)</Text>
          <TextInput style={styles.input} placeholder="e.g. 3000" placeholderTextColor={SocialColors.muted} keyboardType="decimal-pad" inputMode="decimal" maxLength={13} value={custom} onChangeText={(t) => setCustom(sanitizeMoneyInput(t))} />

          <View style={styles.disclosure}><Text style={styles.disclosureText}>{SPRAY_DISCLOSURE}</Text></View>

          <PrimaryButton label={`Spray ${formatNaira(effectiveKobo)}`} onPress={onSpray} disabled={effectiveKobo <= 0} style={{ marginTop: Spacing.md }} />
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
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  targetCard: { borderRadius: Radius.xl, padding: Spacing.lg, gap: 4 },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.25)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  liveText: { ...Typography.labelSm, color: '#FFFFFF' },
  targetTitle: { ...Typography.headlineMd, color: '#FFFFFF', marginTop: 6 },
  targetHost: { ...Typography.bodySm, color: 'rgba(255,255,255,0.85)' },
  label: { ...Typography.labelMd, color: SocialColors.text, marginTop: Spacing.md, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  gridItem: { flexGrow: 1, minWidth: '30%' },
  input: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: SocialColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: 14, backgroundColor: SocialColors.surface },
  disclosure: { backgroundColor: SocialColors.warnBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  disclosureText: { ...Typography.labelSm, color: SocialColors.warnText },
});
