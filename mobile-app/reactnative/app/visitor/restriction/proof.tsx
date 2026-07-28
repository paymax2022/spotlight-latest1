import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Upload, FileCheck2, Clock, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useSubmitProofOfPayment } from '@/features/visitor/hooks/useVisitor';

export default function ProofOfPaymentScreen() {
  const submit = useSubmitProofOfPayment();
  const [attached, setAttached] = useState(false);
  const [reference, setReference] = useState('');
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Proof submitted" showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: Colors.iconBgBlue }]}>
            <Clock size={44} color={Colors.secondary} strokeWidth={1.6} />
          </View>
          <Text style={styles.resultTitle}>Under review</Text>
          <Text style={styles.resultBody}>An estate admin will review your proof of payment. Visitor access is restored automatically once approved.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to visitor access" onPress={() => router.replace('/visitor/restricted')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Proof of payment" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>Already paid by transfer or USSD? Upload your receipt and an admin will restore your access.</Text>

          {/* Upload zone (simulated picker) */}
          <Pressable onPress={() => setAttached(true)} accessibilityRole="button" style={[styles.upload, attached && styles.uploadDone]}>
            {attached ? (
              <>
                <FileCheck2 size={28} color={Colors.teal} strokeWidth={1.6} />
                <Text style={[styles.uploadText, { color: Colors.teal }]}>receipt-2026-06.jpg attached</Text>
                <Text style={styles.uploadSub}>Tap to replace</Text>
              </>
            ) : (
              <>
                <Upload size={28} color={Colors.secondary} strokeWidth={1.6} />
                <Text style={styles.uploadText}>Upload receipt</Text>
                <Text style={styles.uploadSub}>JPG, PNG or PDF</Text>
              </>
            )}
          </Pressable>

          <TextInputField label="Payment reference (optional)" placeholder="e.g. PSTK-9F2K1" value={reference} onChangeText={setReference} autoCapitalize="characters" />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Submit for review" onPress={() => submit.mutate(undefined, { onSuccess: () => setDone(true) })} loading={submit.isPending} disabled={!attached} />
          {!attached ? <Text style={styles.hint}>Attach a receipt to continue.</Text> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  upload: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow, paddingVertical: Spacing.xl,
  },
  uploadDone: { borderStyle: 'solid', borderColor: Colors.teal, backgroundColor: Colors.iconBgTeal },
  uploadText: { ...Typography.labelLg, color: Colors.secondary },
  uploadSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, gap: 6 },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, textAlign: 'center' },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 92, height: 92, borderRadius: Radius.xxl, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  resultBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
