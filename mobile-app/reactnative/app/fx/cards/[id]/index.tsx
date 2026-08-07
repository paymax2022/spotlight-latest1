import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Eye, EyeOff, Plus, Snowflake, Sun, SlidersHorizontal, ListOrdered, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CardVisual from '@/features/fx/components/CardVisual';
import SummaryRow from '@/features/fx/components/SummaryRow';
import { useCard, useRevealCard, useSetCardFrozen, useTerminateCard } from '@/features/fx/hooks/useFxCards';
import { formatMoney } from '@/features/fx/utils/fxFormatters';
import { confirmAsync } from '@/lib/confirm';
import type { CardSensitive } from '@/features/fx/types/fx.types';

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: card, isLoading, isError, refetch } = useCard(id);
  const reveal = useRevealCard();
  const setFrozen = useSetCardFrozen();
  const terminate = useTerminateCard();
  const [sensitive, setSensitive] = useState<CardSensitive | null>(null);

  if (isLoading) return <SafeAreaView style={styles.safe}><ScreenHeader title="Card" /><StateView kind="loading" /></SafeAreaView>;
  if (isError || !card) return <SafeAreaView style={styles.safe}><ScreenHeader title="Card" /><StateView kind="error" title="Couldn't load card" actionLabel="Retry" onAction={() => refetch()} /></SafeAreaView>;

  const frozen = card.status === 'frozen';

  const toggleReveal = async () => {
    if (sensitive) { setSensitive(null); return; }
    const s = await reveal.mutateAsync(card.id);
    setSensitive(s);
  };

  const confirmTerminate = async () => {
    const ok = await confirmAsync({
      title: 'Terminate card',
      message: `Permanently terminate "${card.label}"? Any remaining ${formatMoney(card.balance, card.currency)} is returned to your wallet. This can't be undone.`,
      confirmLabel: 'Terminate',
      destructive: true,
    });
    if (!ok) return;
    await terminate.mutateAsync(card.id); router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={card.label} subtitle={`•••• ${card.last4}`} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <CardVisual card={card} sensitive={sensitive} />

        {/* Reveal + copy */}
        <Pressable style={styles.revealBtn} onPress={toggleReveal} accessibilityRole="button" accessibilityLabel={sensitive ? 'Hide card details' : 'Reveal card details'}>
          {sensitive ? <EyeOff size={18} color={Colors.secondary} strokeWidth={2} /> : <Eye size={18} color={Colors.secondary} strokeWidth={2} />}
          <Text style={styles.revealText}>{sensitive ? 'Hide details' : reveal.isPending ? 'Revealing…' : 'Reveal & copy details'}</Text>
        </Pressable>

        {sensitive ? (
          <View style={styles.card}>
            <SummaryRow label="Card number" value={sensitive.pan} copyable />
            <SummaryRow label="Expiry" value={sensitive.expiry} copyable />
            <SummaryRow label="CVV" value={sensitive.cvv} copyable />
          </View>
        ) : null}

        {/* Balance + fund */}
        <View style={styles.balanceCard}>
          <View>
            <Text style={styles.balanceLabel}>Card balance</Text>
            <Text style={styles.balance}>{formatMoney(card.balance, card.currency)}</Text>
            <Text style={styles.spent}>Spent this month: {formatMoney(card.spentThisMonth, card.currency)}</Text>
          </View>
          <Pressable style={styles.fundBtn} onPress={() => router.push(`/fx/cards/${card.id}/fund`)} accessibilityRole="button">
            <Plus size={18} color={Colors.onPrimary} strokeWidth={2.2} />
            <Text style={styles.fundText}>Fund</Text>
          </Pressable>
        </View>

        {/* Quick actions */}
        <View style={styles.actionsGrid}>
          <Action
            icon={frozen ? <Sun size={20} color={Colors.secondary} strokeWidth={2} /> : <Snowflake size={20} color={Colors.secondary} strokeWidth={2} />}
            label={frozen ? 'Unfreeze' : 'Freeze'}
            onPress={() => setFrozen.mutate({ id: card.id, frozen: !frozen })}
          />
          <Action icon={<SlidersHorizontal size={20} color={Colors.secondary} strokeWidth={2} />} label="Controls" onPress={() => router.push(`/fx/cards/${card.id}/controls`)} />
          <Action icon={<ListOrdered size={20} color={Colors.secondary} strokeWidth={2} />} label="Activity" onPress={() => router.push(`/fx/cards/${card.id}/transactions`)} />
        </View>

        {frozen ? (
          <View style={styles.frozenNote}>
            <Snowflake size={15} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.frozenText}>This card is frozen. Payments will be declined until you unfreeze it.</Text>
          </View>
        ) : null}

        {/* Terminate */}
        <Pressable style={styles.terminate} onPress={confirmTerminate} accessibilityRole="button">
          <Trash2 size={18} color={Colors.error} strokeWidth={2} />
          <Text style={styles.terminateText}>Terminate card</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Action({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  revealBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.secondary },
  revealText: { ...Typography.labelLg, color: Colors.secondary },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  balanceCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md,
  },
  balanceLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  balance: { ...Typography.headlineMd, color: Colors.onSurface, marginVertical: 2 },
  spent: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  fundBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, height: 44 },
  fundText: { ...Typography.labelLg, color: Colors.onPrimary },
  actionsGrid: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingVertical: Spacing.md },
  actionIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface },
  frozenNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.iconBgBlue, borderRadius: Radius.md, padding: Spacing.md },
  frozenText: { ...Typography.labelSm, color: Colors.secondary, flex: 1, lineHeight: 18 },
  terminate: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: Spacing.md, marginTop: Spacing.xs },
  terminateText: { ...Typography.labelLg, color: Colors.error },
});
