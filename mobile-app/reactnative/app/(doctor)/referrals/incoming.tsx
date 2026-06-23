import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Inbox, MessagesSquare, Plus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { TeleHeader, DoctorAvatar } from '@/features/telemedicine/components';
import { StateView, StatusBadge, IncomingReferralRow } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { useIncomingReferrals, useOpinionRequests, useRequestOpinion, useSpecialists } from '@/features/doctor/hooks';
import { INCOMING_REFERRAL_STATUS_LABELS, OPINION_STATUS_LABELS, OPINION_TYPE_OPTIONS, REFERRAL_SPECIALTY_OPTIONS } from '@/features/doctor/constants';
import type { OpinionRequest, OpinionKind } from '@/types/doctor.batch4';

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));

// Section P (P10, P12, P13, P16) — incoming referral inbox + opinion history,
// with the specialist/second opinion request as a sheet.
export default function IncomingReferralsScreen() {
  const { opinions } = useLocalSearchParams<{ opinions?: string }>();
  const [tab, setTab] = useState<'incoming' | 'opinions'>(opinions === '1' ? 'opinions' : 'incoming');
  const [sheetOpen, setSheetOpen] = useState(false);

  const incoming = useIncomingReferrals();
  const opinionReqs = useOpinionRequests();
  const request = useRequestOpinion();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Incoming"
        right={
          <Pressable onPress={() => setSheetOpen(true)} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="Request opinion">
            <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'incoming' && styles.tabOn]} onPress={() => setTab('incoming')} accessibilityRole="button" accessibilityLabel="Incoming referrals">
          <Inbox size={16} color={tab === 'incoming' ? Colors.onPrimary : Colors.onSurface} strokeWidth={2} />
          <Text style={[styles.tabText, tab === 'incoming' && styles.tabTextOn]}>Referrals</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'opinions' && styles.tabOn]} onPress={() => setTab('opinions')} accessibilityRole="button" accessibilityLabel="Opinion requests">
          <MessagesSquare size={16} color={tab === 'opinions' ? Colors.onPrimary : Colors.onSurface} strokeWidth={2} />
          <Text style={[styles.tabText, tab === 'opinions' && styles.tabTextOn]}>Opinions</Text>
        </Pressable>
      </View>

      {tab === 'incoming' ? (
        incoming.isLoading && (incoming.data ?? []).length === 0 ? (
          <StateView variant="loading" label="Loading referrals" />
        ) : incoming.isError ? (
          <StateView variant="error" message="We could not load incoming referrals." onRetry={() => incoming.refetch()} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {(incoming.data ?? []).length === 0 ? (
              <StateView variant="empty" icon={Inbox} title="No incoming referrals" message="Referrals sent to you will appear here." />
            ) : (
              (incoming.data ?? []).map((r) => {
                const s = INCOMING_REFERRAL_STATUS_LABELS[r.status];
                return (
                  <IncomingReferralRow
                    key={r.id}
                    initials={r.patient.initials}
                    avatarColor={r.patient.avatarColor}
                    patientName={r.patient.name}
                    reference={r.ref}
                    fromDoctor={r.fromDoctor}
                    specialty={r.specialty}
                    urgent={r.urgency === 'urgent'}
                    statusLabel={s.label}
                    statusTone={toTone(s.tone)}
                    onPress={() => router.push(`/(doctor)/referrals/incoming/${r.id}`)}
                  />
                );
              })
            )}
          </ScrollView>
        )
      ) : (
        opinionReqs.isLoading && (opinionReqs.data ?? []).length === 0 ? (
          <StateView variant="loading" label="Loading opinions" />
        ) : opinionReqs.isError ? (
          <StateView variant="error" message="We could not load opinion requests." onRetry={() => opinionReqs.refetch()} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {(opinionReqs.data ?? []).length === 0 ? (
              <StateView variant="empty" icon={MessagesSquare} title="No opinion requests" message="Specialist and second-opinion requests will appear here." />
            ) : (
              (opinionReqs.data ?? []).map((o) => <OpinionRow key={o.id} opinion={o} />)
            )}
          </ScrollView>
        )
      )}

      <OpinionSheet
        visible={sheetOpen}
        pending={request.isPending}
        onClose={() => setSheetOpen(false)}
        onSubmit={async (input) => {
          try {
            const result = await request.mutateAsync(input);
            setSheetOpen(false);
            setTab('opinions');
            Alert.alert('Opinion requested', `${result.ref} has been sent.`);
          } catch {
            Alert.alert('Failed', 'Could not request an opinion. Please try again.');
          }
        }}
      />
    </SafeAreaView>
  );
}

function OpinionRow({ opinion }: { opinion: OpinionRequest }) {
  const s = OPINION_STATUS_LABELS[opinion.status];
  const kindLabel = OPINION_TYPE_OPTIONS.find((o) => o.value === opinion.kind)?.label ?? opinion.kind;
  return (
    <View style={styles.card}>
      <View style={[styles.specIcon, { backgroundColor: opinion.specialist.avatarColor }]}>
        <Text style={styles.specInit}>{opinion.specialist.initials}</Text>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{kindLabel}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{opinion.specialist.name} · {opinion.ref}</Text>
        <Text style={styles.cardMeta} numberOfLines={2}>{opinion.question}</Text>
        {!!opinion.response && <Text style={styles.response} numberOfLines={3}>{opinion.response}</Text>}
      </View>
      <StatusBadge label={s.label} tone={toTone(s.tone)} />
    </View>
  );
}

function OpinionSheet({ visible, pending, onClose, onSubmit }: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { patientId: string; specialistId: string; kind: OpinionKind; question: string; attachments: [] }) => void;
}) {
  const [specialty, setSpecialty] = useState('');
  const [specialistId, setSpecialistId] = useState('');
  const [kind, setKind] = useState<OpinionKind>('specialist');
  const [question, setQuestion] = useState('');

  const { data: specialists = [] } = useSpecialists(specialty || undefined);
  const filtered = useMemo(() => (specialty ? specialists.filter((s) => s.specialty === specialty) : specialists), [specialists, specialty]);
  const canSubmit = !!specialistId && question.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Request an opinion</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.kindRow}>
            {OPINION_TYPE_OPTIONS.map((o) => {
              const active = kind === o.value;
              return (
                <Pressable key={o.value} onPress={() => setKind(o.value)} style={[styles.kindChip, active && styles.kindChipOn]} accessibilityRole="button" accessibilityLabel={o.label}>
                  <Text style={[styles.kindText, active && styles.kindTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <SelectField label="Specialty" placeholder="All specialties" value={specialty} options={REFERRAL_SPECIALTY_OPTIONS} onChange={(v) => { setSpecialty(v); setSpecialistId(''); }} />
          <Text style={styles.fieldLabel}>Specialist</Text>
          <View style={styles.specList}>
            {filtered.map((s) => {
              const active = s.id === specialistId;
              return (
                <Pressable key={s.id} onPress={() => setSpecialistId(s.id)} style={[styles.specRow, active && styles.specRowOn]} accessibilityRole="button" accessibilityLabel={`Select ${s.name}`}>
                  <View style={[styles.specIcon, { backgroundColor: s.avatarColor }]}><Text style={styles.specInit}>{s.initials}</Text></View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{s.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>{s.specialty} · {s.hospital}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <TextInputField label="Clinical question" value={question} onChangeText={setQuestion} placeholder="What would you like the specialist to advise on?" multiline />
          <PrimaryButton label="Send request" onPress={() => onSubmit({ patientId: 'pat-3', specialistId, kind, question: question.trim(), attachments: [] })} loading={pending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  addBtn:      { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  tabs:        { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  tab:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, height: 44, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  tabOn:       { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText:     { ...Typography.labelMd, color: Colors.onSurface },
  tabTextOn:   { color: Colors.onPrimary },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  card:        { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh },
  cardBody:    { flex: 1, gap: 2 },
  cardTitle:   { ...Typography.titleMd, color: Colors.onSurface },
  cardMeta:    { ...Typography.caption, color: Colors.onSurfaceVariant },
  response:    { ...Typography.bodySm, color: Colors.teal, marginTop: 2 },
  specIcon:    { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  specInit:    { ...Typography.labelMd, color: Colors.white, fontWeight: '800' },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, maxHeight: '88%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  kindRow:     { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  kindChip:    { flex: 1, height: 44, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  kindChipOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  kindText:    { ...Typography.labelMd, color: Colors.onSurface },
  kindTextOn:  { color: Colors.onPrimary },
  fieldLabel:  { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.xs },
  specList:    { gap: Spacing.sm, marginBottom: Spacing.md },
  specRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  specRowOn:   { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  btn:         { marginTop: Spacing.sm },
});
