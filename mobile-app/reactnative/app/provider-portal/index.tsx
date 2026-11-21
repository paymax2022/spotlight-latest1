import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProviderCapabilities } from '@/features/providerPortal/useProviderCapabilities';
import { PORTAL_ROUTES, portalRoute } from '@/features/providerPortal/portals';
import { PortalIcon } from '@/features/providerPortal/PortalIcon';
import type { ProviderType } from '@/features/providerPortal/gate';

export default function ProviderPortalScreen() {
  const { data: caps, isLoading, isError, refetch } = useProviderCapabilities();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Provider portal" subtitle="Manage your business" />
      {isLoading ? (
        <StateView kind="loading" message="Loading your businesses…" />
      ) : isError || !caps ? (
        <StateView kind="error" title="Couldn't load your businesses" actionLabel="Retry" onAction={() => { void refetch(); }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {caps.length > 0 ? <Text style={styles.section}>Your businesses</Text> : null}
          {caps.map((c) => {
            const meta = PORTAL_ROUTES[c.type];
            if (!meta) return null;
            return (
              <Pressable
                key={`${c.type}:${c.providerId}`}
                style={[styles.card, shadow1]}
                onPress={() => router.push(portalRoute(c.type, c.approved) as never)}
                accessibilityRole="button"
                accessibilityLabel={`${meta.label}: ${c.displayName}`}
              >
                <View style={styles.iconWrap}><PortalIcon type={c.type} color={Colors.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{c.displayName || meta.label}</Text>
                  <Text style={styles.cardSub}>{meta.label} · {c.approved ? 'Approved' : c.status.toLowerCase()}</Text>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            );
          })}

          <Text style={styles.section}>{caps.length > 0 ? 'Add another business' : 'Become a provider'}</Text>
          {(Object.keys(PORTAL_ROUTES) as ProviderType[])
            .filter((t) => !caps.some((c) => c.type === t) && PORTAL_ROUTES[t].apply)
            .map((t) => {
              const meta = PORTAL_ROUTES[t];
              return (
                <Pressable key={t} style={[styles.card, shadow1]} onPress={() => router.push(meta.apply as never)} accessibilityRole="button" accessibilityLabel={`Apply as ${meta.label}`}>
                  <View style={styles.iconWrap}><PortalIcon type={t} color={Colors.onSurfaceVariant} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Apply as {meta.label}</Text>
                  </View>
                  <ChevronRight size={18} color={Colors.onSurfaceVariant} />
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
  content: { padding: Spacing.containerMargin, gap: Spacing.sm, paddingBottom: 40 },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  iconWrap: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.labelMd, color: Colors.onSurface },
  cardSub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
