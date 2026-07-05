import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Send, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import TicketPass from '@/features/events/components/TicketPass';
import { useTicket, useGiftTicket, useEvent } from '@/features/events/hooks';
import { EventColors } from '@/features/events/constants/events.constants';

export default function TicketPassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, isLoading, isError, refetch } = useTicket(id ?? '');
  const gift = useGiftTicket(id ?? '');
  const { data: event } = useEvent(t?.event_id ?? '');

  const [nonce, setNonce] = useState(0);
  const [showTransfer, setShowTransfer] = useState(false);
  const [cashtag, setCashtag] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Rotating QR: refresh the payload every 6s (anti-screenshot placeholder).
  useEffect(() => {
    const iv = setInterval(() => setNonce((n) => n + 1), 6000);
    return () => clearInterval(iv);
  }, []);

  if (isLoading) return <Shell><StateView kind="loading" message="Loading pass…" /></Shell>;
  if (isError || !t) return <Shell><StateView kind="error" title="Couldn't load pass" message="Please try again." actionLabel="Retry" onAction={() => refetch()} /></Shell>;

  const qrPayload = `${t.credential_id}.${Math.floor(Date.now() / 6000)}.${nonce}`;
  const canTransfer = t.state === 'ISSUED';
  const tier = event?.tiers.find((x) => x.id === t.tier_id);

  const doTransfer = async () => {
    setErr(null);
    const tag = cashtag.trim();
    if (!tag.startsWith('@') || tag.length < 3) { setErr('Enter a valid cashtag, e.g. @bisi'); return; }
    try {
      await gift.mutateAsync(tag);
      setShowTransfer(false);
      refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Transfer failed. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ticket pass" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <TicketPass ticket={t} event={event} tierName={tier?.name} qrPayload={qrPayload} />

        {canTransfer ? (
          <PrimaryButton
            label="Transfer / gift ticket"
            variant="secondary"
            onPress={() => { setCashtag(''); setErr(null); setShowTransfer(true); }}
            style={{ marginTop: Spacing.lg }}
          />
        ) : (
          <Text style={styles.note}>
            {t.state === 'USED' ? 'This ticket has already been used at the gate.' : 'This ticket has been transferred to another user.'}
          </Text>
        )}
        <View style={{ height: Spacing.xxl }} />
      </ScrollView>

      <Modal visible={showTransfer} transparent animationType="slide" onRequestClose={() => setShowTransfer(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Transfer or gift</Text>
              <Pressable onPress={() => setShowTransfer(false)} hitSlop={10}><X size={22} color={EventColors.muted} /></Pressable>
            </View>
            <Text style={styles.sheetSub}>Send this ticket to another Paymax user by cashtag. They receive it instantly; your copy is voided.</Text>
            <TextInputField
              label="Recipient cashtag"
              placeholder="@username"
              autoCapitalize="none"
              value={cashtag}
              onChangeText={setCashtag}
              leftIcon={<Send size={18} color={EventColors.muted} />}
              error={err ?? undefined}
            />
            <PrimaryButton label="Send ticket" onPress={doTransfer} loading={gift.isPending} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Ticket pass" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm },
  note: { ...Typography.bodyMd, color: EventColors.muted, textAlign: 'center', marginTop: Spacing.lg },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { ...Typography.titleLg, color: Colors.onSurface },
  sheetSub: { ...Typography.bodySm, color: EventColors.muted, marginBottom: Spacing.sm },
});
