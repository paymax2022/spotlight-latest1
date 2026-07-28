import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Stethoscope,
  Syringe,
  CalendarClock,
  Plus,
  ChevronRight,
  ShieldCheck,
  Siren,
  Pill,
  ClipboardList,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PetCard from '@/features/health/vet/components/PetCard';
import VetStatusPill from '@/features/health/vet/components/VetStatusPill';
import { usePets, useAppointments } from '@/features/health/vet/hooks';
import { APPT_TYPE_META } from '@/features/health/vet/constants';
import { formatNaira } from '@/features/health/constants/health.constants';

const QUICK_ACTIONS = [
  { key: 'find', label: 'Find a vet', icon: Stethoscope, href: '/health/vet/find-vet', bg: Colors.iconBgPurple, color: Colors.primary },
  { key: 'vacc', label: 'Vaccines', icon: Syringe, href: '/health/vet/vaccination-scheduler', bg: Colors.iconBgGreen, color: Colors.teal },
  { key: 'appts', label: 'Appointments', icon: CalendarClock, href: '/health/vet/appointments', bg: Colors.iconBgBlue, color: Colors.secondary },
  { key: 'meds', label: 'Pet meds', icon: Pill, href: '/health/vet/pet-meds', bg: Colors.iconBgGold, color: Colors.onWarning },
] as const;

export default function VetHubScreen() {
  const { data: pets, isLoading, isError, refetch } = usePets();
  const { data: appointments } = useAppointments();

  const active = (appointments ?? []).find(
    (a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW',
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Vet Care"
        subtitle="Consult a vet for your pets"
        rightSlot={
          <Pressable onPress={() => router.push('/health/vet/appointments')} hitSlop={8} accessibilityLabel="My appointments">
            <ClipboardList size={22} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Quick actions */}
        <View style={styles.quickRow}>
          {QUICK_ACTIONS.map((a) => (
            <Pressable key={a.key} style={styles.quick} onPress={() => router.push(a.href)}>
              <View style={[styles.quickIcon, { backgroundColor: a.bg }]}>
                <a.icon size={20} color={a.color} strokeWidth={2} />
              </View>
              <Text style={styles.quickLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Emergency SOS */}
        <Pressable style={styles.sos} onPress={() => router.push('/health/vet/emergency-sos')} accessibilityRole="button">
          <View style={styles.sosIcon}>
            <Siren size={20} color={Colors.white} strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sosTitle}>Emergency vet</Text>
            <Text style={styles.sosSub}>Find the nearest in-person emergency care now</Text>
          </View>
          <ChevronRight size={18} color={Colors.error} strokeWidth={2} />
        </Pressable>

        {/* Active appointment */}
        {active ? (
          <Pressable
            style={[styles.activeCard, shadow1]}
            onPress={() =>
              active.type === 'home'
                ? router.push({ pathname: '/health/vet/home-visit-tracking', params: { id: active.id } })
                : router.push({ pathname: '/health/vet/appointments', params: { id: active.id } })
            }
          >
            <View style={styles.activeHead}>
              <Text style={styles.activeTitle}>Next appointment</Text>
              <VetStatusPill appt={active.status} />
            </View>
            <Text style={styles.activeName}>
              {APPT_TYPE_META[active.type].label} · {active.vetName}
            </Text>
            <Text style={styles.activeMeta}>
              For {active.petName} · {formatNaira(active.totalKobo)}
            </Text>
            <View style={styles.activeFoot}>
              <Text style={styles.activeLink}>
                {active.type === 'tele'
                  ? 'Go to lobby'
                  : active.type === 'home'
                  ? 'Track home visit'
                  : 'View details'}
              </Text>
              <ChevronRight size={16} color={Colors.secondary} strokeWidth={2} />
            </View>
          </Pressable>
        ) : null}

        {/* NDPA trust line */}
        <View style={styles.trust}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.trustText}>
            All vets are VCN-verified. Pet records are encrypted and shared only with your consent.
          </Text>
        </View>

        {/* My Pets */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>My pets</Text>
          <Pressable onPress={() => router.push('/health/vet/pet-add')} hitSlop={8} accessibilityLabel="Add a pet">
            <Plus size={20} color={Colors.secondary} strokeWidth={2.2} />
          </Pressable>
        </View>

        {isLoading ? (
          <StateView kind="loading" message="Loading your pets…" compact />
        ) : isError ? (
          <StateView kind="error" title="Couldn't load pets" message="Please try again." actionLabel="Retry" onAction={refetch} compact />
        ) : (pets ?? []).length === 0 ? (
          <StateView
            kind="empty"
            icon="PawPrint"
            title="No pets yet"
            message="Add a pet to book consults and keep its health records."
            actionLabel="Add a pet"
            onAction={() => router.push('/health/vet/pet-add')}
            compact
          />
        ) : (
          <View style={styles.list}>
            {(pets ?? []).map((p) => (
              <PetCard key={p.id} pet={p} onPress={() => router.push({ pathname: '/health/vet/pet/[id]', params: { id: p.id } })} />
            ))}
            <Pressable style={styles.addPet} onPress={() => router.push('/health/vet/pet-add')}>
              <Plus size={18} color={Colors.secondary} strokeWidth={2.2} />
              <Text style={styles.addPetText}>Add another pet</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md, paddingBottom: 40 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between' },
  quick: { alignItems: 'center', gap: 6, flex: 1 },
  quickIcon: { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...Typography.labelSm, color: Colors.onSurface, textAlign: 'center' },
  sos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.errorContainer,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  sosIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  sosTitle: { ...Typography.titleMd, fontSize: 16, color: Colors.error },
  sosSub: { ...Typography.bodySm, color: Colors.error },
  activeCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, gap: 4 },
  activeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeTitle: { ...Typography.labelMd, color: Colors.onSurfaceVariant },
  activeName: { ...Typography.titleMd, color: Colors.onSurface },
  activeMeta: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  activeFoot: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  activeLink: { ...Typography.labelMd, color: Colors.secondary },
  trust: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  trustText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  list: { gap: Spacing.sm },
  addPet: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    borderStyle: 'dashed',
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
  },
  addPetText: { ...Typography.labelMd, color: Colors.secondary },
});
