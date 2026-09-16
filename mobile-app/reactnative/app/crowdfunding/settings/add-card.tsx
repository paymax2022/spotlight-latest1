import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ShieldCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';

const formatCard = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
const formatExpiry = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

export default function AddCardScreen() {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const digits = number.replace(/\D/g, '');
  const valid = digits.length >= 15 && name.trim().length > 2 && expiry.length === 5 && cvv.length >= 3;

  const save = () => { setSaving(true); setTimeout(() => { setSaving(false); setDone(true); }, 800); };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Card added" showBack={false} />
        <StateView kind="empty" icon="CircleCheck" title="Card added securely" message="Your card has been tokenised and saved for faster contributions." actionLabel="Done" onAction={() => goBack('/crowdfunding/settings')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Add card" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.secure}>
            <ShieldCheck size={16} color={Colors.tertiaryContainer} strokeWidth={2} />
            <Text style={styles.secureText}>Card details are encrypted and tokenised by our payment provider — Spotlight never stores your full card number.</Text>
          </View>

          <TextInputField label="Card number" value={number} onChangeText={(t) => setNumber(formatCard(t))} keyboardType="number-pad" placeholder="1234 5678 9012 3456" />
          <TextInputField label="Name on card" value={name} onChangeText={setName} autoCapitalize="words" />
          <View style={styles.row}>
            <View style={styles.half}><TextInputField label="Expiry" value={expiry} onChangeText={(t) => setExpiry(formatExpiry(t))} keyboardType="number-pad" placeholder="MM/YY" /></View>
            <View style={styles.half}><TextInputField label="CVV" value={cvv} onChangeText={(t) => setCvv(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" secure placeholder="123" /></View>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Add card" onPress={save} disabled={!valid} loading={saving} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  secure: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  secureText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.md },
  half: { flex: 1 },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
