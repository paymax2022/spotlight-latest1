import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { User, MapPin, FileText, UserPlus, Siren, BellRing, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useCreateWalkIn, useGateSession } from '@/features/visitor/hooks/useVisitor';

export default function WalkInScreen() {
  const session = useGateSession();
  const walkIn = useCreateWalkIn();

  const [emergency, setEmergency] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const gateId = session.data?.gateId ?? 'gate_main';

  const submit = () => {
    setError('');
    if (!name.trim() || !unit.trim()) {
      setError('Visitor name and host unit are required.');
      return;
    }
    walkIn.mutate(
      { visitorName: name.trim(), unitLabel: unit.trim(), visitorPhone: phone.trim() || undefined, purpose: purpose.trim() || undefined, emergency, gateId },
      { onSuccess: () => setDone(true), onError: (e) => setError(e instanceof Error ? e.message : 'Could not record entry.') },
    );
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={emergency ? 'Emergency entry' : 'Walk-in recorded'} showBack={false} />
        <View style={styles.resultWrap}>
          <View style={[styles.bigIcon, { backgroundColor: emergency ? Colors.errorContainer : Colors.iconBgTeal }]}>
            {emergency ? <Siren size={46} color={Colors.error} strokeWidth={1.6} /> : <CircleCheck size={46} color={Colors.teal} strokeWidth={1.6} />}
          </View>
          <Text style={styles.resultTitle}>{emergency ? 'Emergency entry logged' : 'Approval requested'}</Text>
          <Text style={styles.resultBody}>
            {emergency
              ? `${name} was fast-tracked and the entry is flagged for admin review.`
              : `${name} is awaiting approval from ${unit}. The resident has been notified.`}
          </Text>
        </View>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.replace('/guard')} />
          <PrimaryButton label="Record another" variant="secondary" onPress={() => { setDone(false); setName(''); setUnit(''); setPhone(''); setPurpose(''); }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Walk-in entry" subtitle="No pre-issued code" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Mode toggle */}
          <View style={styles.modeRow}>
            <ModeOption active={!emergency} onPress={() => setEmergency(false)} icon={<UserPlus size={20} color={Colors.secondary} />} label="Walk-in" sub="Request approval" accent={Colors.secondary} />
            <ModeOption active={emergency} onPress={() => setEmergency(true)} icon={<Siren size={20} color={Colors.error} />} label="Emergency" sub="Fast-track" accent={Colors.error} />
          </View>

          <View style={styles.form}>
            <TextInputField label="Visitor name" placeholder="Full name" value={name} onChangeText={setName} autoCapitalize="words" leftIcon={<User size={18} color={Colors.outline} />} />
            <TextInputField label="Host unit" placeholder="e.g. Block C, Flat 4" value={unit} onChangeText={setUnit} leftIcon={<MapPin size={18} color={Colors.outline} />} />
            <TextInputField label="Phone (optional)" placeholder="+234 800 000 0000" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            <TextInputField label="Purpose (optional)" placeholder="Reason for visit" value={purpose} onChangeText={setPurpose} leftIcon={<FileText size={18} color={Colors.outline} />} />
          </View>

          <View style={[styles.note, { backgroundColor: emergency ? Colors.errorContainer : Colors.surfaceContainerLow }]}>
            <BellRing size={16} color={emergency ? Colors.error : Colors.onSurfaceVariant} strokeWidth={1.8} />
            <Text style={styles.noteText}>
              {emergency
                ? 'Emergency entries are admitted immediately and flagged for admin review.'
                : 'The resident will be asked to approve before the visitor is admitted.'}
            </Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton label={emergency ? 'Log emergency entry' : 'Request approval'} onPress={submit} loading={walkIn.isPending} variant={emergency ? 'primary' : 'primary'} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ModeOption({ active, onPress, icon, label, sub, accent }: { active: boolean; onPress: () => void; icon: React.ReactNode; label: string; sub: string; accent: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.mode, active && { backgroundColor: accent, borderColor: accent }]}>
      <View style={[styles.modeIcon, { backgroundColor: active ? Colors.white : Colors.surfaceContainerLow }]}>{icon}</View>
      <Text style={[styles.modeLabel, active && { color: Colors.onPrimary }]}>{label}</Text>
      <Text style={[styles.modeSub, active && { color: Colors.onPrimary }]}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.xl, gap: Spacing.md },
  modeRow: { flexDirection: 'row', gap: Spacing.md },
  mode: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Spacing.md, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerLow, backgroundColor: Colors.surfaceContainerLowest },
  modeIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.xs },
  modeLabel: { ...Typography.labelLg, color: Colors.onSurface },
  modeSub: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  form: { marginTop: Spacing.xs },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  noteText: { ...Typography.bodySm, color: Colors.onSurfaceVariant, flex: 1 },
  error: { ...Typography.labelMd, color: Colors.error },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerLow, gap: Spacing.sm },
  resultWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 92, height: 92, borderRadius: Radius.xxl, alignItems: 'center', justifyContent: 'center' },
  resultTitle: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  resultBody: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center' },
});
