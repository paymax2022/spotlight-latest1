import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Platform, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { FileCheck, Plus, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import TextInputField from '@/components/TextInputField';
import { formatKobo } from '@/api/doctor.batch4.api';
import { TeleHeader } from '@/features/telemedicine/components';
import { StateView, PreAuthRow } from '@/features/doctor/components';
import type { StatusTone } from '@/features/doctor/components';
import { usePreAuthRequests, useRequestPreAuth } from '@/features/doctor/hooks';
import { PREAUTH_STATUS_LABELS, PREAUTH_SERVICE_OPTIONS, HMO_PROVIDER_OPTIONS } from '@/features/doctor/constants';

const toTone = (tone: string): StatusTone => (tone === 'muted' ? 'neutral' : (tone as StatusTone));

// Section O (O6, O7–O10 via detail) — NEW screen: pre-authorisation request list
// + a "new request" sheet. REUSES the doctor list-card pattern via PreAuthRow.
export default function PreAuthListScreen() {
  const { data: requests = [], isLoading, isError, refetch } = usePreAuthRequests();
  const request = useRequestPreAuth();
  const [open, setOpen] = useState(false);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader
        title="Pre-authorisation"
        right={
          <Pressable onPress={() => setOpen(true)} style={styles.addBtn} accessibilityRole="button" accessibilityLabel="New pre-auth request">
            <Plus size={20} color={Colors.primary} strokeWidth={2.2} />
          </Pressable>
        }
      />

      {isLoading && requests.length === 0 ? (
        <StateView variant="loading" label="Loading requests" />
      ) : isError ? (
        <StateView variant="error" message="We could not load pre-authorisations." onRetry={() => refetch()} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {requests.length === 0 ? (
            <StateView variant="empty" icon={FileCheck} title="No requests yet" message="Pre-authorisation requests you raise will appear here." />
          ) : (
            requests.map((r) => {
              const s = PREAUTH_STATUS_LABELS[r.status];
              return (
                <PreAuthRow
                  key={r.id}
                  service={r.service}
                  reference={r.ref}
                  provider={r.provider}
                  patientName={r.patient.name}
                  amountLabel={formatKobo(r.estimatedKobo)}
                  statusLabel={s.label}
                  statusTone={toTone(s.tone)}
                  onPress={() => router.push(`/(doctor)/hmo/pre-auth/${r.id}`)}
                />
              );
            })
          )}
        </ScrollView>
      )}

      <RequestSheet
        visible={open}
        pending={request.isPending}
        onClose={() => setOpen(false)}
        onSubmit={async (input) => {
          try {
            const result = await request.mutateAsync(input);
            setOpen(false);
            Alert.alert('Request sent', `${result.ref} is now ${PREAUTH_STATUS_LABELS[result.status].label.toLowerCase()}.`, [
              { text: 'View', onPress: () => router.push(`/(doctor)/hmo/pre-auth/${result.preAuthId}`) },
              { text: 'Done' },
            ]);
          } catch {
            Alert.alert('Failed', 'Could not raise the request. Please try again.');
          }
        }}
      />
    </SafeAreaView>
  );
}

function RequestSheet({ visible, pending, onClose, onSubmit }: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { patientId: string; provider: string; service: string; estimatedKobo: number; note?: string }) => void;
}) {
  const [provider, setProvider] = useState('');
  const [service, setService]   = useState('');
  const [naira, setNaira]       = useState('');
  const [note, setNote]         = useState('');

  const estimatedKobo = Math.round((Number(naira) || 0) * 100);
  const canSubmit = !!provider && !!service && estimatedKobo > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>New pre-authorisation</Text>
          <Pressable onPress={onClose} hitSlop={16} accessibilityRole="button" accessibilityLabel="Close"><X size={20} color={Colors.onSurfaceVariant} strokeWidth={2} /></Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <SelectField label="Provider" placeholder="Select provider" value={provider} options={HMO_PROVIDER_OPTIONS} onChange={setProvider} />
          <SelectField label="Service" placeholder="Select service" value={service} options={PREAUTH_SERVICE_OPTIONS} onChange={setService} />
          <TextInputField label="Estimated cost (NGN)" value={naira} onChangeText={setNaira} keyboardType="number-pad" placeholder="e.g. 150000" />
          <TextInputField label="Clinical justification (optional)" value={note} onChangeText={setNote} placeholder="Why is this service required?" multiline />
          <PrimaryButton label="Submit request" onPress={() => onSubmit({ patientId: 'pat-2', provider, service, estimatedKobo, note: note.trim() || undefined })} loading={pending} disabled={!canSubmit} style={styles.btn} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  addBtn:      { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 40 : 24, gap: Spacing.sm, flexGrow: 1 },
  backdrop:    { flex: 1, backgroundColor: 'rgba(11,28,48,0.4)' },
  sheet:       { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.containerMargin, paddingBottom: Spacing.xl, maxHeight: '85%' },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHigh, marginBottom: Spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, marginBottom: Spacing.md },
  sheetTitle:  { ...Typography.titleMd, color: Colors.onSurface },
  btn:         { marginTop: Spacing.sm },
});
