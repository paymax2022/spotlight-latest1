import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Tag, Star, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import { useStaysStore } from '@/features/stays/store';
import { StaysColors } from '@/features/stays/constants/stays.constants';

export default function PromoScreen() {
  const { promoCode, useLoyalty, setPromo, setUseLoyalty } = useStaysStore();
  const [code, setCode] = useState(promoCode ?? '');
  const [applied, setApplied] = useState<string | null>(promoCode ?? null);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const c = code.trim().toUpperCase();
    if (c === 'PAYMAX10') {
      setApplied(c);
      setPromo(c);
      setError(null);
    } else {
      setError('That code is not valid or has expired.');
      setApplied(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Promo & loyalty" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Promo code</Text>
        <TextInputField
          value={code}
          onChangeText={(t) => { setCode(t); setError(null); }}
          placeholder="Enter promo code (try PAYMAX10)"
          autoCapitalize="characters"
          leftIcon={<Tag size={18} color={Colors.outline} />}
          error={error ?? undefined}
        />
        <PrimaryButton label="Apply code" variant="secondary" onPress={apply} />
        {applied ? (
          <View style={styles.appliedRow}>
            <Check size={16} color={StaysColors.ok} strokeWidth={2.4} />
            <Text style={styles.appliedText}>{applied} applied — 10% off the room rate</Text>
          </View>
        ) : null}

        <Text style={styles.section}>Paymax Stays loyalty</Text>
        <Pressable style={[styles.loyaltyCard, useLoyalty && styles.loyaltyOn]} onPress={() => setUseLoyalty(!useLoyalty)}>
          <View style={styles.loyaltyIcon}><Star size={20} color={Colors.gold} fill={useLoyalty ? Colors.gold : 'transparent'} strokeWidth={2} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.loyaltyTitle}>Apply loyalty discount</Text>
            <Text style={styles.loyaltyDesc}>Members save an extra 8% on eligible rates.</Text>
          </View>
          <View style={[styles.checkbox, useLoyalty && styles.checkboxOn]}>
            {useLoyalty ? <Check size={14} color={Colors.onPrimary} strokeWidth={3} /> : null}
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Done" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  section: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  appliedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.iconBgTeal, borderRadius: Radius.md, padding: Spacing.sm },
  appliedText: { ...Typography.bodySm, color: StaysColors.ok, fontWeight: '600' as const },
  loyaltyCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.outlineVariant, padding: Spacing.md },
  loyaltyOn: { borderColor: Colors.gold, backgroundColor: Colors.iconBgGold },
  loyaltyIcon: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.iconBgGold, alignItems: 'center', justifyContent: 'center' },
  loyaltyTitle: { ...Typography.titleMd, color: Colors.onSurface },
  loyaltyDesc: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
  checkbox: { width: 26, height: 26, borderRadius: Radius.DEFAULT, borderWidth: 2, borderColor: Colors.outline, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  footer: { padding: Spacing.containerMargin, borderTopWidth: 1, borderTopColor: Colors.outlineVariant },
});
