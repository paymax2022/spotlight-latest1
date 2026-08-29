import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Lock, Play, ShieldAlert, Eye } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import { useContent, useUnlockContent } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira, NL11_AGE_GATE_NOTICE } from '@/features/creators/constants/creators.constants';

export default function GatedViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const content = useContent(id ?? '');
  const unlock = useUnlockContent(id ?? '');
  const pay = usePurchasePayment();

  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const item = content.data;
  const entitled = unlocked || (item ? item.entitled || !item.gated : false);

  const onUnlock = () => {
    if (!item) return;
    if (item.priceKobo) {
      pay.start({
        amountKobo: item.priceKobo,
        title: `Unlock — ${item.title}`,
        charge: () => unlock.mutateAsync(),
        onPaid: () => setUnlocked(true),
      });
    } else {
      // Subscriber-only — route to subscribe.
      router.push(`/creators/subscribe?creatorId=${item.creatorId}`);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Go back"><ArrowLeft size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{item?.title ?? 'Content'}</Text>
        <View style={styles.iconBtn} />
      </View>

      {content.isLoading ? (
        <StateView kind="loading" message="Loading content…" />
      ) : content.isError || !item ? (
        <StateView kind="error" title="Couldn't load content" actionLabel="Retry" onAction={() => content.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Age gate (NL-11) takes precedence */}
          {item.ageRestricted && !ageConfirmed ? (
            <View style={styles.gate}>
              <View style={[styles.gateIcon, { backgroundColor: CreatorsColors.dangerBg }]}><ShieldAlert size={28} color={CreatorsColors.danger} /></View>
              <Text style={styles.gateTitle}>18+ content</Text>
              <Text style={styles.gateText}>{NL11_AGE_GATE_NOTICE}</Text>
              <PrimaryButton label="I am 18 or older — continue" onPress={() => setAgeConfirmed(true)} style={{ marginTop: Spacing.md }} />
              <Pressable onPress={() => goBack('/creators')} style={{ marginTop: Spacing.sm }}><Text style={styles.cancel}>Go back</Text></Pressable>
            </View>
          ) : entitled ? (
            <>
              <View style={[styles.player, { backgroundColor: item.thumbColor }]}>
                <Play size={40} color="#FFFFFF" />
                {item.durationLabel ? <Text style={styles.duration}>{item.durationLabel}</Text> : null}
              </View>
              <Text style={styles.title}>{item.title}</Text>
              <View style={styles.metaRow}>
                <Eye size={14} color={CreatorsColors.ok} />
                <Text style={styles.entitledText}>You have access to this content.</Text>
              </View>
              <Text style={styles.body}>This is where the {item.kind} would play. Entitlement is GRANTED for your account.</Text>
            </>
          ) : (
            <View style={styles.gate}>
              <View style={[styles.gateIcon, { backgroundColor: CreatorsColors.brandBg }]}><Lock size={28} color={CreatorsColors.brand} /></View>
              <Text style={styles.gateTitle}>Locked content</Text>
              <Text style={styles.gateText}>
                {item.priceKobo
                  ? `Unlock this ${item.kind} for ${formatNaira(item.priceKobo)} (one-time).`
                  : `This is subscriber-only. Subscribe to ${item.title} to unlock.`}
              </Text>
              <PrimaryButton
                label={item.priceKobo ? `Unlock for ${formatNaira(item.priceKobo)}` : 'Subscribe to unlock'}
                onPress={onUnlock}
                style={{ marginTop: Spacing.md }}
              />
            </View>
          )}

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
  player: { height: 200, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center', gap: 8 },
  duration: { ...Typography.labelSm, color: '#FFFFFF', opacity: 0.9 },
  title: { ...Typography.headlineMd, color: CreatorsColors.text, marginTop: Spacing.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  entitledText: { ...Typography.labelMd, color: CreatorsColors.ok },
  body: { ...Typography.bodyMd, color: CreatorsColors.muted, marginTop: Spacing.md },
  gate: { alignItems: 'center', backgroundColor: CreatorsColors.surface, borderRadius: Radius.xl, padding: Spacing.lg, marginTop: Spacing.lg },
  gateIcon: { width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  gateTitle: { ...Typography.titleLg, color: CreatorsColors.text },
  gateText: { ...Typography.bodyMd, color: CreatorsColors.muted, textAlign: 'center', marginTop: 6 },
  cancel: { ...Typography.labelMd, color: CreatorsColors.muted },
});
