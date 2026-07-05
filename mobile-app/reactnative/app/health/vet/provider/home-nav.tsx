import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, MapPin, Navigation, NotebookPen } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import VetMapView from '@/features/health/vet/components/VetMapView';
import { useProviderHomeNav } from '@/features/health/vet/hooks';

export default function ProviderHomeNavScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const { data: nav, isLoading, isError, refetch } = useProviderHomeNav(appointmentId ?? 'appt_010');

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

  const openMaps = () =>
    Linking.openURL(`https://maps.google.com/?q=${nav.destLat},${nav.destLng}`);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Home visit navigation" subtitle={`${nav.petName} · ${nav.ownerName}`} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <VetMapView
          pins={[
            { id: 'me', label: 'You', x: 0.25, y: 0.7, active: true },
            { id: 'dest', label: nav.ownerName, x: 0.7, y: 0.3 },
          ]}
          height={210}
          caption={`${nav.etaLabel} · ${nav.distanceLabel}`}
        />

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
