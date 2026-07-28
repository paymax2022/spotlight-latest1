import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Search, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SolicitationGuard from '@/features/connect/components/wallet-SolicitationGuard';
import { formatKobo } from '@/features/connect/constants/format';
import type { GiftRecipient } from '@/features/connect/wallet/types';
import { useGiftProduct, useGiftRecipients } from '@/features/connect/wallet/hooks';

// WL-06 — Pick recipient + add a message for a chosen gift, then continue to the
// confirm screen (which shows tier remaining before the POST).
export default function SendGift() {
  const { productId, recipientId: presetRecipient } = useLocalSearchParams<{ productId: string; recipientId?: string }>();
  const product = useGiftProduct(productId ?? '');
  const [query, setQuery] = useState('');
  const recipients = useGiftRecipients(query);
  const [selected, setSelected] = useState<string | undefined>(presetRecipient);
  const [message, setMessage] = useState('');

  const canContinue = useMemo(() => !!productId && !!selected, [productId, selected]);

  if (product.isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Send gift" />
        <StateView kind="loading" message="Loading gift…" />
      </SafeAreaView>
    );
  }
  if (product.error || !product.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Send gift" />
        <StateView kind="error" title="Couldn't load gift" actionLabel="Retry" onAction={() => product.refetch()} />
      </SafeAreaView>
    );
  }

  const onContinue = () => {
    if (!canContinue) return;
    router.push({
      pathname: '/connect/wallet/gifting/confirm',
      params: { productId: productId!, recipientId: selected!, message },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Send gift" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.giftRow}>
          <Text style={styles.emoji}>{product.data.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.giftName}>{product.data.name}</Text>
            <Text style={styles.giftDesc}>{product.data.description}</Text>
          </View>
          <Text style={styles.giftPrice}>{formatKobo(product.data.priceKobo)}</Text>
        </View>

        <SolicitationGuard />

        <Text style={styles.label}>Recipient</Text>
        <TextInputField
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name or @handle"
          leftIcon={<Search size={18} color={Colors.outline} />}
          autoCapitalize="none"
        />

        {recipients.isLoading ? (
          <StateView kind="loading" compact message="Searching…" />
        ) : (recipients.data ?? []).length === 0 ? (
          <StateView kind="empty" compact icon="User" title="No matches" message="Try a different name." />
        ) : (
          <View style={styles.recipientList}>
            {recipients.data!.map((r) => (
              <RecipientRow key={r.id} recipient={r} selected={selected === r.id} onPress={() => setSelected(r.id)} />
            ))}
          </View>
        )}

        <Text style={styles.label}>Message (optional)</Text>
        <TextInputField
          value={message}
          onChangeText={setMessage}
          placeholder="Say something nice…"
          multiline
          maxLength={140}
        />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Continue" onPress={onContinue} disabled={!canContinue} />
      </View>
    </SafeAreaView>
  );
}

function RecipientRow({ recipient, selected, onPress }: { recipient: GiftRecipient; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.recipient, selected && styles.recipientSelected]}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{recipient.displayName[0]}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.recipientName}>{recipient.displayName}</Text>
        {recipient.handle ? <Text style={styles.recipientHandle}>{recipient.handle}</Text> : null}
      </View>
      {selected ? <Check size={18} color={Colors.primary} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  body: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 40, gap: Spacing.md },
  giftRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1, borderColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.sm,
  },
  emoji: { fontSize: 30 },
  giftName: { ...Typography.titleMd, color: Colors.onSurface },
  giftDesc: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  giftPrice: { ...Typography.titleMd, color: Colors.primary },
  label: { ...Typography.labelMd, color: Colors.onSurface },
  recipientList: { gap: Spacing.sm },
  recipient: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceContainerLowest, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh,
    borderRadius: Radius.lg, padding: Spacing.sm,
  },
  recipientSelected: { borderColor: Colors.primary },
  avatar: { width: 40, height: 40, borderRadius: Radius.full, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...Typography.titleMd, color: Colors.primary },
  recipientName: { ...Typography.labelLg, color: Colors.onSurface },
  recipientHandle: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
