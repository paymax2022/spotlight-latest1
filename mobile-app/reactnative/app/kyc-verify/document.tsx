import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SelectField from '@/components/SelectField';
import CaptureStub from '@/features/kycverify/components/CaptureStub';
import PrivacyNote from '@/features/kycverify/components/PrivacyNote';
import { DOC_TYPES } from '@/features/kycverify/constants';
import { kycVerifyDraft } from '@/features/kycverify/draft';
import type { DocType } from '@/features/kycverify/types';

const DOC_LABELS = DOC_TYPES.map((d) => d.label);
const labelToValue = (label: string): DocType => DOC_TYPES.find((d) => d.label === label)?.value ?? 'NATIONAL_ID';
const valueToLabel = (v: DocType) => DOC_TYPES.find((d) => d.value === v)?.label ?? DOC_LABELS[0];

/**
 * K8 — Document type + capture (Tier 3). Front is required, back optional
 * (depends on the doc type). Captures are STUBBED base64 for sandbox; real
 * document-scan SDK output plugs into CaptureStub. Runs OCR/authenticity on K9.
 */
export default function KycDocumentScreen() {
  const draft = kycVerifyDraft.current;
  const [docLabel, setDocLabel] = useState(valueToLabel(draft.docType));
  const [front, setFront] = useState<string | null>(draft.docFrontB64);
  const [back, setBack] = useState<string | null>(draft.docBackB64);

  const docType = labelToValue(docLabel);
  // Passports are single-page; other IDs typically need the back too.
  const backRequired = docType !== 'PASSPORT';
  const ready = !!front && (!backRequired || !!back);

  const next = () => {
    kycVerifyDraft.current.docType = docType;
    kycVerifyDraft.current.docFrontB64 = front;
    kycVerifyDraft.current.docBackB64 = back;
    router.push('/kyc-verify/document-processing');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="ID document" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.sub}>
          Why: for Tier 3 we verify a physical government ID for authenticity and match it to your identity.
        </Text>
        <Text style={styles.how}>How: place the ID on a flat, dark surface and capture all four corners in frame.</Text>

        <SelectField label="Document type" value={docLabel} options={DOC_LABELS} searchable={false} onChange={setDocLabel} />

        <Text style={styles.section}>Capture your document</Text>
        <View style={styles.captures}>
          <View style={styles.captureCol}>
            <CaptureStub
              label="Front of ID"
              hint="Front side (sandbox)"
              captureKind="doc-front"
              captured={!!front}
              onCaptured={setFront}
            />
          </View>
          {backRequired ? (
            <View style={styles.captureCol}>
              <CaptureStub
                label="Back of ID"
                hint="Back side (sandbox)"
                captureKind="doc-back"
                captured={!!back}
                onCaptured={setBack}
              />
            </View>
          ) : null}
        </View>

        <PrivacyNote>
          Your document image is processed by our verification partner for authenticity and OCR only, and stored per
          our retention policy.
        </PrivacyNote>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue" onPress={next} disabled={!ready} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.containerMargin, gap: Spacing.md },
  sub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  how: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  section: { ...Typography.labelMd, color: Colors.onSurface },
  captures: { flexDirection: 'row', gap: Spacing.md },
  captureCol: { flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
