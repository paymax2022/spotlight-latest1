import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Coffee, Clock, Car, ShieldCheck, Check, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useStaysStore } from '@/features/stays/store';
import { useAddOns } from '@/features/stays/hooks';
import { formatNaira, StaysColors } from '@/features/stays/constants/stays.constants';
import type { AddOn } from '@/features/stays/types';

const ICON: Record<AddOn['key'], React.ComponentType<any>> = {
  breakfast: Coffee,
  late_checkout: Clock,
  airport_pickup: Car,
  travel_insurance: ShieldCheck,
};

export default function AddOnsScreen() {
  const { addOnKeys, toggleAddOn } = useStaysStore();
  const addons = useAddOns();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add-ons & extras" subtitle="Step 3 of 5 · optional" />
      {addons.isLoading ? (
        <StateView kind="loading" message="Loading extras…" />
      ) : addons.isError ? (
        <StateView kind="error" title="Couldn't load extras" actionLabel="Retry" onAction={() => addons.refetch()} />
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {addons.data!.map((a) => {
              const Icon = ICON[a.key] ?? Coffee;
              const on = addOnKeys.includes(a.key);
              return (
                <View key={a.key} style={[styles.card, on && styles.cardOn]}>
                  <View style={styles.cardIcon}><Icon size={20} color={StaysColors.brand} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{a.label}</Text>
                    <Text style={styles.desc}>{a.description}</Text>
                    {a.crossSellRoute ? (
                      <Pressable style={styles.crossSell} onPress={() => router.push(a.crossSellRoute as any)}>
                        <Text style={styles.crossSellText}>
                          {a.key === 'airport_pickup' ? 'Open Paymax Transport' : 'Open Paymax Protection'}
                        </Text>
                        <ChevronRight size={14} color={Colors.secondary} />
                      </Pressable>
                    ) : null}
                  </View>
                  <View style={styles.right}>
                    <Text style={styles.price}>+{formatNaira(a.priceMinor)}</Text>
                    <Pressable
                      style={[styles.checkbox, on && styles.checkboxOn]}
                      onPress={() => toggleAddOn(a.key)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      {on ? <Check size={16} color={Colors.onPrimary} strokeWidth={3} /> : null}
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <Text style={styles.note}>Airport pickup and travel insurance are provided by Paymax Transport and Protection. Add-ons are charged in Naira.</Text>
          </ScrollView>

          <View style={styles.footer}>
            <PrimaryButton
              label={addOnKeys.length > 0 ? `Continue · ${addOnKeys.length} extra${addOnKeys.length > 1 ? 's' : ''}` : 'Continue without extras'}
              onPress={() => router.push('/stays/book/price-breakdown')}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.md },
  card: { flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md },
  cardOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  cardIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.titleMd, color: Colors.onSurface },
  desc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  crossSell: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  crossSellText: { ...Typography.labelSm, color: Colors.secondary },
  right: { alignItems: 'flex-end', gap: Spacing.sm },
  price: { ...Typography.labelLg, color: Colors.onSurface },
  checkbox: { width: 28, height: 28, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  note: { ...Typography.caption, color: Colors.onSurfaceVariant },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
