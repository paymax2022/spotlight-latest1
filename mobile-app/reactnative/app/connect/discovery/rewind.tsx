import React, { useState } from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RotateCcw, Crown, CircleCheck, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { ConnectColors } from '@/features/connect/constants/connect.constants';
import { useRewind } from '@/features/connect/discovery/hooks';
import DiscoveryVerifiedBadges from '@/features/connect/components/discovery-VerifiedBadges';

/**
 * Rewind / undo last swipe (PRD §10.2 DC-09). Premium. Calling with premium=false
 * returns { ok:false, reason } → upsell; unlocking sets premium=true and the
 * server restores the profile to the top of the stack.
 */
export default function RewindScreen() {
  const [premium, setPremium] = useState(false);
  const rewind = useRewind();

  const result = rewind.data;
  const restored = result?.ok ? result.restored : undefined;
  const upsellReason = result && !result.ok ? result.reason : undefined;

  function doRewind(asPremium: boolean) {
    rewind.mutate(asPremium);
  }

  function unlockAndRewind() {
    setPremium(true);
    doRewind(true);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ScreenHeader title="Rewind" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <RotateCcw size={32} color={ConnectColors.brand} strokeWidth={2} />
          </View>
          <Text style={styles.heroTitle}>Undo your last swipe</Text>
          <Text style={styles.heroCopy}>
            Changed your mind? Rewind brings the last profile you passed back to the top of your
            stack. Rewind is a Connect Plus feature.
          </Text>
        </View>

        {restored ? (
          <View style={styles.restoredCard}>
            <View style={styles.restoredHeader}>
              <CircleCheck size={20} color={ConnectColors.ok} strokeWidth={2.2} />
              <Text style={styles.restoredTitle}>Brought back</Text>
            </View>
            <Image
              source={{ uri: restored.photos[0] }}
              style={styles.restoredPhoto}
              resizeMode="cover"
            />
            <View style={styles.restoredBody}>
              <Text style={styles.restoredName}>
                {restored.displayName}, {restored.age}
              </Text>
              {restored.headline ? (
                <Text style={styles.restoredHeadline}>{restored.headline}</Text>
              ) : null}
              <View style={styles.distanceRow}>
                <MapPin size={13} color={ConnectColors.muted} strokeWidth={2} />
                <Text style={styles.distance}>{restored.distanceLabel}</Text>
              </View>
              <DiscoveryVerifiedBadges flags={restored.verified} size="sm" />
            </View>
          </View>
        ) : null}

        {upsellReason ? (
          <View style={styles.upsellCard}>
            <Crown size={22} color={Colors.gold} strokeWidth={2.2} />
            <Text style={styles.upsellTitle}>{upsellReason}</Text>
            <Text style={styles.upsellCopy}>
              Unlock Connect Plus to rewind your last swipe and undo accidental passes.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {restored ? (
          <PrimaryButton label="Back to swiping" onPress={() => router.back()} />
        ) : upsellReason ? (
          <PrimaryButton
            label="Unlock Connect Plus"
            loading={rewind.isPending}
            onPress={unlockAndRewind}
          />
        ) : (
          <PrimaryButton
            label="Rewind last swipe"
            loading={rewind.isPending}
            onPress={() => doRewind(premium)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.iconBgPurple,
  },
  heroTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  heroCopy: { ...Typography.bodyMd, color: ConnectColors.muted, textAlign: 'center' },
  restoredCard: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: ConnectColors.ok,
  },
  restoredHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.md,
  },
  restoredTitle: { ...Typography.labelLg, color: Colors.onSurface },
  restoredPhoto: { width: '100%', height: 260, backgroundColor: Colors.surfaceContainerHigh },
  restoredBody: { padding: Spacing.md, gap: Spacing.sm },
  restoredName: { ...Typography.titleLg, color: Colors.onSurface },
  restoredHeadline: { ...Typography.bodySm, color: ConnectColors.muted },
  distanceRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distance: { ...Typography.labelSm, color: ConnectColors.muted },
  upsellCard: {
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  upsellTitle: { ...Typography.titleMd, color: Colors.onSurface, textAlign: 'center' },
  upsellCopy: { ...Typography.bodySm, color: ConnectColors.muted, textAlign: 'center' },
  footer: {
    padding: Spacing.containerMargin,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    backgroundColor: Colors.background,
  },
});
