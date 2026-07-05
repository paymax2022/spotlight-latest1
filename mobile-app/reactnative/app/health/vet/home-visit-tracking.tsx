import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Phone, MapPin, Check, Car } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import VetMapView from '@/features/health/vet/components/VetMapView';
import VetStatusPill from '@/features/health/vet/components/VetStatusPill';
import { useHomeVisitTracking } from '@/features/health/vet/hooks';
import { HOME_VISIT_STAGES } from '@/features/health/vet/constants';

export default function HomeVisitTrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading, isError, refetch } = useHomeVisitTracking(id);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Home visit" />
        <StateView kind="loading" message="Locating your vet…" />
      </SafeAreaView>
    );
  }
  if (isError || !t) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Home visit" />
        <StateView kind="error" title="Couldn't load tracking" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const currentIdx = HOME_VISIT_STAGES.findIndex((s) => s.stage === t.stage);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Home visit" subtitle={t.vetName} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <VetMapView
          pins={[
            { id: 'vet', label: t.vetName, x: 0.3, y: 0.3, active: true },
            { id: 'home', label: 'Home', x: 0.7, y: 0.7 },
          ]}
          height={200}
          caption={t.etaLabel}
        />

        {/* ETA / vet card */}
        <View style={[styles.card, shadow1]}>
          <View style={styles.cardTop}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{t.vetName.replace(/^Dr\.?\s*/, '').charAt(0)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.vetName}</Text>
              <View style={styles.vehicle}>
                <Car size={13} color={Colors.onSurfaceVariant} strokeWidth={2} />
                <Text style={styles.vehicleText}>{t.vehicle}</Text>
              </View>
            </View>
            <VetStatusPill stage={t.stage} />
          </View>
          <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${t.vetPhone}`)}>
            <Phone size={16} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.callText}>Call vet</Text>
          </Pressable>
        </View>

        {/* Address */}
        <View style={[styles.addr, shadow1]}>
          <MapPin size={16} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.addrText}>{t.address}</Text>
        </View>

        {/* Stage timeline */}
        <Text style={styles.sectionTitle}>Visit progress</Text>
        <View style={[styles.card, shadow1]}>
          {HOME_VISIT_STAGES.map((s, i) => {
            const done = i < currentIdx;
            const active = i === currentIdx;
            return (
              <View key={s.stage} style={styles.stepRow}>
                <View style={[styles.dot, (done || active) && styles.dotOn]}>
                  {done ? <Check size={11} color={Colors.white} strokeWidth={3} /> : null}
                </View>
                <Text style={[styles.stepLabel, (done || active) && styles.stepLabelOn]}>{s.label}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleLg, color: Colors.primary },
  name: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vehicleText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: 10 },
  callText: { ...Typography.labelMd, color: Colors.secondary },
  addr: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  addrText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.outlineVariant },
  dotOn: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  stepLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  stepLabelOn: { color: Colors.onSurface, fontWeight: '600' as const },
});
