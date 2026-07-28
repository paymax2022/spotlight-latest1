import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Siren,
  PhoneCall,
  MapPin,
  MessageCircle,
  Stethoscope,
  Upload,
  TriangleAlert,
  ChevronRight,
  X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import SymptomDisclaimerBar from '@/features/health/components/SymptomDisclaimerBar';
import type { SymptomEscalationAction } from '@/features/health/api/symptomSearch.api';
import { useSymptomSearch } from '@/features/health/api/symptomSearch.hooks';
import { useSymptomSearchStore } from '@/features/health/pharmacy/symptomSearchStore';

// Default routes per action type — server `target` (when present) wins.
// All of these are EXISTING flows: no new consult/upload surface is built here.
const ACTION_ROUTES: Record<SymptomEscalationAction['type'], string> = {
  PHARMACIST_CHAT: '/health/pharmacy/pharmacist-consult', // free chat (existing)
  TELEHEALTH_CONSULT: '/services/telemedicine', // existing booking + pre-consult intake flow
  NEAREST_FACILITY: '/health/triage/emergency', // existing MapService-backed nearest-ER screen
  EMERGENCY_GUIDANCE: '/health/triage/emergency',
  UPLOAD_RX: '/health/pharmacy/upload-rx', // existing prescription upload (Journey D)
};

function runAction(action: SymptomEscalationAction) {
  const target = action.target && action.target.startsWith('/') ? action.target : ACTION_ROUTES[action.type];
  if (target) router.push(target as never);
}

/**
 * Escalation / triage card (PRD §8, Journey C — "the flow that keeps the
 * license"). Rendered full-screen for T3/T4: says WHAT was flagged and WHY,
 * then routes to care. T4 (EMERGENCY) shows emergency guidance + nearest
 * facility and NO commerce UI. T3 (CONSULT) routes to pharmacist chat /
 * telehealth and captures POM demand via prescription upload (Journey D).
 */
export default function SymptomEscalationScreen() {
  const { terms, refiners } = useSymptomSearchStore();
  const { data, isLoading, isError, refetch } = useSymptomSearch(terms, refiners);

  useEffect(() => {
    if (terms.length === 0) router.replace('/health/pharmacy/symptom');
  }, [terms.length]);

  const card = data?.escalation_card;

  // ── T4 — EMERGENCY: high-contrast, distraction-free, no commerce ────────────
  if (card?.severity === 'EMERGENCY') {
    return (
      <SafeAreaView style={styles.safeEmergency} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close" style={styles.closeBtn}>
            <X size={22} color={Colors.onPrimary} strokeWidth={2.5} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.emergencyContent} showsVerticalScrollIndicator={false}>
          <View style={styles.emergencyIcon}>
            <Siren size={40} color={Colors.onPrimary} strokeWidth={2.5} />
          </View>
          <Text style={styles.emergencyTitle}>Please get urgent care now</Text>

          <View style={styles.flaggedCard}>
            <Text style={styles.flaggedTitle}>Why we stopped the search</Text>
            {card.flagged.map((reason, i) => (
              <Text key={i} style={styles.flaggedReason}>• {reason}</Text>
            ))}
          </View>

          {/* One-tap national emergency lines */}
          <Pressable
            onPress={() => Linking.openURL('tel:112').catch(() => {})}
            style={({ pressed }) => [styles.callBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Call 112 emergency line"
          >
            <PhoneCall size={22} color={Colors.error} strokeWidth={2.5} />
            <Text style={styles.callLabel}>Call 112 — emergency</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL('tel:199').catch(() => {})}
            style={({ pressed }) => [styles.callBtnAlt, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Call 199 emergency line"
          >
            <PhoneCall size={18} color={Colors.onPrimary} strokeWidth={2.5} />
            <Text style={styles.callLabelAlt}>Call 199</Text>
          </Pressable>

          {/* Nearest facility via the existing MapService-backed screen */}
          <Pressable
            onPress={() => runAction({ type: 'NEAREST_FACILITY', label: 'Nearest facility' })}
            style={({ pressed }) => [styles.facilityCard, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <MapPin size={18} color={Colors.error} strokeWidth={2.5} />
            <Text style={styles.facilityText}>Find the nearest emergency facility</Text>
            <ChevronRight size={18} color={Colors.error} strokeWidth={2} />
          </Pressable>

          <Text style={styles.emergencyFootnote}>
            This screen shows no products on purpose. If you cannot reach emergency lines, go to the nearest
            hospital or PCN-licensed pharmacy immediately.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── T3 — CONSULT (and loading / error shells) ────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Speak to a professional" subtitle="No products for this — here's why" />

      {isLoading || terms.length === 0 ? (
        <StateView kind="loading" message="One moment…" />
      ) : isError || !card ? (
        <View style={styles.flex}>
          <StateView
            kind="error"
            title="Couldn't load your result"
            message="Try again — or go straight to a free pharmacist chat."
            actionLabel="Retry"
            onAction={() => refetch()}
          />
          <View style={styles.footer}>
            <PrimaryButton
              label="Start free pharmacist chat"
              onPress={() => runAction({ type: 'PHARMACIST_CHAT', label: 'Pharmacist chat' })}
            />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.triageCard}>
            <View style={styles.triageHead}>
              <View style={styles.triageIcon}>
                <TriangleAlert size={20} color={Colors.onWarning} strokeWidth={2} />
              </View>
              <Text style={styles.triageTitle}>What we noticed</Text>
            </View>
            {card.flagged.map((reason, i) => (
              <Text key={i} style={styles.triageReason}>• {reason}</Text>
            ))}
            <Text style={styles.triageBody}>
              For symptoms like this, the right next step is a professional — not a product list. It keeps you
              safe, and any prescription that follows unlocks your order automatically.
            </Text>
          </View>

          {/* Actions from the card (server target wins; sensible defaults otherwise) */}
          {card.actions.map((action) => {
            const icon =
              action.type === 'PHARMACIST_CHAT' ? MessageCircle :
              action.type === 'TELEHEALTH_CONSULT' ? Stethoscope :
              action.type === 'UPLOAD_RX' ? Upload : ChevronRight;
            const Icon = icon;
            return (
              <Pressable
                key={action.type + action.label}
                onPress={() => runAction(action)}
                style={({ pressed }) => [styles.actionCard, shadow1, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={action.label}
              >
                <View style={[styles.actionIcon, { backgroundColor: Colors.iconBgBlue }]}>
                  <Icon size={18} color={Colors.secondary} strokeWidth={2} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.actionTitle}>{action.label}</Text>
                  {action.type === 'PHARMACIST_CHAT' ? (
                    <Text style={styles.actionSub}>Free · usually replies in minutes</Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
              </Pressable>
            );
          })}

          {/* Journey D — POM demand capture via the existing upload flow */}
          <Pressable
            onPress={() => runAction({ type: 'UPLOAD_RX', label: 'Upload prescription' })}
            style={({ pressed }) => [styles.actionCard, shadow1, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <View style={[styles.actionIcon, { backgroundColor: Colors.iconBgPurple }]}>
              <Upload size={18} color={Colors.primary} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.actionTitle}>Already have a prescription?</Text>
              <Text style={styles.actionSub}>Upload it — a pharmacist verifies before dispensing.</Text>
            </View>
            <ChevronRight size={18} color={Colors.outline} strokeWidth={2} />
          </Pressable>
        </ScrollView>
      )}

      <SymptomDisclaimerBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md },
  pressed: { opacity: 0.9 },

  // T3 consult
  triageCard: {
    backgroundColor: Colors.iconBgGold,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  triageHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  triageIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  triageTitle: { ...Typography.titleMd, color: Colors.onWarning },
  triageReason: { ...Typography.bodySm, color: Colors.onWarning, lineHeight: 19 },
  triageBody: { ...Typography.bodySm, color: Colors.onWarning, lineHeight: 19 },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  actionIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  actionTitle: { ...Typography.labelLg, color: Colors.onSurface },
  actionSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },

  // T4 emergency
  safeEmergency: { flex: 1, backgroundColor: Colors.error },
  topBar: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, alignItems: 'flex-end' },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  emergencyContent: { padding: Spacing.containerMargin, paddingBottom: 32, gap: Spacing.md, alignItems: 'center' },
  emergencyIcon: {
    width: 80,
    height: 80,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  emergencyTitle: { ...Typography.headlineLg, color: Colors.onPrimary, textAlign: 'center' },
  flaggedCard: { width: '100%', backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: 6 },
  flaggedTitle: { ...Typography.labelLg, color: Colors.onSurface },
  flaggedReason: { ...Typography.bodySm, color: Colors.onSurfaceVariant, lineHeight: 19 },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    width: '100%',
    minHeight: 60,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
  },
  callLabel: { ...Typography.titleLg, color: Colors.error },
  callBtnAlt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    width: '100%',
    minHeight: 48,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  callLabelAlt: { ...Typography.labelLg, color: Colors.onPrimary },
  facilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  facilityText: { ...Typography.labelLg, color: Colors.error, flex: 1 },
  emergencyFootnote: { ...Typography.caption, color: Colors.onPrimary, textAlign: 'center', opacity: 0.9, marginTop: Spacing.sm },
});
