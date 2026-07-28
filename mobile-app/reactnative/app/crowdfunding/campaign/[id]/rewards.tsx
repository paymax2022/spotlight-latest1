import React from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Truck, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useCampaign } from '@/features/crowdfunding/hooks/useCrowdfunding';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function RewardsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: c, isLoading, isError, refetch } = useCampaign(id);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reward tiers" />
      {isLoading ? (
        <StateView kind="loading" />
      ) : isError || !c ? (
        <StateView kind="error" title="Couldn't load rewards" actionLabel="Retry" onAction={refetch} />
      ) : c.rewardTiers.length === 0 ? (
        <StateView kind="empty" icon="Gift" title="No rewards" message="This campaign doesn't offer backer rewards." />
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {c.rewardTiers.map((t) => {
            const soldOut = t.limit != null && t.claimed >= t.limit;
            return (
              <View key={t.id} style={[styles.card, soldOut && styles.cardMuted]}>
                <View style={styles.head}>
                  <Text style={styles.pledge}>{formatNaira(t.amountKobo)}+</Text>
                  {t.limit != null && (
                    <Text style={styles.remaining}>{soldOut ? 'Sold out' : `${t.limit - t.claimed} of ${t.limit} left`}</Text>
                  )}
                </View>
                <Text style={styles.title}>{t.title}</Text>
                <Text style={styles.desc}>{t.description}</Text>
                <View style={styles.metaRow}>
                  {t.requiresShipping
                    ? <View style={styles.meta}><Truck size={13} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>Ships to you</Text></View>
                    : <View style={styles.meta}><Package size={13} color={Colors.onSurfaceVariant} strokeWidth={2} /><Text style={styles.metaText}>Digital reward</Text></View>}
                  {t.estimatedDelivery ? <Text style={styles.metaText}>Est. {t.estimatedDelivery}</Text> : null}
                </View>
                <Pressable
                  disabled={soldOut}
                  onPress={() => router.push(`/crowdfunding/contribute/${c.id}?rewardTierId=${t.id}`)}
                  style={[styles.selectBtn, soldOut && styles.selectBtnDisabled]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.selectText, soldOut && styles.selectTextDisabled]}>{soldOut ? 'Sold out' : 'Select reward'}</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.outlineVariant, padding: Spacing.md, gap: 6 },
  cardMuted: { opacity: 0.6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pledge: { ...Typography.titleMd, color: Colors.primary },
  remaining: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  desc: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  selectBtn: { marginTop: Spacing.sm, height: 44, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLow, borderWidth: 1.5, borderColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  selectBtnDisabled: { borderColor: Colors.outlineVariant },
  selectText: { ...Typography.labelMd, color: Colors.secondary },
  selectTextDisabled: { color: Colors.onSurfaceVariant },
});
