import React from 'react';
import { View, Text, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Award, Languages, MessageSquareQuote, Briefcase } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import { getDoctor, formatKobo, DEMO_DOCTORS } from '@/api/telemedicine.api';
import { TeleHeader, DoctorAvatar, RatingStars } from '@/features/telemedicine/components';
import PrimaryButton from '@/components/PrimaryButton';

const DEMO_REVIEWS = [
  { id: 'r1', name: 'Chidi N.', rating: 5, comment: 'Very thorough and patient. Explained everything clearly.' },
  { id: 'r2', name: 'Aisha B.', rating: 5, comment: 'Quick to join the call and gave practical advice.' },
  { id: 'r3', name: 'Femi A.', rating: 4, comment: 'Helpful consultation, prescription came through fast.' },
];

export default function DoctorProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: doctor, isLoading } = useQuery({
    queryKey: ['tele-doctor', id],
    queryFn:  () => getDoctor(String(id)),
    placeholderData: DEMO_DOCTORS.find((d) => d.id === id),
  });

  if (isLoading && !doctor) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Doctor" />
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      </SafeAreaView>
    );
  }

  if (!doctor) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TeleHeader title="Doctor" />
        <Text style={styles.empty}>Doctor not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Doctor Profile" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.headCard, shadow1]}>
          <DoctorAvatar initials={doctor.initials} color={doctor.avatarColor} size={84} online={doctor.isOnline} />
          <Text style={styles.name}>{doctor.name}</Text>
          <Text style={styles.title}>{doctor.title}</Text>
          <Text style={styles.specialties}>{doctor.specialties.join(' • ')}</Text>
          <RatingStars rating={doctor.rating} reviewCount={doctor.reviewCount} size={18} />
        </View>

        <View style={styles.statsRow}>
          <Stat icon={<Briefcase size={18} color={Colors.primary} strokeWidth={2} />} value={`${doctor.yearsExperience} yrs`} label="Experience" />
          <Stat icon={<Award size={18} color={Colors.secondary} strokeWidth={2} />} value={doctor.rating.toFixed(1)} label="Rating" />
          <Stat icon={<Languages size={18} color={Colors.teal} strokeWidth={2} />} value={String(doctor.languages.length)} label="Languages" />
        </View>

        <Section title="About">
          <Text style={styles.bio}>{doctor.bio}</Text>
        </Section>

        <Section title="Languages">
          <View style={styles.tagWrap}>
            {doctor.languages.map((l) => (
              <View key={l} style={styles.tag}><Text style={styles.tagText}>{l}</Text></View>
            ))}
          </View>
        </Section>

        <Section title={`Reviews (${doctor.reviewCount})`}>
          <View style={{ gap: Spacing.md }}>
            {DEMO_REVIEWS.map((r) => (
              <View key={r.id} style={styles.review}>
                <View style={styles.reviewHead}>
                  <View style={styles.reviewIcon}>
                    <MessageSquareQuote size={14} color={Colors.primary} strokeWidth={2} />
                  </View>
                  <Text style={styles.reviewName}>{r.name}</Text>
                  <View style={{ flex: 1 }} />
                  <RatingStars rating={r.rating} size={13} />
                </View>
                <Text style={styles.reviewText}>{r.comment}</Text>
              </View>
            ))}
          </View>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.feeLabel}>Consultation fee</Text>
          <Text style={styles.fee}>{formatKobo(doctor.feeKobo)}</Text>
        </View>
        <PrimaryButton
          label="Book appointment"
          fullWidth={false}
          style={{ flex: 1, marginLeft: Spacing.md }}
          onPress={() => router.push(`/services/telemedicine/doctor/${doctor.id}/book`)}
        />
      </View>
    </SafeAreaView>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={[styles.stat, shadow1]}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: Spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={{ marginTop: Spacing.sm }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 140 },
  headCard:    { alignItems: 'center', gap: 4, padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  name:        { ...Typography.headlineMd, color: Colors.onSurface, marginTop: Spacing.sm },
  title:       { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  specialties: { ...Typography.labelMd, color: Colors.secondary, marginBottom: 4 },
  statsRow:    { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  stat:        { flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  statValue:   { ...Typography.titleMd, color: Colors.onSurface },
  statLabel:   { ...Typography.caption, color: Colors.onSurfaceVariant },
  sectionTitle:{ ...Typography.titleLg, color: Colors.onSurface },
  bio:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 24 },
  tagWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag:         { paddingHorizontal: Spacing.md, height: 34, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tagText:     { ...Typography.labelMd, color: Colors.onSurface },
  review:      { padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, gap: 6 },
  reviewHead:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reviewIcon:  { width: 28, height: 28, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  reviewName:  { ...Typography.labelMd, color: Colors.onSurface },
  reviewText:  { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 20 },
  footer:      { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  feeLabel:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  fee:         { ...Typography.titleLg, color: Colors.primary, fontWeight: '800' },
  empty:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginTop: Spacing.xl },
});
