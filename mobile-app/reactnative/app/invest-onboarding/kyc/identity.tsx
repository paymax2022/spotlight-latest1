import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import SegmentedControl from '@/components/SegmentedControl';
import StepHeader from '@/features/investonboarding/components/StepHeader';
import UploadTile from '@/features/investonboarding/components/UploadTile';
import { kycDraft } from '@/features/investonboarding/utils/onboardingDraft';
import { ID_DOC_TYPES } from '@/features/investonboarding/constants/onboarding.constants';
import type { IdDocType } from '@/features/investonboarding/types/onboarding.types';

export default function KycIdentityScreen() {
  const [docType, setDocType] = useState<IdDocType>(kycDraft.current.idDocType);
  const [front, setFront] = useState(kycDraft.current.idFrontUploaded);
  const [back, setBack] = useState(kycDraft.current.idBackUploaded);

  const meta = ID_DOC_TYPES.find((d) => d.value === docType);
  // Passport is a single data page; others need front + back.
  const needsBack = docType !== 'passport';
  const ready = front && (!needsBack || back);

  const onContinue = () => {
    kycDraft.current.idDocType = docType;
    kycDraft.current.idFrontUploaded = front;
    kycDraft.current.idBackUploaded = needsBack ? back : true;
    router.push('/invest-onboarding/kyc/selfie');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Upload your ID" />
      <StepHeader step={2} total={4} label="Identity" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.label}>Document type</Text>
        <SegmentedControl<IdDocType>
          scrollable
          value={docType}
          onChange={(v) => { setDocType(v); setFront(false); setBack(false); }}
          options={ID_DOC_TYPES.map((d) => ({ value: d.value, label: d.label }))}
        />
        {meta ? <Text style={styles.hint}>{meta.hint}</Text> : null}

        <View style={styles.tiles}>
          <UploadTile label={needsBack ? 'Front of document' : 'Photo / data page'} hint="Make sure all text is readable" uploaded={front} onUploaded={() => setFront(true)} />
          {needsBack ? (
            <UploadTile label="Back of document" hint="Make sure all text is readable" uploaded={back} onUploaded={() => setBack(true)} />
          ) : null}
        </View>

        <Text style={styles.note}>
          We accept clear photos or scans. Avoid glare and make sure the whole document is in frame.
        </Text>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Continue" onPress={onContinue} disabled={!ready} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: Spacing.lg, gap: Spacing.sm },
  label: { ...Typography.labelMd, color: Colors.onSurface, paddingHorizontal: Spacing.containerMargin, marginBottom: Spacing.xs },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, marginTop: Spacing.xs },
  tiles: { paddingHorizontal: Spacing.containerMargin, gap: Spacing.md, marginTop: Spacing.md },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, paddingHorizontal: Spacing.containerMargin, lineHeight: 18, marginTop: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
