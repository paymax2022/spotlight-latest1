import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Share2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useVerticals } from '@/features/referral/invite/hooks';

// M-INV-09 — Vertical referral picker: refer to property / bills / savings / mini-apps.
export default function VerticalPickerScreen() {
  const { data, isLoading, isError, refetch } = useVerticals();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Refer to a service" />
      {isLoading ? (
        <StateView kind="loading" message="Loading services…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Try again." actionLabel="Retry" onAction={refetch} />
      ) : !data || data.length === 0 ? (
        <StateView kind="empty" icon="Grid3x3" title="No services" message="No verticals to refer to right now." />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard tone="info" body="Refer people to what they actually need. Rewards still depend on their real, verified activity in that service." />
          {data.map((v) => {
            const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[v.icon] ?? Icons.Grid3x3;
            return (
              <Pressable key={v.id} style={styles.card} onPress={() => Share.share({ message: v.message }).catch(() => {})} accessibilityRole="button">
                <View style={styles.iconWrap}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{v.label}</Text>
                  <Text style={styles.blurb}>{v.blurb}</Text>
                </View>
                <Share2 size={18} color={Colors.outline} strokeWidth={2} />
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
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primaryContainer, alignItems: 'center', justifyContent: 'center' },
  label: { ...Typography.labelLg, color: Colors.onSurface },
  blurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
