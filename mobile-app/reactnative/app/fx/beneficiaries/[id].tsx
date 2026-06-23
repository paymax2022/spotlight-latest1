import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Star, Pencil, Trash2, Send, BadgeCheck, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import SummaryRow from '@/features/fx/components/SummaryRow';
import {
  useBeneficiaries, useToggleFavoriteBeneficiary, useDeleteBeneficiary,
} from '@/features/fx/hooks/useFx';
import { CURRENCIES, RAIL_LABEL } from '@/features/fx/constants/fx.constants';

export default function BeneficiaryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useBeneficiaries();
  const toggleFav = useToggleFavoriteBeneficiary();
  const del = useDeleteBeneficiary();
  const [removing, setRemoving] = useState(false);
  const beneficiary = data?.find((b) => b.id === id);

  if (isLoading) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Beneficiary" /><StateView kind="loading" /></SafeAreaView>;
  }
  if (!beneficiary) {
    return <SafeAreaView style={styles.safe}><ScreenHeader title="Beneficiary" /><StateView kind="error" title="Beneficiary not found" actionLabel="Back" onAction={() => router.back()} /></SafeAreaView>;
  }

  const meta = CURRENCIES[beneficiary.currency];
  const initials = beneficiary.name.split(' ').slice(0, 2).map((s) => s[0]).join('').toUpperCase();

  const confirmRemove = () => {
    Alert.alert(
      'Remove beneficiary',
      `Remove ${beneficiary.name}? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => { setRemoving(true); await del.mutateAsync(beneficiary.id); router.back(); },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title="Beneficiary"
        rightSlot={
          <Pressable
            onPress={() => toggleFav.mutate({ id: beneficiary.id, favorite: !beneficiary.favorite })}
            hitSlop={8} accessibilityRole="button"
            accessibilityLabel={beneficiary.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              size={22}
              color={beneficiary.favorite ? Colors.gold : Colors.outline}
              fill={beneficiary.favorite ? Colors.gold : 'transparent'}
              strokeWidth={2}
            />
          </Pressable>
        }
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <View style={styles.avatar}><Text style={styles.initials}>{initials}</Text></View>
          <Text style={styles.name}>{beneficiary.name}</Text>
          <View style={[styles.statusPill, beneficiary.validated ? styles.okPill : styles.badPill]}>
            {beneficiary.validated
              ? <BadgeCheck size={13} color={Colors.tertiaryContainer} strokeWidth={2} />
              : <ShieldAlert size={13} color={Colors.error} strokeWidth={2} />}
            <Text style={[styles.statusText, { color: beneficiary.validated ? Colors.tertiaryContainer : Colors.error }]}>
              {beneficiary.validated ? 'Verified' : 'Unverified'}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <SummaryRow label="Payout rail" value={RAIL_LABEL[beneficiary.rail]} />
          <SummaryRow label="Receiving currency" value={`${meta.flag} ${beneficiary.currency} · ${meta.name}`} />
          {beneficiary.bankName ? <SummaryRow label={beneficiary.rail === 'mobile_money' ? 'Operator' : 'Institution'} value={beneficiary.bankName} /> : null}
          <SummaryRow label="Account" value={beneficiary.accountNumber} copyable />
          <SummaryRow label="Country" value={beneficiary.countryCode} />
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.actionBtn} onPress={() => router.push({ pathname: '/fx/send/new-beneficiary', params: { editId: beneficiary.id } })} accessibilityRole="button">
            <Pencil size={18} color={Colors.secondary} strokeWidth={2} />
            <Text style={styles.actionText}>Edit</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={confirmRemove} accessibilityRole="button">
            <Trash2 size={18} color={Colors.error} strokeWidth={2} />
            <Text style={[styles.actionText, { color: Colors.error }]}>Remove</Text>
          </Pressable>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <PrimaryButton
          label={`Send to ${beneficiary.name.split(' ')[0]}`}
          onPress={() => router.push({ pathname: '/fx/send/amount', params: { beneficiaryId: beneficiary.id } })}
          loading={removing}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  hero: { alignItems: 'center', gap: 8, paddingVertical: Spacing.sm },
  avatar: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  initials: { ...Typography.headlineMd, color: Colors.primary },
  name: { ...Typography.titleLg, color: Colors.onSurface },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  okPill: { backgroundColor: Colors.iconBgTeal },
  badPill: { backgroundColor: Colors.errorContainer },
  statusText: { ...Typography.labelSm, fontWeight: '600' },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.surfaceContainerHigh },
  actionText: { ...Typography.labelLg, color: Colors.secondary },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
