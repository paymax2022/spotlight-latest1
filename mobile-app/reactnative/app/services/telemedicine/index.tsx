import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarClock, ChevronRight, Stethoscope } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1, shadow2 } from '@/constants/shadows';
import {
  getSpecialties, getDoctors, DEMO_SPECIALTIES, DEMO_DOCTORS,
} from '@/api/telemedicine.api';
import { TeleHeader, SpecialtyChip, DoctorCard } from '@/features/telemedicine/components';

export default function TelemedicineHome() {
  const { data: specialties = [] } = useQuery({
    queryKey: ['tele-specialties'],
    queryFn:  getSpecialties,
    placeholderData: DEMO_SPECIALTIES,
  });

  const { data: doctors = [] } = useQuery({
    queryKey: ['tele-doctors', 'featured'],
    queryFn:  () => getDoctors(),
    placeholderData: DEMO_DOCTORS,
  });

  const online = doctors.filter((d) => d.isOnline);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Telemedicine"
        right={
          <Pressable onPress={() => router.push('/services/telemedicine/appointments')} style={styles.calBtn}>
            <CalendarClock size={20} color={Colors.primary} strokeWidth={2} />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Hero */}
        <LinearGradient
          colors={[Colors.primary, Colors.primaryContainer]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[styles.hero, shadow2]}
        >
          <View style={styles.heroIcon}>
            <Stethoscope size={26} color={Colors.white} strokeWidth={2} />
          </View>
          <Text style={styles.heroEyebrow}>SEE A DOCTOR NOW</Text>
          <Text style={styles.heroTitle}>Quality care, anywhere</Text>
          <Text style={styles.heroSub}>Book a licensed doctor for a secure video, audio or chat consultation.</Text>
          <Pressable style={styles.heroBtn} onPress={() => router.push('/services/telemedicine/doctors')}>
            <Text style={styles.heroBtnText}>Book now</Text>
            <ChevronRight size={18} color={Colors.primary} strokeWidth={2.4} />
          </Pressable>
        </LinearGradient>

        {/* Specialties */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Specialties</Text>
          <Pressable onPress={() => router.push('/services/telemedicine/doctors')}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>
        <View style={styles.grid}>
          {specialties.slice(0, 6).map((s) => (
            <SpecialtyChip
              key={s.id}
              specialty={s}
              onPress={() => router.push(`/services/telemedicine/doctors?specialtyId=${s.id}`)}
            />
          ))}
        </View>

        {/* Online now */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Available now</Text>
          <View style={styles.onlineTag}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>{online.length} online</Text>
          </View>
        </View>
        <View style={{ gap: Spacing.sm }}>
          {online.map((d) => (
            <DoctorCard key={d.id} doctor={d} onPress={() => router.push(`/services/telemedicine/doctor/${d.id}`)} />
          ))}
        </View>

        {/* My appointments shortcut */}
        <Pressable style={[styles.apptShortcut, shadow1]} onPress={() => router.push('/services/telemedicine/appointments')}>
          <View style={styles.apptIcon}>
            <CalendarClock size={20} color={Colors.secondary} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.apptTitle}>My appointments</Text>
            <Text style={styles.apptSub}>View upcoming and past consultations</Text>
          </View>
          <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  calBtn:      { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  hero:        { borderRadius: Radius.xl, padding: Spacing.cardPadding, marginBottom: Spacing.lg, gap: Spacing.xs, overflow: 'hidden' },
  heroIcon:    { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  heroEyebrow: { ...Typography.labelSm, color: 'rgba(255,255,255,0.75)' },
  heroTitle:   { ...Typography.headlineMd, color: Colors.onPrimary },
  heroSub:     { ...Typography.bodySm, color: 'rgba(255,255,255,0.8)', marginBottom: Spacing.md },
  heroBtn:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: Spacing.lg, borderRadius: Radius.full, backgroundColor: Colors.white },
  heroBtnText: { ...Typography.labelLg, color: Colors.primary },
  sectionHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.lg, marginBottom: Spacing.md },
  sectionTitle:{ ...Typography.titleLg, color: Colors.onSurface },
  link:        { ...Typography.labelMd, color: Colors.secondary },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.sm },
  onlineTag:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot:   { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: '#16A34A' },
  onlineText:  { ...Typography.labelSm, color: '#16A34A' },
  apptShortcut:{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  apptIcon:    { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgBlue, alignItems: 'center', justifyContent: 'center' },
  apptTitle:   { ...Typography.labelLg, color: Colors.onSurface },
  apptSub:     { ...Typography.caption, color: Colors.onSurfaceVariant },
});
