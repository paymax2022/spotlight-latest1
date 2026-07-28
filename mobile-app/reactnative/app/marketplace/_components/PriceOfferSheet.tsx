// ── Marketplace — PriceOfferSheet (Screens 19/20 Make Offer + Counter) ───────
// A bottom-sheet price capture reused for BOTH the Make Offer sheet (prefilled at
// asking price) and the counter-offer sheet. Naira input, optional message, and
// a plain reminder that an accepted offer moves to escrow checkout.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, TextInput } from 'react-native';
import { X, Tag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import PrimaryButton from '@/components/PrimaryButton';
import { MarketColors, formatNaira } from '@/features/marketplace';

export default function PriceOfferSheet({
  visible,
  title,
  askingPriceKobo,
  submitLabel,
  withMessage,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  askingPriceKobo: number;
  submitLabel: string;
  withMessage?: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (priceKobo: number, message?: string) => void;
}) {
  // Prefill at the asking price (naira, whole numbers).
  const [naira, setNaira] = useState(String(Math.round(askingPriceKobo / 100)));
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (visible) {
      setNaira(String(Math.round(askingPriceKobo / 100)));
      setMessage('');
    }
  }, [visible, askingPriceKobo]);

  const priceKobo = Math.round(Number(naira.replace(/[^0-9]/g, '') || '0') * 100);
  const valid = priceKobo > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={22} color={MarketColors.muted} />
            </Pressable>
          </View>

          <Text style={styles.label}>Your price</Text>
          <View style={styles.inputRow}>
            <Text style={styles.currency}>₦</Text>
            <TextInput
              style={styles.input}
              value={naira}
              onChangeText={(t) => setNaira(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={MarketColors.muted}
              autoFocus
            />
          </View>
          <View style={styles.askRow}>
            <Tag size={13} color={MarketColors.muted} />
            <Text style={styles.ask}>Asking price {formatNaira(askingPriceKobo)}</Text>
          </View>

          {withMessage ? (
            <>
              <Text style={[styles.label, { marginTop: Spacing.md }]}>Message (optional)</Text>
              <TextInput
                style={styles.messageInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Add a note to the seller…"
                placeholderTextColor={MarketColors.muted}
                multiline
                maxLength={240}
              />
            </>
          ) : null}

          <Text style={styles.hint}>
            Offers are structured — the seller sees a clear price, not just a message. If accepted, you pay into escrow
            next.
          </Text>

          <PrimaryButton
            label={submitLabel}
            onPress={() => onSubmit(priceKobo, message.trim() || undefined)}
            disabled={!valid || submitting}
            loading={submitting}
            style={{ marginTop: Spacing.md }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(11,28,48,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surfaceContainerLowest, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: Spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...Typography.titleLg, color: MarketColors.text },
  label: { ...Typography.labelMd, color: MarketColors.muted, marginTop: Spacing.md, marginBottom: Spacing.xs, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: MarketColors.border, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, backgroundColor: MarketColors.surface },
  currency: { ...Typography.headlineMd, color: MarketColors.text },
  input: { ...Typography.headlineMd, color: MarketColors.text, flex: 1, paddingVertical: 12, marginLeft: 4 },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: Spacing.xs },
  ask: { ...Typography.labelSm, color: MarketColors.muted },
  messageInput: { ...Typography.bodyMd, color: Colors.onSurface, borderWidth: 1, borderColor: MarketColors.border, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 64, textAlignVertical: 'top', backgroundColor: MarketColors.surface },
  hint: { ...Typography.labelSm, color: MarketColors.muted, marginTop: Spacing.md, lineHeight: 16 },
});
