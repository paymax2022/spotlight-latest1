import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Stethoscope, Pill, FlaskConical, PawPrint, ShieldPlus, Hospital,
  ChevronRight, ShieldCheck, Wallet, Users,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';

interface Track {
  key:         string;
  label:       string;
  description: string;
  icon:        LucideIcon;
  tint:        string;
  bg:          string;
  /** Absent means no onboarding flow is built for this type yet. */
  route?:      string;
}

// Routes point at the onboarding each track ALREADY has. `/(doctor)/onboarding/intro`
// rather than `/(doctor)/onboarding`, because that group's index maps to the URL
// `/onboarding`, which the consumer onboarding carousel (app/onboarding.tsx) also
// claims — the deeper path is unambiguous.
//
// HMO and clinic carry no route on purpose: nothing implements their onboarding
// yet, and a card that navigates nowhere is worse than one that says so.
const TRACKS: Track[] = [
  {
    key: 'doctor',
    label: 'Doctor or specialist',
    description: 'Consult by video, audio or chat, set your fees and manage your schedule.',
    icon: Stethoscope, tint: Colors.primary, bg: Colors.iconBgPurple,
    route: '/(doctor)/onboarding/intro',
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy',
    description: 'Dispense prescriptions, sell OTC products and track stock.',
    icon: Pill, tint: Colors.teal, bg: Colors.iconBgTeal,
    route: '/health/pharmacy/provider/onboarding',
  },
  {
    key: 'lab',
    label: 'Diagnostic lab',
    description: 'Publish a test catalogue, accession samples and release results.',
    icon: FlaskConical, tint: Colors.secondary, bg: Colors.iconBgBlue,
    route: '/health/lab/provider/onboarding',
  },
  {
    key: 'vet',
    label: 'Veterinarian',
    description: 'Treat pets by teleconsult or in clinic, and e-prescribe.',
    icon: PawPrint, tint: Colors.gold, bg: Colors.iconBgGold,
    route: '/health/vet/provider/onboarding',
  },
  {
    key: 'hmo',
    label: 'HMO',
    description: 'Offer health plans and handle pre-authorisation requests.',
    icon: ShieldPlus, tint: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow,
  },
  {
    key: 'clinic',
    label: 'Clinic or hospital',
    description: 'List departments, facilities and practising staff.',
    icon: Hospital, tint: Colors.onSurfaceVariant, bg: Colors.surfaceContainerLow,
  },
];

const BENEFITS = [
  { icon: Users,       label: 'Reach patients already on Paymax' },
  { icon: Wallet,      label: 'Get paid into your Paymax wallet' },
  { icon: ShieldCheck, label: 'Verified badge once your licence checks out' },
];

export default function HealthProviderOnboarding() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="List your practice"
        subtitle="Join Paymax as a healthcare provider"
        backFallback="/services/telemedicine"
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.lead}>
          Choose what you do. We will verify your licence, then set up the right profile and
          service listing for your practice.
        </Text>

        <View style={[styles.benefits, shadow1]}>
          {BENEFITS.map(({ icon: Icon, label }) => (
            <View key={label} style={styles.benefitRow}>
              <Icon size={16} color={Colors.primary} strokeWidth={2} />
              <Text style={styles.benefitText}>{label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Provider type</Text>

        <View style={{ gap: Spacing.sm }}>
          {TRACKS.map((t) => {
            const open = !!t.route;
            const Icon = t.icon;
            return (
              <Pressable
                key={t.key}
                disabled={!open}
                onPress={() => router.push(t.route as never)}
                accessibilityRole="button"
                accessibilityState={{ disabled: !open }}
                accessibilityLabel={open ? t.label : `${t.label}, coming soon`}
                style={({ pressed }) => [
                  styles.card,
                  shadow1,
                  !open && styles.cardMuted,
                  pressed && open && styles.cardPressed,
                ]}
              >
                <View style={[styles.iconBox, { backgroundColor: t.bg }]}>
                  <Icon size={22} color={t.tint} strokeWidth={2} />
                </View>

                <View style={styles.body}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>{t.label}</Text>
                    {!open && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Coming soon</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.description}>{t.description}</Text>
                </View>

                {open && <ChevronRight size={20} color={Colors.onSurfaceVariant} strokeWidth={2} />}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          Already applied? Your verification status appears in your provider dashboard once your
          application has been submitted.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.background },
  content:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 120 : 96 },
  lead:         { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.lg },
  benefits:     { gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, marginBottom: Spacing.lg },
  benefitRow:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  benefitText:  { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  sectionTitle: { ...Typography.titleLg, color: Colors.onSurface, marginBottom: Spacing.md },
  card:         { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  cardMuted:    { backgroundColor: Colors.surfaceContainerLow, borderColor: Colors.outlineVariant },
  cardPressed:  { backgroundColor: Colors.surfaceContainerLow },
  iconBox:      { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  body:         { flex: 1, gap: 2 },
  labelRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label:        { ...Typography.labelLg, color: Colors.onSurface, flexShrink: 1 },
  badge:        { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh },
  badgeText:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  description:  { ...Typography.caption, color: Colors.onSurfaceVariant },
  footnote:     { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.lg, textAlign: 'center' },
});
