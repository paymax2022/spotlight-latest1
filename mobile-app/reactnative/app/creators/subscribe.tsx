import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { PaymentSheet, usePurchasePayment } from '@/features/payments';
import CreatorSubTierCard from '@/features/creators/components/creator-SubTierCard';
import { useStorefront, useSubscribe } from '@/features/creators/hooks';
import { CreatorsColors, formatNaira, NL5_DISCLOSURE } from '@/features/creators/constants/creators.constants';

export default function SubscribeScreen() {
  const { creatorId } = useLocalSearchParams<{ creatorId: string }>();
  const store = useStorefront(creatorId ?? '');
  const subscribe = useSubscribe();
  const pay = usePurchasePayment();

  const [tierId, setTierId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tiers = store.data?.tiers ?? [];
  const selected = tiers.find((t) => t.id === tierId) ?? tiers.find((t) => t.popular) ?? tiers[0];

  const onSubscribe = () => {
    if (!creatorId || !selected) return;
    pay.start({
      amountKobo: selected.priceKobo,
      title: `Subscribe — ${selected.name}`,
      charge: () => subscribe.mutateAsync({ creatorId, tierId: selected.id }),
      onPaid: () => setDone(true),
    });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace('/creators/my-subscriptions')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} /></Pressable>
          <Text style={styles.headerTitle}>Subscribed</Text>
          <View style={styles.iconBtn} />
        </View>
        <StateView kind="empty" icon="CheckCircle2" title="You're subscribed!" message={`${selected?.name} tier active for ${store.data?.creator.displayName}. Renews monthly.`} actionLabel="View my subscriptions" onAction={() => router.replace('/creators/my-subscriptions')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack('/creators')} hitSlop={10} style={styles.iconBtn} accessibilityLabel="Close"><X size={22} color={Colors.onSurface} /></Pressable>
        <Text style={styles.headerTitle}>Subscribe</Text>
        <View style={styles.iconBtn} />
      </View>

      {store.isLoading ? (
        <StateView kind="loading" message="Loading tiers…" />
      ) : store.isError || !store.data ? (
        <StateView kind="error" title="Couldn't load tiers" actionLabel="Retry" onAction={() => store.refetch()} />
      ) : tiers.length === 0 ? (
        <StateView kind="empty" title="No tiers yet" message="This creator hasn't set up subscriptions." icon="Inbox" />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.sub}>Support {store.data.creator.displayName} with a monthly subscription.</Text>
            <View style={{ gap: Spacing.md }}>
              {tiers.map((t) => (
                <CreatorSubTierCard key={t.id} tier={t} selected={selected?.id === t.id} onPress={() => setTierId(t.id)} />
              ))}
            </View>
            <View style={styles.disclosure}><Text style={styles.disclosureText}>{NL5_DISCLOSURE}</Text></View>
            <View style={{ height: 120 }} />
          </ScrollView>
          <View style={styles.footer}>
            <PrimaryButton label={selected ? `Subscribe — ${formatNaira(selected.priceKobo)}/mo` : 'Select a tier'} onPress={onSubscribe} disabled={!selected} />
          </View>
        </>
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
  sub: { ...Typography.bodyMd, color: CreatorsColors.muted, marginBottom: Spacing.md },
  disclosure: { backgroundColor: CreatorsColors.warnBg, borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md },
  disclosureText: { ...Typography.labelSm, color: CreatorsColors.warnText },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
