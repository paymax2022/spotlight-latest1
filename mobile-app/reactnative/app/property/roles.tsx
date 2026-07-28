import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Home, KeyRound, BedDouble, Check, ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import SectionHeader from '@/components/SectionHeader';
import PrimaryButton from '@/components/PrimaryButton';
import type { PropertyRole } from '@/features/property/types';

// M-ONB-02/04 — role picker. Explains entitlements per role; adding a role that
// raises the user's exposure (landlord/host) triggers step-up KYC (M-ONB-05),
// which routes to the existing identity-verification flow at /kyc.
interface RoleOption {
  role:         PropertyRole;
  label:        string;
  blurb:        string;
  entitlements: string[];
  icon:         React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  stepUpKyc:    boolean;
}

const ROLES: RoleOption[] = [
  {
    role: 'tenant', label: "I'm a tenant", icon: Home, stepUpKyc: false,
    blurb: 'Rent a home, pay dues, build a portable rent passport.',
    entitlements: ['Search & apply for rentals', 'Pay rent & dues', 'Earn a rent passport score', 'Request maintenance'],
  },
  {
    role: 'landlord', label: "I'm a landlord", icon: KeyRound, stepUpKyc: true,
    blurb: 'List & manage properties, collect rent, vet tenants.',
    entitlements: ['List units & manage leases', 'Collect rent into your wallet', 'Review tenant rent passports', 'Manage maintenance vendors'],
  },
  {
    role: 'host', label: "I'm a host", icon: BedDouble, stepUpKyc: true,
    blurb: 'Offer shortlets & short stays with auto-issued gate passes.',
    entitlements: ['List shortlets & rooms', 'Manage bookings & payouts', 'Auto-issue guest gate passes', 'Sync availability channels'],
  },
];

export default function PropertyRoles() {
  const [selected, setSelected] = useState<PropertyRole | null>(null);
  const chosen = ROLES.find((r) => r.role === selected);

  const onContinue = () => {
    if (!chosen) return;
    if (chosen.stepUpKyc) {
      // Step-up verification required before higher-exposure roles are granted.
      router.push('/kyc');
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Add a role" subtitle="Pick how you'll use Property" />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SectionHeader title="Choose a role" style={styles.section} />
        {ROLES.map((r) => {
          const Icon = r.icon;
          const isSel = selected === r.role;
          return (
            <Pressable
              key={r.role}
              onPress={() => setSelected(r.role)}
              accessibilityRole="button"
              accessibilityLabel={r.label}
              style={({ pressed }) => [styles.card, isSel && styles.cardSel, pressed && styles.pressed]}
            >
              <View style={styles.cardHead}>
                <View style={styles.icon}><Icon size={22} color={Colors.teal} strokeWidth={1.8} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{r.label}</Text>
                  <Text style={styles.cardBlurb}>{r.blurb}</Text>
                </View>
                {isSel ? <Check size={20} color={Colors.teal} strokeWidth={2.5} /> : null}
              </View>

              <View style={styles.entList}>
                {r.entitlements.map((e) => (
                  <View key={e} style={styles.entRow}>
                    <Check size={14} color={Colors.teal} strokeWidth={2.5} />
                    <Text style={styles.entText}>{e}</Text>
                  </View>
                ))}
              </View>

              {r.stepUpKyc ? (
                <View style={styles.kycNote}>
                  <ShieldCheck size={14} color={Colors.secondary} strokeWidth={2} />
                  <Text style={styles.kycNoteText}>Requires step-up identity verification (KYC).</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={chosen?.stepUpKyc ? 'Continue to verification' : 'Add role'}
          onPress={onContinue}
          disabled={!chosen}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  section: { paddingHorizontal: 0, marginTop: Spacing.sm },
  pressed: { opacity: 0.85 },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceContainerLow,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardSel: { borderColor: Colors.teal },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  icon: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...Typography.labelLg, color: Colors.onSurface },
  cardBlurb: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  entList: { gap: Spacing.xs },
  entRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  entText: { ...Typography.bodySm, color: Colors.onSurface },
  kycNote: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm },
  kycNoteText: { ...Typography.labelSm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
