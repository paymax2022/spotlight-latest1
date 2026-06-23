import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import CardVisual from '@/features/fx/components/CardVisual';
import TxStatusBadge from '@/features/fx/components/TxStatusBadge';
import { useCards } from '@/features/fx/hooks/useFxCards';
import { formatMoney } from '@/features/fx/utils/fxFormatters';

export default function CardsDashboardScreen() {
  const { data, isLoading, isError, refetch } = useCards();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Cards"
        subtitle="Virtual cards for online spend"
        rightSlot={
          <Pressable onPress={() => router.push('/fx/cards/new')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Create card">
            <Plus size={22} color={Colors.secondary} strokeWidth={2} />
          </Pressable>
        }
      />

      {isLoading ? (
        <StateView kind="loading" message="Loading your cards…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load cards" actionLabel="Retry" onAction={() => refetch()} />
      ) : (data ?? []).length === 0 ? (
        <StateView
          kind="empty" icon="CreditCard" title="No cards yet"
          message="Create a virtual card to pay subscriptions and online merchants in any currency."
          actionLabel="Create virtual card" onAction={() => router.push('/fx/cards/new')}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {(data ?? []).map((card) => (
            <Pressable key={card.id} style={styles.cardWrap} onPress={() => router.push(`/fx/cards/${card.id}`)} accessibilityRole="button" accessibilityLabel={`${card.label} card ending ${card.last4}`}>
              <CardVisual card={card} compact />
              <View style={styles.metaRow}>
                <View style={styles.metaLeft}>
                  <Text style={styles.balance}>{formatMoney(card.balance, card.currency)}</Text>
                  <Text style={styles.balanceLabel}>Available balance</Text>
                </View>
                <View style={styles.metaRight}>
                  <TxStatusBadge status={card.status} size="sm" />
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </View>
              </View>
            </Pressable>
          ))}

          <Pressable style={styles.addBtn} onPress={() => router.push('/fx/cards/new')} accessibilityRole="button">
            <Plus size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.addText}>Create new card</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  cardWrap: { gap: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xs },
  metaLeft: {},
  balance: { ...Typography.titleMd, color: Colors.onSurface },
  balanceLabel: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.secondary,
  },
  addText: { ...Typography.labelLg, color: Colors.secondary },
});
