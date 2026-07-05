import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Layers, Clock, Droplet, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { usePackages } from '@/features/health/lab/hooks';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function PackagesScreen() {
  const { data, isLoading, isError, refetch } = usePackages();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Health packages" subtitle="Bundled screens, better value" />
      {isLoading ? (
        <StateView kind="loading" message="Loading packages…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load packages" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (data ?? []).length === 0 ? (
        <StateView kind="empty" icon="Layers" title="No packages yet" message="Check back soon." />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {(data ?? []).map((p) => {
            const saving = p.listPriceKobo - p.priceKobo;
            return (
              <Pressable
                key={p.id}
                style={[styles.card, shadow1]}
                onPress={() =>
                  router.push({
                    pathname: '/health/lab/lab-select',
                    params: { packageId: p.id, name: p.name, priceKobo: String(p.priceKobo), homeCollection: '1' },
                  })
                }
              >
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: p.imageColor }]}>
                    <Layers size={20} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{p.name}</Text>
                    <Text style={styles.count}>{p.testCount} tests included</Text>
                  </View>
                  {p.popular ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>POPULAR</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.desc} numberOfLines={2}>{p.description}</Text>
                <View style={styles.chips}>
                  <View style={styles.chip}>
                    <Clock size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                    <Text style={styles.chipText}>{p.tat}</Text>
                  </View>
                  {p.fastingRequired ? (
                    <View style={[styles.chip, styles.chipWarn]}>
                      <Droplet size={12} color={Colors.onWarning} strokeWidth={2} />
                      <Text style={[styles.chipText, { color: Colors.onWarning }]}>Fasting</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.foot}>
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>{formatNaira(p.priceKobo)}</Text>
                    <Text style={styles.list}>{formatNaira(p.listPriceKobo)}</Text>
                  </View>
                  {saving > 0 ? <Text style={styles.save}>Save {formatNaira(saving)}</Text> : null}
                  <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, color: Colors.onSurface },
  count: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  badge: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  badgeText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 18 },
  chips: { flexDirection: 'row', gap: Spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  chipWarn: { backgroundColor: Colors.iconBgGold },
  chipText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  foot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  price: { ...Typography.titleMd, color: Colors.primary },
  list: { ...Typography.bodySm, color: Colors.onSurfaceVariant, textDecorationLine: 'line-through' },
  save: { ...Typography.labelSm, color: Colors.teal, flex: 1 },
});
