import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import {
  Home, BedDouble, ReceiptText, DoorOpen, ChevronRight, UserPlus, FileBadge,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import ContextSwitcher from '@/components/ContextSwitcher';
import { PROPERTY_SUBMODULES, type PropertyPillar } from '@/constants/modules';
import { useContext as usePropertyContext } from '@/features/property/hooks';
import { useModuleVisibility } from '@/features/modules/visibility';
import { propertyRegistryKeyFor } from '@/features/modules/serviceModuleKeys';

const PILLAR_ICON: Record<PropertyPillar, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  marketplace: Home,
  stays:       BedDouble,
  rent:        ReceiptText,
  estate:      DoorOpen,
};

export default function PropertyHub() {
  const { data } = usePropertyContext();
  const active = data?.activeContext
    ? data.contexts.find((c) => c.type === data.activeContext!.type && c.id === data.activeContext!.id)
    : undefined;
  const activeRoles = active?.roles ?? [];

  // Registry gate. Applied BEFORE role ranking so an unpublished pillar cannot be
  // floated to the top by a matching role. A pillar with no registry mapping is
  // never gated; an unreachable registry shows everything.
  const { isVisible } = useModuleVisibility();
  const published = React.useMemo(
    () => PROPERTY_SUBMODULES.filter((p) => {
      const key = propertyRegistryKeyFor(p.id);
      return key === null || isVisible(key);
    }),
    [isVisible],
  );

  // Role-aware ordering: pillars whose roles intersect the active context's roles
  // float to the top, but every pillar stays visible (discovery isn't role-gated).
  const ranked = [...published].sort((a, b) => {
    const aRel = a.roles?.some((r) => activeRoles.includes(r as never)) ? 0 : 1;
    const bRel = b.roles?.some((r) => activeRoles.includes(r as never)) ? 0 : 1;
    return aRel - bRel;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Property"
        subtitle="Marketplace · Stays · Rent · Estate"
        rightSlot={<ContextSwitcher />}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Pillars */}
        <SectionHeader title="What do you need?" style={styles.section} />
        {ranked.length === 0 ? (
          /* Every pillar is unpublished in this environment. A hub that renders an
             empty grid reads as broken, so say what happened and offer a way out
             rather than leaving a dead end. */
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyBody}>
              Property services aren&apos;t available on your account yet. They&apos;ll appear
              here as soon as they go live.
            </Text>
            <Pressable
              onPress={() => goBack('/')}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={styles.emptyBtn}
            >
              <Text style={styles.emptyBtnText}>Go back</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={styles.grid}>
          {ranked.map((p) => {
            const Icon = PILLAR_ICON[p.pillar];
            const isPrimary = p.roles?.some((r) => activeRoles.includes(r as never));
            return (
              <Pressable
                key={p.id}
                onPress={() => router.push(p.route as never)}
                accessibilityRole="button"
                accessibilityLabel={p.label}
                style={({ pressed }) => [styles.card, isPrimary && styles.cardPrimary, pressed && styles.pressed]}
              >
                <View style={styles.cardIcon}>
                  <Icon size={24} color={Colors.teal} strokeWidth={1.8} />
                </View>
                <Text style={styles.cardTitle} numberOfLines={1}>{p.label}</Text>
                <Text style={styles.cardDesc} numberOfLines={3}>{p.desc}</Text>
                {p.phase !== 'live' ? (
                  <View style={styles.phaseBadge}>
                    <Text style={styles.phaseText}>{p.phase === 'beta' ? 'Beta' : 'Soon'}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {/* Cross-pillar actions */}
        <SectionHeader title="Your account" style={styles.section} />
        <View style={styles.linkList}>
          <Pressable
            onPress={() => router.push('/property/roles')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <View style={styles.linkIcon}><UserPlus size={20} color={Colors.primary} strokeWidth={1.8} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Add a role</Text>
              <Text style={styles.linkSub}>Become a tenant, landlord or host — may need step-up KYC.</Text>
            </View>
            <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable
            onPress={() => router.push('/property/rent-passport')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <View style={styles.linkIcon}><FileBadge size={20} color={Colors.primary} strokeWidth={1.8} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkTitle}>Rent passport</Text>
              <Text style={styles.linkSub}>Your portable tenancy score & payment history.</Text>
            </View>
            <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { paddingHorizontal: 0, marginTop: Spacing.sm },
  pressed: { opacity: 0.8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  emptyBox:     { marginHorizontal: Spacing.containerMargin, padding: Spacing.lg, borderRadius: Radius.lg,
                  backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
                  alignItems: 'center', gap: Spacing.sm },
  emptyTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  emptyBody:    { ...Typography.bodySm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  emptyBtn:     { marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, height: 40, borderRadius: Radius.full,
                  alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerHigh },
  emptyBtnText: { ...Typography.labelMd, color: Colors.onSurface },
  card: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    gap: Spacing.xs,
    ...shadow1,
  },
  cardPrimary: { borderColor: Colors.teal },
  cardIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  phaseBadge: { alignSelf: 'flex-start', marginTop: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  phaseText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  linkList: { gap: Spacing.sm },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
  },
  linkIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { ...Typography.labelLg, color: Colors.onSurface },
  linkSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
