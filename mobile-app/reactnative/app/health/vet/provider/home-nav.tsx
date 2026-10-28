import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, MapPin, Navigation, NotebookPen } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import VetMapView from '@/features/health/vet/components/VetMapView';
import { useProviderHomeNav } from '@/features/health/vet/hooks';
import MissingContext from '@/features/health/vet/components/MissingContext';
import { projectPins } from '@/features/health/vet/mapPins';

export default function ProviderHomeNavScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const { data: nav, isLoading, isError, refetch } = useProviderHomeNav(appointmentId ?? '');

  if (!appointmentId) return <MissingContext title="Home visit" fallback="/health/vet/provider/requests" />;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Home visit" />
        <StateView kind="loading" message="Loading route…" />
      </SafeAreaView>
    );
  }
  if (isError || !nav) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Home visit" />
        <StateView kind="error" title="Couldn't load route" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  // Older bookings (and owners who typed an address without picking a result) have
  // no coordinates: fall back to an address search and skip the map pin.
  const hasDest = !(nav.destLat === 0 && nav.destLng === 0);
  const openMaps = () =>
    Linking.openURL(
      hasDest
        ? `https://maps.google.com/?q=${nav.destLat},${nav.destLng}`
        : `https://maps.google.com/?q=${encodeURIComponent(nav.address)}`,
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Home visit navigation" subtitle={`${nav.petName} · ${nav.ownerName}`} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {hasDest ? (
          <VetMapView
            pins={projectPins([
              { id: 'me', label: 'You', lat: nav.vetLat, lng: nav.vetLng, active: true },
              { id: 'dest', label: nav.ownerName, lat: nav.destLat, lng: nav.destLng },
            ])}
            height={210}
            caption={`${nav.etaLabel} · ${nav.distanceLabel}`}
          />
        ) : null}

        <View style={[styles.card, shadow1]}>
          <MapPin size={18} color={Colors.primary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Destination</Text>
            <Text style={styles.value}>{nav.address}</Text>
          </View>
        </View>

        <View style={styles.btnRow}>
          <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${nav.phone}`)}>
            <Phone size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.callText}>Call owner</Text>
          </Pressable>
          <Pressable style={styles.navBtn} onPress={openMaps}>
            <Navigation size={16} color={Colors.white} strokeWidth={2} />
            <Text style={styles.navText}>Navigate</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="Arrived — start consult"
          onPress={() => router.push({ pathname: '/health/vet/provider/soap-notes', params: { appointmentId: nav.appointmentId, petId: 'pet_bella' } })}
        />
        <Pressable style={styles.notesLink} onPress={() => router.push({ pathname: '/health/vet/provider/pet-chart', params: { appointmentId: nav.appointmentId, petId: 'pet_bella' } })}>
          <NotebookPen size={15} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.notesLinkText}>Open pet chart</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  label: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  value: { ...Typography.bodyMd, color: Colors.onSurface, marginTop: 1 },
  btnRow: { flexDirection: 'row', gap: Spacing.sm },
  callBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: 12 },
  callText: { ...Typography.labelMd, color: Colors.secondary },
  navBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.secondary, borderRadius: Radius.md, paddingVertical: 12 },
  navText: { ...Typography.labelMd, color: Colors.white },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background, gap: Spacing.sm },
  notesLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  notesLinkText: { ...Typography.labelMd, color: Colors.secondary },
});
