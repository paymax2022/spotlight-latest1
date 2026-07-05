import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { UserPlus, ShieldCheck, Check, Link2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { GUARDIAN_CONSENT_COPY } from '@/features/academy/constants';
import { useChildren } from '@/features/academy/hooks';

/**
 * P2 — Add / link a child with guardian consent. Mirrors the onboarding consent
 * gate (A7): a link request is sent, consent recorded with an audit trail. In
 * mock we surface the existing unlinked child so the slice is end-to-end runnable.
 */
export default function AddChild() {
  const children = useChildren();
  const unlinked = children.data?.find((c) => !c.linked);

  const [name, setName] = useState(unlinked?.displayName ?? '');
  const [code, setCode] = useState('');
  const [acked, setAcked] = useState(false);
  const [done, setDone] = useState(false);

  const valid = name.trim().length > 1 && code.trim().length >= 4 && acked;

  const link = () => {
    // Mock: consent recorded with audit trail server-side. We flag locally done.
    setDone(true);
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Child linked" showBack={false} />
        <View style={styles.center}>
          <View style={styles.successIcon}><Check size={32} color={Colors.teal} strokeWidth={3} /></View>
          <Text style={styles.successTitle}>Consent recorded</Text>
          <Text style={styles.successSub}>{name.trim()} is now linked to your account. Consent is audit-logged and can be withdrawn anytime.</Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Back to family" onPress={() => router.replace('/learn/academy/parent')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add / link child" subtitle="Child safety · consent required" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}><UserPlus size={26} color={Colors.primary} /></View>

        <TextInputField label="Child's name" placeholder="e.g. Ada A." value={name} onChangeText={setName} />
        <TextInputField
          label="Link code or child's phone"
          placeholder="Code from the child's app"
          value={code}
          onChangeText={setCode}
          leftIcon={<Link2 size={18} color={Colors.outline} />}
          autoCapitalize="characters"
        />

        <View style={styles.banner}>
          <ShieldCheck size={20} color={Colors.primary} strokeWidth={2} />
          <Text style={styles.bannerText}>{GUARDIAN_CONSENT_COPY}</Text>
        </View>

        <Pressable style={styles.ackRow} onPress={() => setAcked((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: acked }}>
          <View style={[styles.checkbox, acked && styles.checkboxOn]}>{acked ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}</View>
          <Text style={styles.ackText}>I am this child's parent/guardian and consent to the data and purchase rules above.</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Link child & record consent" onPress={link} disabled={!valid} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.xs },
  iconWrap: { width: 56, height: 56, borderRadius: Radius.lg, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, padding: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.sm },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  ackRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', marginTop: Spacing.md },
  checkbox: { width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ackText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.iconBgTeal, alignItems: 'center', justifyContent: 'center' },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
