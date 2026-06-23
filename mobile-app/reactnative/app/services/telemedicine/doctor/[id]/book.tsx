import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { Radius } from '@/constants/radius';
import { Spacing } from '@/constants/spacing';
import { Typography } from '@/constants/typography';
import { getDoctor, getDoctorAvailability, DEMO_DOCTORS } from '@/api/telemedicine.api';
import { TeleHeader, SlotPicker, ConsultTypePicker } from '@/features/telemedicine/components';
import type { ConsultType, Slot } from '@/types/telemedicine';
import PrimaryButton from '@/components/PrimaryButton';

export default function BookSlotScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [consultType, setConsultType] = useState<ConsultType>('video');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');

  const { data: doctor } = useQuery({
    queryKey: ['tele-doctor', id],
    queryFn:  () => getDoctor(String(id)),
    placeholderData: DEMO_DOCTORS.find((d) => d.id === id),
  });

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ['tele-availability', id],
    queryFn:  () => getDoctorAvailability(String(id)),
  });

  const canContinue = !!selectedSlot && reason.trim().length > 0;

  const onContinue = () => {
    if (!selectedSlot || !doctor) return;
    router.push({
      pathname: '/services/telemedicine/book/confirm',
      params: {
        doctorId: doctor.id,
        slotId: selectedSlot.id,
        slotDate: selectedSlot.date,
        slotTime: selectedSlot.time,
        consultType,
        reason: reason.trim(),
      },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TeleHeader title="Book Appointment" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {doctor && (
          <View style={styles.docRow}>
            <Text style={styles.docName}>{doctor.name}</Text>
            <Text style={styles.docSpec}>{doctor.specialties.join(' • ')}</Text>
          </View>
        )}

        <Text style={styles.label}>Consultation type</Text>
        <ConsultTypePicker selected={consultType} onSelect={setConsultType} />

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Choose a time</Text>
        {isLoading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.md }} />
        ) : (
          <SlotPicker
            slots={slots}
            selectedDate={selectedDate}
            selectedSlot={selectedSlot}
            onSelectDate={(d) => { setSelectedDate(d); setSelectedSlot(null); }}
            onSelectSlot={setSelectedSlot}
          />
        )}

        <Text style={[styles.label, { marginTop: Spacing.lg }]}>Reason for visit</Text>
        <TextInput
          style={styles.reasonInput}
          placeholder="Briefly describe your symptoms or concern"
          placeholderTextColor={Colors.outline}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <Text style={styles.hint}>This is shared securely with your doctor before the consultation.</Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue to payment" onPress={onContinue} disabled={!canContinue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: Colors.background },
  content:     { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.lg, paddingBottom: 120 },
  docRow:      { marginBottom: Spacing.lg },
  docName:     { ...Typography.titleLg, color: Colors.onSurface },
  docSpec:     { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  label:       { ...Typography.titleMd, color: Colors.onSurface, marginBottom: Spacing.md },
  reasonInput: { minHeight: 110, borderWidth: 1.5, borderColor: Colors.outlineVariant, borderRadius: Radius.lg, padding: Spacing.md, ...Typography.bodyMd, color: Colors.onSurface, backgroundColor: Colors.surfaceContainerLow },
  hint:        { ...Typography.caption, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
  footer:      { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 32 : Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
