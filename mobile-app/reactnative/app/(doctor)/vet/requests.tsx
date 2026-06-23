import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Inbox, X, Stethoscope } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, PetRequestRow, SectionCard, InfoRow } from '@/features/doctor/components';
import { usePetOwnerRequests, useRespondToPetRequest } from '@/features/doctor/hooks';
import { PET_SPECIES_LABELS, VET_CONSULT_TYPE_LABELS } from '@/features/doctor/constants';
import type { PetOwnerRequest } from '@/types/doctor.batch5';

const DECLINE_REASONS = ['Outside my species scope', 'Fully booked', 'Needs in-person exam', 'Refer to emergency clinic', 'Other'];

export default function PetOwnerRequestsScreen() {
  const { data: requests = [], isLoading, isError, refetch, isPlaceholderData } = usePetOwnerRequests();
  const respond = useRespondToPetRequest();

  const [active, setActive] = useState<PetOwnerRequest | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const closeSheet = () => { setActive(null); setDeclineOpen(false); setDeclineReason(''); };

  const accept = async (req: PetOwnerRequest) => {
    try {
      await respond.mutateAsync({ requestId: req.id, accept: true });
      Alert.alert('Request accepted', `${req.petName}'s consult has been added to your queue.`, [
        { text: 'Open pet', onPress: () => { closeSheet(); router.push(`/(doctor)/vet/pet/${req.id}`); } },
        { text: 'Done', onPress: closeSheet },
      ]);
    } catch { Alert.alert('Failed', 'Could not accept the request. Please try again.'); }
  };

  const decline = async () => {
    if (!active) return;
    if (!declineReason) { Alert.alert('Select a reason', 'Choose why you are declining.'); return; }
    try {
      await respond.mutateAsync({ requestId: active.id, accept: false, declineReason });
      closeSheet();
      Alert.alert('Request declined', 'The pet owner has been notified.');
    } catch { Alert.alert('Failed', 'Please try again.'); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Pet Owner Requests" />

      {isLoading && isPlaceholderData ? (
        <StateView variant="loading" label="Loading requests" />
      ) : isError ? (
        <StateView variant="error" message="We could not load owner requests." onRetry={() => refetch()} />
      ) : requests.length === 0 ? (
        <StateView variant="empty" icon={Inbox} title="No pending requests" message="New pet consult requests will appear here." />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.list}>
            {requests.map((r) => (
              <PetRequestRow key={r.id} request={r} onPress={() => setActive(r)} />
            ))}
          </View>
        </ScrollView>
      )}

      {/* Request detail + respond sheet */}
      <Modal visible={!!active && !declineOpen} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.backdrop} onPress={closeSheet} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{active?.petName}</Text>
            <Pressable onPress={closeSheet} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          {active && (
            <ScrollView showsVerticalScrollIndicator={false}>
              <SectionCard title="Request details" style={styles.card}>
                <InfoRow label="Species" value={`${PET_SPECIES_LABELS[active.petSpecies]} - ${active.breed}`} />
                <InfoRow label="Owner" value={active.owner.name} />
                <InfoRow label="Preferred" value={VET_CONSULT_TYPE_LABELS[active.preferredType]} />
                <InfoRow label="Urgency" value={active.isUrgent ? 'Urgent' : 'Routine'} valueColor={active.isUrgent ? Colors.error : Colors.onSurface} />
                <InfoRow label="Reason" value={active.reason} />
              </SectionCard>

              <SectionCard title="Submitted symptoms" style={styles.card}>
                {active.symptoms.length === 0 ? (
                  <Text style={styles.muted}>None reported.</Text>
                ) : (
                  active.symptoms.map((s, i) => (
                    <View key={s} style={[styles.symptomRow, i > 0 && styles.rowBorder]}>
                      <Stethoscope size={16} color={Colors.primary} strokeWidth={2} />
                      <Text style={styles.symptomText}>{s}</Text>
                    </View>
                  ))
                )}
              </SectionCard>

              <PrimaryButton label="Accept request" onPress={() => accept(active)} loading={respond.isPending} style={styles.btn} />
              <PrimaryButton label="Decline" variant="secondary" onPress={() => setDeclineOpen(true)} disabled={respond.isPending} style={styles.btn} />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Decline reason sheet */}
      <Modal visible={declineOpen} transparent animationType="slide" onRequestClose={() => setDeclineOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setDeclineOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Decline request</Text>
            <Pressable onPress={() => setDeclineOpen(false)} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
          </View>
          <SelectField label="Reason" placeholder="Select a reason" value={declineReason} options={DECLINE_REASONS} onChange={setDeclineReason} searchable={false} />
          <PrimaryButton label="Submit decline" onPress={decline} loading={respond.isPending} style={styles.btn} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.xxl },
  list:        { gap: Spacing.sm },
  muted:       { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  card:        { marginBottom: Spacing.md },
  symptomRow:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  symptomText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  rowBorder:   { borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
  btn:         { marginTop: Spacing.sm },
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: 40, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.surfaceContainerHigh, alignSelf: 'center', marginBottom: Spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
});
