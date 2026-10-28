import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { CircleCheck, AtSign, Users } from 'lucide-react-native';
import { Colors } from '@/constants/tokens';
import { Typography } from '@/constants/tokens';
import { Spacing } from '@/constants/tokens';
import { Radius } from '@/constants/tokens';
import { shadow1 } from '@/constants/tokens';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import AmlBanner from '@/features/social/components/AmlBanner';
import { useMyCashtag, useSendMoney, resolveCashtag } from '@/features/social/hooks';
import { SocialColors, formatNaira, amlMessageFor, normalizeHandle, CASHTAG_REGEX } from '@/features/social/constants/social.constants';
import type { Cashtag } from '@/features/social/types';
import { sanitizeMoneyInput } from '@/utils/money';

export default function SendMoney() {
  const { handle } = useLocalSearchParams<{ handle?: string }>();
  const me = useMyCashtag();
  const send = useSendMoney();

  const [toInput, setToInput] = useState(handle ? String(handle) : '');
  const [resolving, setResolving] = useState(false);
  const [recipient, setRecipient] = useState<Cashtag | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => { if (handle) setToInput(String(handle)); }, [handle]);

  const validHandle = CASHTAG_REGEX.test(toInput.trim());
  const target = validHandle ? normalizeHandle(toInput) : '';

  useEffect(() => {
    let active = true;
    if (!target) { setRecipient(null); setResolving(false); return; }
    setResolving(true);
    const t = setTimeout(async () => {
      const r = await resolveCashtag(target);
      if (active) { setRecipient(r); setResolving(false); }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [target]);

  const amountKobo = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const remaining = me.data?.remainingDailyKobo ?? 0;
  const amlMsg = amountKobo > 0 ? amlMessageFor(amountKobo, remaining) : null;
  const canSend = amountKobo > 0 && !amlMsg && !!recipient && !resolving;

  const submit = async () => {
    if (!canSend) return;
    try {
      await send.mutateAsync({ toHandle: target, amountKobo, note: note.trim() || undefined });
      setDone(true);
    } catch {
      Alert.alert('Could not send', 'Please try again.');
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Sent" showBack={false} />
        <View style={styles.successBody}>
          <View style={styles.successIcon}><CircleCheck size={40} color={SocialColors.ok} /></View>
          <Text style={styles.successTitle}>{formatNaira(amountKobo)} sent</Text>
          <Text style={styles.successSub}>to {recipient?.displayName ?? target}</Text>
          <PrimaryButton label="Done" onPress={() => router.dismissAll?.() ?? goBack('/social')} style={{ marginTop: Spacing.lg }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Send money" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInputField label="Send to" placeholder="@cashtag" autoCapitalize="none" autoCorrect={false} value={toInput} onChangeText={setToInput} leftIcon={<AtSign size={18} color={SocialColors.muted} />} />
        <Pressable onPress={() => router.push('/social/contacts')} style={styles.contactsLink} accessibilityLabel="Choose from contacts">
          <Users size={16} color={SocialColors.brand} />
          <Text style={styles.contactsLinkText}>Choose from contacts</Text>
        </Pressable>

        {(resolving || target !== '') && (
          <View style={styles.recipientCard}>
            {resolving ? (
              <ActivityIndicator color={Colors.primary} />
            ) : recipient ? (
              <>
                <CashtagAvatar name={recipient.displayName} handle={target} color={recipient.avatarColor} size={48} verified={recipient.verified} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.recipientName}>{recipient.displayName}</Text>
                  <Text style={styles.recipientHandle}>{target}</Text>
                </View>
              </>
            ) : (
              <Text style={styles.recipientHandle}>No Paymax account found for {target}</Text>
            )}
          </View>
        )}

        <TextInputField label="Amount" placeholder="0" keyboardType="decimal-pad" maxLength={13} value={amount} onChangeText={(t) => setAmount(sanitizeMoneyInput(t))} />
        <TextInputField label="Note (optional)" placeholder="What's it for?" value={note} onChangeText={setNote} maxLength={80} />

        <AmlBanner remainingKobo={remaining} blockedMessage={amlMsg} />

        <PrimaryButton label={amountKobo > 0 ? `Send ${formatNaira(amountKobo)}` : 'Send'} onPress={submit} disabled={!canSend} loading={send.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  recipientCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 72, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.cardPadding, ...shadow1 },
  contactsLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  contactsLinkText: { ...Typography.labelMd, color: SocialColors.brand },
  recipientName: { ...Typography.titleMd, color: Colors.onSurface },
  recipientHandle: { ...Typography.bodyMd, color: SocialColors.muted },
  successBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.xs },
  successIcon: { width: 80, height: 80, borderRadius: Radius.full, backgroundColor: SocialColors.okBg, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  successTitle: { ...Typography.headlineMd, color: Colors.onSurface },
  successSub: { ...Typography.bodyLg, color: SocialColors.muted },
});
