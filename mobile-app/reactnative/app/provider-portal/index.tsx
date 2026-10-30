import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Stethoscope, PawPrint, Pill, FlaskConical, UtensilsCrossed, Bike, Car, ShoppingBag,
  CalendarDays, Building2, KeyRound, Users, HeartHandshake, Bus, ChevronRight,
  type LucideIcon,
} from 'lucide-react-native';
import { Colors, Typography, Spacing, Radius, shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { useProviderCapabilities } from '@/features/providerPortal/useProviderCapabilities';
import type { ProviderType } from '@/features/providerPortal/gate';

// One entry per business type: where its management home is, and where an
// applicant starts. Extending the backend's capabilities query is the only thing
// needed for a new type to appear here. `apply` is omitted where the app has no
// self-serve application flow (the record is granted by ops), so the type never
// appears in the "become a provider" list.
const PORTALS: Record<
  ProviderType,
  { label: string; icon: LucideIcon; home: string; apply?: string }
> = {
  doctor: { label: 'Doctor', icon: Stethoscope, home: '/(doctor)/(tabs)', apply: '/(doctor)/onboarding' },
  vet: { label: 'Veterinary', icon: PawPrint, home: '/health/vet/provider/requests', apply: '/health/vet/provider/onboarding' },
  pharmacy: { label: 'Pharmacy', icon: Pill, home: '/health/pharmacy/provider', apply: '/health/pharmacy/provider/onboarding' },
  lab: { label: 'Laboratory', icon: FlaskConical, home: '/health/lab/provider/orders', apply: '/health/lab/provider/onboarding' },
  restaurant: { label: 'Restaurant', icon: UtensilsCrossed, home: '/food/restaurant', apply: '/food/restaurant/kyb' },
  // Riders are onboarded in Mobility; the food console only takes offers.
  rider: { label: 'Delivery rider', icon: Bike, home: '/food/rider', apply: '/mobility/driver/onboarding' },
  driver: { label: 'Driver', icon: Car, home: '/mobility/driver', apply: '/mobility/driver/onboarding' },
  marketplace_seller: { label: 'Marketplace shop', icon: ShoppingBag, home: '/marketplace/sell', apply: '/marketplace/sell' },
  event_organiser: { label: 'Event organiser', icon: CalendarDays, home: '/events/organiser/dashboard', apply: '/events/organiser/create' },
  // Estate management is granted with the estate itself; /estate-admin is the console.
  estate_manager: { label: 'Estate', icon: Building2, home: '/estate-admin' },
  property_manager: { label: 'Property manager', icon: KeyRound, home: '/property/roles', apply: '/property/role-profile' },
  association_creator: { label: 'Association', icon: Users, home: '/association/admin', apply: '/association/create' },
  crowdfunding_creator: { label: 'Campaign', icon: HeartHandshake, home: '/crowdfunding/creator', apply: '/crowdfunding/create' },
  bus_owner: { label: 'Bus operator', icon: Bus, home: '/mobility/bus/provider', apply: '/mobility/bus/provider/register' },
};

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
            const meta = PORTALS[c.type];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <Pressable
                key={`${c.type}:${c.providerId}`}
                style={[styles.card, shadow1]}
                onPress={() => router.push((c.approved ? meta.home : meta.apply ?? meta.home) as never)}
                accessibilityRole="button"
                accessibilityLabel={`${meta.label}: ${c.displayName}`}
              >
                <View style={styles.iconWrap}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{c.displayName || meta.label}</Text>
                  <Text style={styles.cardSub}>{meta.label} · {c.approved ? 'Approved' : c.status.toLowerCase()}</Text>
                </View>
                <ChevronRight size={18} color={Colors.onSurfaceVariant} />
              </Pressable>
            );
          })}

          <Text style={styles.section}>{caps.length > 0 ? 'Add another business' : 'Become a provider'}</Text>
          {(Object.keys(PORTALS) as ProviderType[])
            .filter((t) => !caps.some((c) => c.type === t) && PORTALS[t].apply)
            .map((t) => {
              const meta = PORTALS[t];
              const Icon = meta.icon;
              return (
                <Pressable key={t} style={[styles.card, shadow1]} onPress={() => router.push(meta.apply as never)} accessibilityRole="button" accessibilityLabel={`Apply as ${meta.label}`}>
                  <View style={styles.iconWrap}><Icon size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></View>
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
