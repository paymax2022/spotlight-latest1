import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { AtSign, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { useRequestMoney } from '@/features/social/hooks';
import { SocialColors, formatNaira, normalizeHandle, CASHTAG_REGEX } from '@/features/social/constants/social.constants';

export default function RequestMoney() {
  const { handle } = useLocalSearchParams<{ handle?: string }>();
  const request = useRequestMoney();

  const [from, setFrom] = useState(handle ? String(handle) : '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { if (handle) setFrom(String(handle)); }, [handle]);

  const amountKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const validHandle = CASHTAG_REGEX.test(from);
  const canRequest = amountKobo > 0 && validHandle;

  const submit = async () => {
    if (!canRequest) return;
    try {
      await request.mutateAsync({ fromHandle: normalizeHandle(from), amountKobo, note: note.trim() || undefined });
      setDone(true);
    } catch {
      Alert.alert('Could not request', 'Please try again.');
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Requested" showBack={false} />
        <View style={styles.successBody}>
          <View style={styles.successIcon}><CircleCheck size={40} color={SocialColors.ok} /></View>
          <Text style={styles.successTitle}>Request sent</Text>
          <Text style={styles.successSub}>{normalizeHandle(from)} will be notified to pay {formatNaira(amountKobo)}.</Text>
          <PrimaryButton label="Done" onPress={() => router.dismissAll?.() ?? router.back()} style={{ marginTop: Spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Request money" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInputField label="Request from" placeholder="@cashtag" autoCapitalize="none" autoCorrect={false} value={from} onChangeText={setFrom} leftIcon={<AtSign size={18} color={SocialColors.muted} />} />
        <TextInputField label="Amount" placeholder="0" keyboardType="numeric" value={amount} onChangeText={setAmount} />
        <TextInputField label="Note (optional)" placeholder="What's it for?" value={note} onChangeText={setNote} maxLength={80} />

        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            A request only notifies the other person — money moves when they approve and pay. You can only request for yourself.
          </Text>
        </View>

        <PrimaryButton label={amountKobo > 0 ? `Request ${formatNaira(amountKobo)}` : 'Request'} onPress={submit} disabled={!canRequest} loading={request.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  infoCard: { backgroundColor: SocialColors.surfaceAlt, borderRadius: Radius.md, padding: Spacing.md },
  infoText: { ...Typography.bodySm, color: SocialColors.muted },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xs },
  successIcon: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: SocialColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyMd, color: SocialColors.muted, textAlign: 'center' },
});
