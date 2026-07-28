import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { NotebookPen, Video, ScrollText, FlaskConical, Share2, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PetAvatar from '@/features/health/vet/components/PetAvatar';
import VaccinationRow from '@/features/health/vet/components/VaccinationRow';
import PetRecordRow from '@/features/health/vet/components/PetRecordRow';
import { usePetChart } from '@/features/health/vet/hooks';
import { SPECIES_META } from '@/features/health/vet/constants';

export default function PetChartScreen() {
  const { petId, appointmentId } = useLocalSearchParams<{ petId: string; appointmentId?: string }>();
  const { data: chart, isLoading, isError, refetch } = usePetChart(petId);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pet chart" />
        <StateView kind="loading" message="Loading chart…" />
      </SafeAreaView>
    );
  }
  if (isError || !chart) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Pet chart" />
        <StateView kind="error" title="Couldn't load chart" actionLabel="Retry" onAction={refetch} />
      </SafeAreaView>
    );
  }

  const { pet } = chart;
  const meta = SPECIES_META[pet.species];
  const appt = appointmentId ?? 'appt';

  const ACTIONS = [
    { key: 'consult', label: 'Start consult', icon: Video, href: { pathname: '/health/vet/provider/teleconsult', params: { id: 'vcns_001', appointmentId: appt } } },
    { key: 'soap', label: 'SOAP notes', icon: NotebookPen, href: { pathname: '/health/vet/provider/soap-notes', params: { appointmentId: appt, petId: pet.id } } },
    { key: 'rx', label: 'Prescribe', icon: ScrollText, href: { pathname: '/health/vet/provider/eprescribe', params: { appointmentId: appt, petId: pet.id } } },
    { key: 'lab', label: 'Order lab', icon: FlaskConical, href: { pathname: '/health/vet/provider/order-lab', params: { appointmentId: appt, petId: pet.id } } },
    { key: 'ref', label: 'Referral', icon: Share2, href: { pathname: '/health/vet/provider/referral', params: { appointmentId: appt, petId: pet.id } } },
  ] as const;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Pet chart" subtitle={`${pet.name} · ${chart.ownerName}`} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.headerCard, shadow1]}>
          <PetAvatar species={pet.species} color={pet.avatarColor} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{pet.name}</Text>
            <Text style={styles.sub}>{meta.label} · {pet.breed} · {pet.ageLabel}{pet.weightKg ? ` · ${pet.weightKg} kg` : ''}</Text>
            <Text style={styles.owner}>Owner: {chart.ownerName}</Text>
          </View>
        </View>

        {/* Clinician actions */}
        <View style={styles.actionGrid}>
          {ACTIONS.map((a) => (
            <Pressable key={a.key} style={[styles.action, shadow1]} onPress={() => router.push(a.href as never)}>
              <a.icon size={20} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Weight trend */}
        <View style={styles.sectionRow}>
          <TrendingUp size={18} color={Colors.secondary} strokeWidth={2} />
          <Text style={styles.sectionTitle}>Weight trend</Text>
        </View>
        <View style={[styles.weightCard, shadow1]}>
          {chart.weightSeries.map((w, i) => {
            const max = Math.max(...chart.weightSeries.map((x) => x.kg));
            return (
              <View key={i} style={styles.weightBarCol}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${(w.kg / max) * 100}%` }]} />
                </View>
                <Text style={styles.barLabel}>{w.kg}</Text>
              </View>
            );
          })}
        </View>

        {/* Vaccinations */}
        <Text style={styles.sectionTitle}>Vaccinations</Text>
        <View style={[styles.card, shadow1]}>
          {chart.vaccinations.length === 0 ? (
            <Text style={styles.empty}>None recorded.</Text>
          ) : (
            chart.vaccinations.map((v) => <VaccinationRow key={v.id} entry={v} />)
          )}
        </View>

        {/* History */}
        <Text style={styles.sectionTitle}>Clinical history</Text>
        <View style={[styles.card, shadow1]}>
          {chart.records.length === 0 ? (
            <Text style={styles.empty}>No records.</Text>
          ) : (
            chart.records.map((r) => <PetRecordRow key={r.id} record={r} locked={false} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  headerCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  sub: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  owner: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginTop: 2 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: { width: '31%', aspectRatio: 1, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.xs },
  weightCard: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', height: 140, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  weightBarCol: { alignItems: 'center', gap: 4, flex: 1, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: 28, flex: 1, backgroundColor: Colors.surfaceContainerHigh, borderRadius: Radius.sm, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: Colors.secondary, borderRadius: Radius.sm },
  barLabel: { ...Typography.caption, color: Colors.onSurfaceVariant },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md },
  empty: { ...Typography.bodySm, color: Colors.onSurfaceVariant, paddingVertical: Spacing.sm },
});
