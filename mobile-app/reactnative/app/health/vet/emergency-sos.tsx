import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Siren, Phone, MapPin, Clock, TriangleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import VetMapView from '@/features/health/vet/components/VetMapView';
import { useEmergencyVets } from '@/features/health/vet/hooks';
import { VET_EMERGENCY_DISCLAIMER } from '@/features/health/vet/constants';

export default function EmergencySosScreen() {
  const { data: vets, isLoading, isError, refetch } = useEmergencyVets();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Emergency vet" subtitle="In-person care near you" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* HL-11 in-person disclaimer — prominent */}
        <View style={styles.disclaimer} accessibilityRole="alert">
          <View style={styles.disclaimerHead}>
            <TriangleAlert size={20} color={Colors.error} strokeWidth={2.2} />
            <Text style={styles.disclaimerTitle}>This is for emergencies</Text>
          </View>
          <Text style={styles.disclaimerText}>{VET_EMERGENCY_DISCLAIMER}</Text>
        </View>

        {isLoading ? (
          <StateView kind="loading" message="Finding emergency vets…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load options" actionLabel="Retry" onAction={refetch} compact />
        ) : (
          <>
            <VetMapView
              pins={(vets ?? []).map((v, i) => ({ id: v.id, label: v.name, x: 0.25 + (i % 3) * 0.3, y: 0.3 + Math.floor(i / 3) * 0.35, active: v.open24h }))}
              height={170}
              caption="Nearest emergency care"
            />

            <Text style={styles.sectionTitle}>Nearest options</Text>
            {(vets ?? []).map((v) => (
              <View key={v.id} style={[styles.card, shadow1]}>
                <View style={styles.cardHead}>
                  <View style={styles.sosIcon}>
                    <Siren size={18} color={Colors.error} strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{v.name}</Text>
                    <View style={styles.metaRow}>
                      <MapPin size={12} color={Colors.onSurfaceVariant} strokeWidth={2} />
                      <Text style={styles.meta} numberOfLines={1}>{v.address} · {v.distanceLabel}</Text>
                    </View>
                    {v.open24h ? (
                      <View style={styles.openChip}>
                        <Clock size={11} color={Colors.teal} strokeWidth={2} />
                        <Text style={styles.openText}>Open 24/7</Text>
                      </View>
                    ) : (
                      <Text style={styles.closedText}>After-hours — call ahead</Text>
                    )}
                  </View>
                </View>
                <Pressable style={styles.callBtn} onPress={() => Linking.openURL(`tel:${v.phone}`)} accessibilityLabel={`Call ${v.name}`}>
                  <Phone size={16} color={Colors.white} strokeWidth={2.2} />
                  <Text style={styles.callText}>Call now</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  disclaimer: { backgroundColor: Colors.errorContainer, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.error },
  disclaimerHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  disclaimerTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.error },
  disclaimerText: { ...Typography.bodySm, color: Colors.error, lineHeight: 19 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', gap: Spacing.sm },
  sosIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.errorContainer, alignItems: 'center', justifyContent: 'center' },
  name: { ...Typography.titleMd, fontSize: 16, color: Colors.onSurface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  openChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  openText: { ...Typography.caption, color: Colors.teal, fontWeight: '700' as const },
  closedText: { ...Typography.caption, color: Colors.onWarning, marginTop: 4 },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.error, borderRadius: Radius.md, paddingVertical: 12 },
  callText: { ...Typography.labelLg, color: Colors.white },
});
