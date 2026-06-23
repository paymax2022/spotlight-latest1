import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Plus, Trash2, Gift, Flag } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import WizardHeader from '@/features/crowdfunding/components/WizardHeader';
import PrimaryButton from '@/components/PrimaryButton';
import { useCampaignDraft } from '@/features/crowdfunding/store/campaignDraftStore';
import { formatNaira } from '@/features/crowdfunding/utils/crowdfundingFormatters';

export default function CreateBudgetScreen() {
  const { draft, addBudgetItem, removeBudgetItem, addMilestone, removeMilestone, addRewardTier, removeRewardTier, budgetTotalKobo } = useCampaignDraft();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');

  const total = budgetTotalKobo();
  const overGoal = total > draft.goalKobo && draft.goalKobo > 0;

  const add = () => {
    const kobo = amount ? Number(amount.replace(/[^0-9]/g, '')) * 100 : 0;
    if (!label.trim() || kobo <= 0) return;
    addBudgetItem({ id: `b${Date.now()}`, label: label.trim(), amountKobo: kobo });
    setLabel(''); setAmount('');
  };

  const showMilestones = draft.disbursementModel === 'MILESTONE';
  const showRewards = draft.type === 'REWARD';
  const valid = draft.budget.length >= 1;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <WizardHeader step={8} totalSteps={9} title="Use of funds" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.hint}>Break down how you'll spend the funds. Transparency builds trust.</Text>

          {/* Existing items */}
          {draft.budget.map((b) => (
            <View key={b.id} style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLabel}>{b.label}</Text>
                <Text style={styles.itemAmount}>{formatNaira(b.amountKobo)}</Text>
              </View>
              <Pressable onPress={() => removeBudgetItem(b.id)} hitSlop={8} accessibilityLabel={`Remove ${b.label}`}>
                <Trash2 size={18} color={Colors.error} strokeWidth={2} />
              </Pressable>
            </View>
          ))}

          {/* Add row */}
          <View style={styles.addRow}>
            <TextInput style={styles.addLabel} placeholder="Item (e.g. Surgery deposit)" placeholderTextColor={Colors.outline} value={label} onChangeText={setLabel} />
            <View style={styles.addAmountWrap}>
              <Text style={styles.naira}>₦</Text>
              <TextInput style={styles.addAmount} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="number-pad" value={amount} onChangeText={setAmount} />
            </View>
            <Pressable style={styles.addBtn} onPress={add} accessibilityLabel="Add budget item"><Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} /></Pressable>
          </View>

          {/* Totals */}
          <View style={styles.totalCard}>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Budget total</Text><Text style={styles.totalValue}>{formatNaira(total)}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Campaign goal</Text><Text style={styles.totalValue}>{formatNaira(draft.goalKobo)}</Text></View>
            {overGoal && <Text style={styles.overGoal}>Budget exceeds your goal — adjust amounts or raise the goal.</Text>}
          </View>

          {/* Conditional: milestones */}
          {showMilestones && (
            <InlineAdder
              icon={<Flag size={16} color={Colors.primary} strokeWidth={2} />}
              title="Milestones"
              hint="Define the stages at which funds release."
              items={draft.milestones.map((m) => ({ id: m.id, primary: m.title, secondary: formatNaira(m.targetKobo) }))}
              onRemove={removeMilestone}
              onAdd={(text, kobo) => addMilestone({ id: `m${Date.now()}`, title: text, targetKobo: kobo })}
              placeholder="Milestone (e.g. Secure deposit)"
            />
          )}

          {/* Conditional: reward tiers */}
          {showRewards && (
            <InlineAdder
              icon={<Gift size={16} color={'#B65A00'} strokeWidth={2} />}
              title="Reward tiers"
              hint="Offer backers a reward at each pledge level."
              items={draft.rewardTiers.map((r) => ({ id: r.id, primary: r.title, secondary: `${formatNaira(r.amountKobo)}+` }))}
              onRemove={removeRewardTier}
              onAdd={(text, kobo) => addRewardTier({ id: `r${Date.now()}`, title: text, amountKobo: kobo, description: text, requiresShipping: false })}
              placeholder="Reward (e.g. Signed poster)"
            />
          )}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Continue" onPress={() => router.push('/crowdfunding/create/preview')} disabled={!valid} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InlineAdder({ icon, title, hint, items, onRemove, onAdd, placeholder }: {
  icon: React.ReactNode; title: string; hint: string;
  items: { id: string; primary: string; secondary: string }[];
  onRemove: (id: string) => void; onAdd: (text: string, kobo: number) => void; placeholder: string;
}) {
  const [text, setText] = useState('');
  const [amt, setAmt] = useState('');
  const add = () => {
    const kobo = amt ? Number(amt.replace(/[^0-9]/g, '')) * 100 : 0;
    if (!text.trim() || kobo <= 0) return;
    onAdd(text.trim(), kobo); setText(''); setAmt('');
  };
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>{icon}<Text style={styles.sectionTitle}>{title}</Text></View>
      <Text style={styles.hint}>{hint}</Text>
      {items.map((it) => (
        <View key={it.id} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemLabel}>{it.primary}</Text>
            <Text style={styles.itemAmount}>{it.secondary}</Text>
          </View>
          <Pressable onPress={() => onRemove(it.id)} hitSlop={8} accessibilityLabel={`Remove ${it.primary}`}><Trash2 size={18} color={Colors.error} strokeWidth={2} /></Pressable>
        </View>
      ))}
      <View style={styles.addRow}>
        <TextInput style={styles.addLabel} placeholder={placeholder} placeholderTextColor={Colors.outline} value={text} onChangeText={setText} />
        <View style={styles.addAmountWrap}>
          <Text style={styles.naira}>₦</Text>
          <TextInput style={styles.addAmount} placeholder="0" placeholderTextColor={Colors.outline} keyboardType="number-pad" value={amt} onChangeText={setAmt} />
        </View>
        <Pressable style={styles.addBtn} onPress={add} accessibilityLabel={`Add ${title}`}><Plus size={20} color={Colors.onPrimary} strokeWidth={2.4} /></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  hint: { ...Typography.bodySm, color: Colors.onSurfaceVariant, marginBottom: Spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  itemLabel: { ...Typography.labelLg, color: Colors.onSurface },
  itemAmount: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  addLabel: { flex: 1, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.md, height: 52, ...Typography.bodyMd, color: Colors.onSurface },
  addAmountWrap: { flexDirection: 'row', alignItems: 'center', width: 110, backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, paddingHorizontal: Spacing.sm, height: 52 },
  naira: { ...Typography.titleMd, color: Colors.onSurfaceVariant },
  addAmount: { flex: 1, ...Typography.bodyMd, color: Colors.onSurface, padding: 0 },
  addBtn: { width: 52, height: 52, borderRadius: Radius.lg, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  totalCard: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.md, gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { ...Typography.bodyMd, color: Colors.onSurfaceVariant },
  totalValue: { ...Typography.labelLg, color: Colors.onSurface },
  overGoal: { ...Typography.labelSm, color: Colors.error, marginTop: 2 },
  section: { marginTop: Spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
