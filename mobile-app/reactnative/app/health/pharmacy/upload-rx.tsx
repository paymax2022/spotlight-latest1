import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera, Image as ImageIcon, FileText, ShieldCheck, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useUploadPrescription } from '@/features/health/pharmacy/hooks';

export default function UploadRxScreen() {
  const [attached, setAttached] = useState<string | null>(null);
  const [patientName, setPatientName] = useState('Ada Obi');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadPrescription();

  const onSubmit = async () => {
    if (!attached) {
      setError('Attach a clear photo or file of your prescription first.');
      return;
    }
    if (!patientName.trim()) {
      setError('Enter the patient name on the prescription.');
      return;
    }
    setError(null);
    try {
      const rx = await upload.mutateAsync({ patientName: patientName.trim(), note: note.trim() || undefined });
      router.replace({ pathname: '/health/pharmacy/rx-status', params: { id: rx.id } });
    } catch {
      setError('Upload failed. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Upload prescription" subtitle="Pharmacist-verified before dispensing" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Attach */}
        {attached ? (
          <View style={[styles.preview, shadow1]}>
            <View style={styles.previewThumb}>
              <FileText size={28} color={Colors.secondary} strokeWidth={2} />
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.previewName}>{attached}</Text>
              <Text style={styles.previewSub}>Ready to submit for verification</Text>
            </View>
            <Pressable onPress={() => setAttached(null)} hitSlop={8}>
              <X size={20} color={Colors.onSurfaceVariant} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.attachRow}>
            <Pressable style={[styles.attach, shadow1]} onPress={() => setAttached('Rx_photo.jpg')}>
              <View style={[styles.attachIcon, { backgroundColor: Colors.iconBgBlue }]}>
                <Camera size={24} color={Colors.secondary} strokeWidth={2} />
              </View>
              <Text style={styles.attachLabel}>Take photo</Text>
            </Pressable>
            <Pressable style={[styles.attach, shadow1]} onPress={() => setAttached('prescription.pdf')}>
              <View style={[styles.attachIcon, { backgroundColor: Colors.iconBgTeal }]}>
                <ImageIcon size={24} color={Colors.teal} strokeWidth={2} />
              </View>
              <Text style={styles.attachLabel}>Choose file</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.form}>
          <TextInputField label="Patient name" value={patientName} onChangeText={setPatientName} placeholder="Name on the prescription" />
          <TextInputField
            label="Note to pharmacist (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="Anything the pharmacist should know…"
            multiline
            numberOfLines={3}
          />
        </View>

        {/* HL-3 assurance */}
        <View style={styles.assure}>
          <ShieldCheck size={16} color={Colors.teal} strokeWidth={2} />
          <Text style={styles.assureText}>
            Your prescription is reviewed by a licensed pharmacist (PCN-verified). It cannot be dispensed twice.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Submit for verification" onPress={onSubmit} loading={upload.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.lg, paddingBottom: 40 },
  attachRow: { flexDirection: 'row', gap: Spacing.md },
  attach: {
    flex: 1,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  attachIcon: { width: 52, height: 52, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center' },
  attachLabel: { ...Typography.labelMd, color: Colors.onSurface },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  previewThumb: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.iconBgBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: { flex: 1 },
  previewName: { ...Typography.labelLg, color: Colors.onSurface },
  previewSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  form: { gap: 0 },
  assure: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.iconBgTeal,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  assureText: { ...Typography.bodySm, color: Colors.tertiaryContainer, flex: 1, lineHeight: 18 },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.background },
});
