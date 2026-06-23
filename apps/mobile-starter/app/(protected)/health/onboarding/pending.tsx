// @ts-nocheck
import React from 'react';
import {
  View, Text, StyleSheet, Pressable, SafeAreaView, ScrollView, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const C = {
  primary: '#059669',
  primaryDark: '#065f46',
  primaryContainer: '#d1fae5',
  secondary: '#0EA5E9',
  secondaryContainer: '#e0f2fe',
  tertiary: '#F59E0B',
  tertiaryContainer: '#fef3c7',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceVariant: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
};

const VERIFICATION_STEPS = [
  { label: 'Application Submitted', detail: 'Received June 17, 2026', done: true, active: false },
  { label: 'Document Review', detail: 'MDCN and credentials being verified', done: false, active: true },
  { label: 'Background Check', detail: 'Identity and licence validation', done: false, active: false },
  { label: 'Account Activation', detail: 'Profile goes live on Paymax Health', done: false, active: false },
];

const CHECKLIST = [
  { label: 'MDCN Licence Certificate', done: true },
  { label: 'Medical Degree Certificate', done: true },
  { label: 'Government-issued ID', done: true },
  { label: 'Specialist Certificate', done: false },
];

export default function AccountPendingVerification() {
  const router = useRouter();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Application Status</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Status hero */}
        <View style={s.statusHero}>
          <View style={s.statusIconRing}>
            <View style={s.statusIconInner}>
              <Ionicons name="time" size={36} color={C.tertiary} />
            </View>
          </View>
          <View style={s.statusBadge}>
            <View style={s.statusDot} />
            <Text style={s.statusBadgeText}>Under Review</Text>
          </View>
          <Text style={s.statusTitle}>Your Application is Being Reviewed</Text>
          <Text style={s.statusSub}>
            Our team is verifying your credentials. You'll receive an email notification once your account is activated.
          </Text>
          <View style={s.etaBadge}>
            <Ionicons name="calendar-outline" size={14} color={C.primary} />
            <Text style={s.etaText}>Expected: 2–3 business days</Text>
          </View>
        </View>

        {/* Verification timeline */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Verification Progress</Text>
          <View style={s.timelineCard}>
            {VERIFICATION_STEPS.map((step, i) => (
              <View key={i} style={s.timelineRow}>
                <View style={s.timelineLeft}>
                  <View style={[
                    s.timelineDot,
                    step.done && s.timelineDotDone,
                    step.active && s.timelineDotActive,
                  ]}>
                    {step.done ? (
                      <Ionicons name="checkmark" size={14} color="#fff" />
                    ) : step.active ? (
                      <View style={s.timelinePulse} />
                    ) : null}
                  </View>
                  {i < VERIFICATION_STEPS.length - 1 && (
                    <View style={[s.timelineConnector, step.done && s.timelineConnectorDone]} />
                  )}
                </View>
                <View style={s.timelineBody}>
                  <Text style={[s.timelineLabel, step.done && { color: C.primary }, step.active && { color: C.tertiary }]}>
                    {step.label}
                  </Text>
                  <Text style={s.timelineDetail}>{step.detail}</Text>
                </View>
                {step.done && (
                  <View style={s.doneChip}>
                    <Text style={s.doneChipText}>Done</Text>
                  </View>
                )}
                {step.active && (
                  <View style={s.activeChip}>
                    <Text style={s.activeChipText}>In Progress</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>

        {/* Documents checklist */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Document Checklist</Text>
          <View style={s.checklistCard}>
            {CHECKLIST.map((item, i) => (
              <View key={i} style={[s.checklistItem, i < CHECKLIST.length - 1 && s.checklistItemBorder]}>
                <Ionicons
                  name={item.done ? 'checkmark-circle' : 'alert-circle-outline'}
                  size={20}
                  color={item.done ? C.primary : C.tertiary}
                />
                <Text style={[s.checklistText, !item.done && { color: C.textMuted }]}>{item.label}</Text>
                <Text style={[s.checklistStatus, { color: item.done ? C.primary : C.tertiary }]}>
                  {item.done ? 'Received' : 'Optional'}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* What to do next */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>While You Wait</Text>
          <View style={s.tipsCard}>
            <TipRow icon="phone-portrait-outline" color={C.primary} text="Download the Paymax Health app to receive push notifications" />
            <TipRow icon="document-text-outline" color={C.secondary} text="Prepare your availability schedule and consultation rates" />
            <TipRow icon="people-outline" color="#8B5CF6" text="Explore the doctor dashboard to familiarise yourself with the tools" />
          </View>
        </View>

        {/* Contact support */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Need Help?</Text>
          <View style={s.contactCard}>
            <Pressable style={s.contactItem} onPress={() => Linking.openURL('mailto:doctors@paymaxhealth.ng')}>
              <View style={[s.contactIcon, { backgroundColor: C.secondaryContainer }]}>
                <Ionicons name="mail-outline" size={20} color={C.secondary} />
              </View>
              <View>
                <Text style={s.contactLabel}>Email Support</Text>
                <Text style={s.contactValue}>doctors@paymaxhealth.ng</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={{ marginLeft: 'auto' }} />
            </Pressable>
            <View style={s.contactDivider} />
            <Pressable style={s.contactItem} onPress={() => Linking.openURL('tel:08000729629')}>
              <View style={[s.contactIcon, { backgroundColor: C.primaryContainer }]}>
                <Ionicons name="call-outline" size={20} color={C.primary} />
              </View>
              <View>
                <Text style={s.contactLabel}>Helpline</Text>
                <Text style={s.contactValue}>0800 0PAYMAX</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={{ marginLeft: 'auto' }} />
            </Pressable>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function TipRow({ icon, color, text }: { icon: string; color: string; text: string }) {
  return (
    <View style={s.tipRow}>
      <View style={[s.tipIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={s.tipText}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  statusHero: { backgroundColor: C.surface, alignItems: 'center', padding: 28, borderBottomWidth: 1, borderBottomColor: C.border },
  statusIconRing: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.tertiaryContainer, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  statusIconInner: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.tertiaryContainer, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100, marginBottom: 14 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.tertiary },
  statusBadgeText: { fontSize: 13, color: '#92400e', fontWeight: '700' },
  statusTitle: { fontSize: 20, fontWeight: '800', color: C.text, textAlign: 'center', marginBottom: 10 },
  statusSub: { fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  etaBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primaryContainer, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100 },
  etaText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  section: { paddingHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 },
  timelineCard: { backgroundColor: C.surface, borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  timelineLeft: { width: 32, alignItems: 'center', marginRight: 12 },
  timelineDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.surfaceVariant, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  timelineDotDone: { backgroundColor: C.primary, borderColor: C.primary },
  timelineDotActive: { backgroundColor: C.tertiaryContainer, borderColor: C.tertiary },
  timelinePulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.tertiary },
  timelineConnector: { width: 2, height: 28, backgroundColor: C.border, marginTop: 2 },
  timelineConnectorDone: { backgroundColor: C.primary },
  timelineBody: { flex: 1, paddingTop: 4, paddingBottom: 16 },
  timelineLabel: { fontSize: 14, fontWeight: '700', color: C.text },
  timelineDetail: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  doneChip: { backgroundColor: C.primaryContainer, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, alignSelf: 'flex-start', marginTop: 4 },
  doneChipText: { fontSize: 10, color: C.primary, fontWeight: '700' },
  activeChip: { backgroundColor: C.tertiaryContainer, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100, alignSelf: 'flex-start', marginTop: 4 },
  activeChipText: { fontSize: 10, color: '#92400e', fontWeight: '700' },
  checklistCard: { backgroundColor: C.surface, borderRadius: 16, padding: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  checklistItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  checklistItemBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  checklistText: { flex: 1, fontSize: 14, fontWeight: '500', color: C.text },
  checklistStatus: { fontSize: 12, fontWeight: '700' },
  tipsCard: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tipIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, fontSize: 13, color: C.textMuted, lineHeight: 20 },
  contactCard: { backgroundColor: C.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  contactItem: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  contactDivider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
  contactIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontSize: 12, color: C.textMuted, fontWeight: '500' },
  contactValue: { fontSize: 14, color: C.text, fontWeight: '700', marginTop: 1 },
});
