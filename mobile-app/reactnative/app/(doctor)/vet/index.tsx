import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { PawPrint, Stethoscope, FlaskConical, Wallet, ChevronRight, ShoppingBag, AlertTriangle, ShieldCheck, RefreshCw, CalendarClock, Inbox, History, RotateCcw, Truck, ClipboardList } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow2 } from '@/constants/shadows';
import SectionHeader from '@/components/SectionHeader';
import { TeleHeader, RatingStars } from '@/features/telemedicine/components';
import { StatCard, SectionCard, StateView, ToggleRow } from '@/features/doctor/components';
import { useVetDashboard, useToggleVetMode } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS } from '@/features/doctor/constants';
import { formatKobo } from '@/api/doctor.phase3.api';

export default function VetDashboardScreen() {
  const { data: dashboard, isLoading, isError, refetch } = useVetDashboard();
  const toggle = useToggleVetMode();

  const onToggle = async (enabled: boolean) => {
    try {
      await toggle.mutateAsync({ enabled });
    } catch {
      Alert.alert('Failed', 'Could not update vet mode. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Veterinary Mode" />

      {isLoading && !dashboard ? (
        <StateView variant="loading" label="Loading vet dashboard" />
      ) : isError || !dashboard ? (
        <StateView variant="error" message="We could not load your vet dashboard." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Vet hero */}
          <LinearGradient colors={[Colors.primary, Colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, shadow2]}>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}>
                <PawPrint size={24} color={Colors.onPrimary} strokeWidth={2} />
              </View>
              <View style={styles.heroBody}>
                <Text style={styles.heroName} numberOfLines={1}>{dashboard.vet.name}</Text>
                <Text style={styles.heroClinic} numberOfLines={1}>{dashboard.vet.clinicName}</Text>
              </View>
            </View>
            <View style={styles.heroMeta}>
              <RatingStars rating={dashboard.vet.rating} reviewCount={dashboard.vet.reviewCount} />
              <Text style={styles.heroLicence}>Licence {dashboard.vet.licenceNumber}</Text>
            </View>
          </LinearGradient>

          {/* Vet mode toggle */}
          <View style={styles.toggleWrap}>
            <ToggleRow
              icon={Stethoscope}
              label="Vet mode active"
              description="Accept animal consults and use vet-specific tools."
              value={dashboard.vet.vetModeEnabled}
              onValueChange={onToggle}
              disabled={toggle.isPending}
            />
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <StatCard icon={Stethoscope} label="Pets seen today" value={String(dashboard.petsSeenToday)} iconColor={Colors.primary} bgColor={Colors.iconBgPurple} />
            <StatCard icon={FlaskConical} label="Pending labs" value={String(dashboard.pendingLabs)} iconColor={Colors.teal} bgColor={Colors.iconBgTeal} />
          </View>
          <View style={styles.statsRow}>
            <StatCard icon={Wallet} label="Earnings today" value={formatKobo(dashboard.earningsTodayKobo)} iconColor={Colors.secondary} bgColor={Colors.iconBgBlue} />
            <StatCard icon={PawPrint} label="Today's consults" value={String(dashboard.todaysConsults.length)} iconColor={Colors.primary} bgColor={Colors.iconBgPurple} />
          </View>

          {/* Batch 5 — vet consultation quick links */}
          <Pressable style={styles.storeLink} onPress={() => router.push('/(doctor)/vet/appointments')} accessibilityRole="button" accessibilityLabel="Vet appointment queue">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <CalendarClock size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Appointment queue</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/requests')} accessibilityRole="button" accessibilityLabel="Pet owner requests">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgBlue }]}>
              <Inbox size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Pet owner requests</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/lab-inbox')} accessibilityRole="button" accessibilityLabel="Pet lab result inbox">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <FlaskConical size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Lab result inbox</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/prescriptions')} accessibilityRole="button" accessibilityLabel="Pet prescription history">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <ClipboardList size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Pet prescriptions</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/refills')} accessibilityRole="button" accessibilityLabel="Pet refill requests">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgBlue }]}>
              <RotateCcw size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Refill requests</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/fulfilments')} accessibilityRole="button" accessibilityLabel="Pet store fulfilments">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <Truck size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Store fulfilments</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/history')} accessibilityRole="button" accessibilityLabel="Vet consultation history">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <History size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Consultation history</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          {/* Quick links */}
          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/profile/setup')} accessibilityRole="button" accessibilityLabel="Create or edit veterinary profile">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <Stethoscope size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Veterinary profile & verification</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/profile/verification')} accessibilityRole="button" accessibilityLabel="Verification status">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <ShieldCheck size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Verification status</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/profile/licence/renew')} accessibilityRole="button" accessibilityLabel="Renew veterinary licence">
            <View style={[styles.storeIcon, { backgroundColor: Colors.iconBgTeal }]}>
              <RefreshCw size={18} color={Colors.teal} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Renew veterinary licence</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          <Pressable style={[styles.storeLink, styles.linkGap]} onPress={() => router.push('/(doctor)/vet/pet-store')} accessibilityRole="button" accessibilityLabel="Open pet store recommendations">
            <View style={styles.storeIcon}>
              <ShoppingBag size={18} color={Colors.secondary} strokeWidth={2} />
            </View>
            <Text style={styles.storeLabel}>Pet store recommendations</Text>
            <ChevronRight size={18} color={Colors.onSurfaceVariant} strokeWidth={2} />
          </Pressable>

          {/* Today's consults */}
          <SectionHeader title="Today's pet consults" style={styles.sectionGap} />
          {dashboard.todaysConsults.length === 0 ? (
            <StateView variant="empty" icon={PawPrint} title="No pet consults today" message="New animal bookings will appear here." />
          ) : (
            <View style={styles.list}>
              {dashboard.todaysConsults.map((c) => (
                <Pressable
                  key={c.id}
                  style={styles.consultRow}
                  onPress={() => router.push(`/(doctor)/vet/pet/${c.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${c.petName} consult`}
                >
                  <View style={styles.consultIcon}>
                    <PawPrint size={18} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <View style={styles.consultBody}>
                    <View style={styles.consultTop}>
                      <Text style={styles.consultName} numberOfLines={1}>{c.petName}</Text>
                      {c.isUrgent && (
                        <View style={styles.urgent}>
                          <AlertTriangle size={11} color={Colors.error} strokeWidth={2.4} />
                          <Text style={styles.urgentText}>Urgent</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.consultMeta} numberOfLines={1}>{PET_SPECIES_LABELS[c.petSpecies]} - {c.breed} - {c.ownerName}</Text>
                    <Text style={styles.consultReason} numberOfLines={1}>{c.reason}</Text>
                  </View>
                  <View style={styles.consultRight}>
                    <Text style={styles.consultTime}>{c.slotTime}</Text>
                    <Text style={styles.consultFee}>{formatKobo(c.feeKobo)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  hero:         { borderRadius: Radius.xl, padding: Spacing.cardPadding, marginBottom: Spacing.md, gap: Spacing.md },
  heroTop:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  heroIcon:     { width: 48, height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  heroBody:     { flex: 1, gap: 2 },
  heroName:     { ...Typography.titleLg, color: Colors.onPrimary },
  heroClinic:   { ...Typography.bodySm, color: 'rgba(255,255,255,0.8)' },
  heroMeta:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  heroLicence:  { ...Typography.labelSm, color: 'rgba(255,255,255,0.8)' },
  toggleWrap:   { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.md, overflow: 'hidden' },
  statsRow:     { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.md },
  storeLink:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  storeIcon:    { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgBlue },
  storeLabel:   { ...Typography.labelMd, color: Colors.onSurface, flex: 1 },
  linkGap:      { marginTop: Spacing.sm },
  sectionGap:   { marginTop: Spacing.md, paddingHorizontal: 0 },
  list:         { gap: Spacing.sm },
  consultRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  consultIcon:  { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.iconBgPurple },
  consultBody:  { flex: 1, gap: 2 },
  consultTop:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  consultName:  { ...Typography.labelLg, color: Colors.onSurface },
  urgent:       { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20, paddingHorizontal: 6, borderRadius: Radius.full, backgroundColor: Colors.errorContainer },
  urgentText:   { ...Typography.caption, color: Colors.error, fontWeight: '700' },
  consultMeta:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  consultReason:{ ...Typography.bodySm, color: Colors.onSurfaceVariant },
  consultRight: { alignItems: 'flex-end', gap: 2 },
  consultTime:  { ...Typography.labelMd, color: Colors.onSurface },
  consultFee:   { ...Typography.labelSm, color: Colors.teal },
});
