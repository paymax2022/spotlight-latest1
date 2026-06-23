import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CheckCircle2, XCircle, Clock, KeyRound } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useValidateCode } from '../hooks/useJoin';
import type { CodeKind, CodeValidation } from '../types/join.types';

interface Props {
  kind:        CodeKind;
  title:       string;
  heading:     string;
  helper:      string;
  placeholder: string;
}

export default function CodeEntryView({ kind, title, heading, helper, placeholder }: Props) {
  const validate = useValidateCode(kind);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CodeValidation | null>(null);

  const onCheck = () => {
    if (!code.trim()) return;
    validate.mutate(code, { onSuccess: setResult });
  };

  const onContinue = () => {
    if (result?.valid && result.organisationId) {
      router.push(`/association/organisation/${result.organisationId}`);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={title} />
      <View style={styles.body}>
        <View style={styles.iconBox}><KeyRound size={26} color={Colors.primary} strokeWidth={2} /></View>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.helper}>{helper}</Text>

        <TextInputField
          placeholder={placeholder}
          value={code}
          onChangeText={(t) => { setCode(t); if (result) setResult(null); }}
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />

        {result ? (
          <View style={[styles.resultCard, shadow1, result.valid ? styles.resultOk : styles.resultBad]}>
            {result.valid ? <CheckCircle2 size={18} color={Colors.teal} strokeWidth={2} />
              : result.expired ? <Clock size={18} color={Colors.gold} strokeWidth={2} />
              : <XCircle size={18} color={Colors.error} strokeWidth={2} />}
            <Text style={styles.resultText}>{result.message}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        {result?.valid ? (
          <PrimaryButton label="Continue" onPress={onContinue} />
        ) : (
          <PrimaryButton label="Verify code" onPress={onCheck} loading={validate.isPending} disabled={!code.trim()} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.xl, gap: Spacing.md, alignItems: 'center' },
  iconBox: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  heading: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  helper: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
  input: { letterSpacing: 2, textAlign: 'center', fontWeight: '700' },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, alignSelf: 'stretch', borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.md },
  resultOk: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.teal },
  resultBad: { backgroundColor: Colors.surfaceContainerLowest, borderColor: Colors.outlineVariant },
  resultText: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
