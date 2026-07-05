import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Pill, ScrollText, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useOrder } from '@/features/health/pharmacy/hooks';
import { useCartStore } from '@/features/health/pharmacy/cartStore';
import { formatNaira } from '@/features/health/constants/health.constants';

export default function ReorderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order, isLoading, isError, refetch } = useOrder(id);
  const addLine = useCartStore((s) => s.add);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState(false);

  React.useEffect(() => {
    if (order) {
      const init: Record<string, boolean> = {};
      order.lines.forEach((l) => (init[l.productId] = true));
      setSelected(init);
    }
  }, [order]);

  const onReorder = () => {
    if (!order) return;
    order.lines
      .filter((l) => selected[l.productId])
      .forEach((l) =>
        addLine(
          {
            id: l.productId,
            pharmacyId: order.pharmacyId,
            pharmacyName: order.pharmacyName,
            name: l.name,
            brand: '',
            form: l.form,
            category: 'otc',
            priceKobo: l.priceKobo,
            nafdacReg: '',
            rxRequired: l.rxRequired,
            imageColor: l.imageColor,
            description: '',
            inStock: true,
            rating: 0,
            reviewCount: 0,
            manufacturer: '',
          },
          l.qty,
        ),
      );
    setDone(true);
  };

  const selectedTotal = (order?.lines ?? [])
    .filter((l) => selected[l.productId])
    .reduce((s, l) => s + l.priceKobo * l.qty, 0);
  const anySelected = Object.values(selected).some(Boolean);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Reorder" subtitle={order?.reference} />

      {isLoading ? (
        <StateView kind="loading" message="Loading order…" />
      ) : isError || !order ? (
        <StateView kind="error" title="Couldn't load order" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.hint}>Select the items to add back to your cart.</Text>
            {order.lines.map((l) => {
              const sel = selected[l.productId];
              return (
                <Pressable
                  key={l.productId}
                  style={[styles.line, shadow1]}
                  onPress={() => setSelected((s) => ({ ...s, [l.productId]: !s[l.productId] }))}
                >
                  <View style={[styles.check, sel && styles.checkOn]}>{sel ? <Check size={14} color={Colors.white} strokeWidth={3} /> : null}</View>
                  <View style={[styles.thumb, { backgroundColor: l.imageColor }]}>
                    <Pill size={20} color={Colors.secondary} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {l.qty} × {l.name}
                    </Text>
                    <Text style={styles.form}>{l.form}</Text>
                    {l.rxRequired ? (
                      <View style={styles.rxTag}>
                        <ScrollText size={11} color={Colors.secondary} strokeWidth={2.2} />
                        <Text style={styles.rxTagText}>Rx required</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.price}>{formatNaira(l.priceKobo * l.qty)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footer}>
            {done ? (
              <PrimaryButton label="Go to cart" onPress={() => router.replace('/health/pharmacy/cart')} />
            ) : (
              <PrimaryButton
                label={anySelected ? `Add to cart · ${formatNaira(selectedTotal)}` : 'Select items to add'}
                onPress={onReorder}
                disabled={!anySelected}
              />
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  thumb: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.labelLg, color: Colors.onSurface },
  form: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  rxTag: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  rxTagText: { ...Typography.caption, color: Colors.secondary, fontWeight: '700' as const },
  price: { ...Typography.labelLg, color: Colors.primary },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
