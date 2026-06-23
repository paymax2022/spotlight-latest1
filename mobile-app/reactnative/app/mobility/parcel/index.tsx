import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Package, Bike, ChevronRight, MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import MobilityEdgeState from '@/features/mobility/components/MobilityEdgeState';
import { PARCEL_ENABLED } from '@/features/mobility/constants/modes.constants';

// Lagos addresses stand in for the live places search (shared maps adapter later).
const PICKUP = { address: '14 Admiralty Way, Lekki Phase 1', lat: 6.4459, lng: 3.473 };
const DROPOFF = { address: 'Ikeja City Mall, Alausa', lat: 6.6186, lng: 3.3585 };

export default function ParcelHomeScreen() {
  const [pickup, setPickup] = useState(PICKUP.address);
  const [dropoff, setDropoff] = useState(DROPOFF.address);

  if (!PARCEL_ENABLED) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Send a parcel" />
        <MobilityEdgeState kind="serviceUnavailable" />
      </SafeAreaView>
    );
  }

  const onContinue = () => {
    if (!pickup.trim() || !dropoff.trim()) return;
    router.push({
      pathname: '/mobility/parcel/describe',
      params: { pickup: pickup.trim(), dropoff: dropoff.trim() },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Send a parcel"
        rightSlot={
          <Pressable onPress={() => router.push('/mobility/parcel/courier/requests')} hitSlop={8} accessibilityLabel="Courier mode">
            <Bike size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.hero, shadow1]}>
          <View style={styles.heroIcon}><Package size={24} color={Colors.primary} strokeWidth={2.2} /></View>
          <Text style={styles.heroTitle}>Door-to-door delivery</Text>
          <Text style={styles.heroSub}>Send documents and packages across the city with PIN-verified pickup and drop-off.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Pickup</Text>
          <TextInputField
            value={pickup}
            onChangeText={setPickup}
            placeholder="Where should the courier collect?"
            leftIcon={<MapPin size={18} color={Colors.secondary} strokeWidth={2} />}
          />
          <Text style={styles.label}>Drop-off</Text>
          <TextInputField
            value={dropoff}
            onChangeText={setDropoff}
            placeholder="Where is it going?"
            leftIcon={<MapPin size={18} color={Colors.primary} strokeWidth={2} />}
          />
        </View>

        <Pressable style={styles.linkRow} onPress={() => router.push('/mobility/parcel/courier/requests')}>
          <Bike size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          <Text style={styles.linkText}>I'm a courier — see delivery requests</Text>
          <ChevronRight size={18} color={Colors.onSurfaceVariant} />
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={onContinue} disabled={!pickup.trim() || !dropoff.trim()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.md },
  hero: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.outlineVariant, gap: 6 },
  heroIcon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  heroTitle: { ...Typography.titleMd, color: Colors.onSurface },
  heroSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md },
  linkText: { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
