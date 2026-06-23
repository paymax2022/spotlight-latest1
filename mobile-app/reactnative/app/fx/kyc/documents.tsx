import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import UploadTile from '@/features/fx/components/UploadTile';
import { kycDraft } from '@/features/fx/utils/kycDraft';

const REQUIRED_DOCS = [
  { key: 'incorporation', label: 'Certificate of incorporation', hint: 'PDF or photo' },
  { key: 'memart', label: 'MEMART / constitution', hint: 'PDF or photo' },
  { key: 'directors', label: 'Proof of directors (CAC status report)', hint: 'PDF or photo' },
  { key: 'address', label: 'Proof of business address', hint: 'Utility bill, < 3 months' },
];

export default function KybDocumentsScreen() {
  const [uploaded, setUploaded] = useState<Record<string, boolean>>({});
  const allDone = REQUIRED_DOCS.every((d) => uploaded[d.key]);

  const submit = () => {
    kycDraft.current.businessDocsUploaded = true;
    router.push('/fx/kyc/submitted');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Business documents" subtitle="KYB · 3 of 3" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>Upload your registration documents. Our compliance team reviews these before approval.</Text>
        <View style={styles.list}>
          {REQUIRED_DOCS.map((d) => (
            <UploadTile
              key={d.key}
              label={d.label}
              hint={d.hint}
              uploaded={!!uploaded[d.key]}
              onPress={() => setUploaded((prev) => ({ ...prev, [d.key]: true }))}
            />
          ))}
        </View>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton label="Submit for review" onPress={submit} disabled={!allDone} />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin },
  intro: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, marginBottom: Spacing.md },
  list: { gap: Spacing.sm },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
