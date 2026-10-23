import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import * as Icons from 'lucide-react-native';
import PrimaryButton from '@/components/PrimaryButton';
import { Colors, Radius, Spacing, Typography } from '@/constants/tokens';
import { HomeMenuButton } from '@/components/HomeMenu';
import { toFoodError } from '@/features/food/utils';
import { DISPUTE_TYPES, DISPUTE_MIN_DESCRIPTION, raiseOrderDispute, attachDisputeEvidence } from '@/features/food/disputeApi';

// FOOD-UAT-F-008: customer-facing complaint entry for a delivered order.
export default function DisputeOrderScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [type, setType] = useState<string>(DISPUTE_TYPES[0].value);
  const [description, setDescription] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = description.trim().length < DISPUTE_MIN_DESCRIPTION;

  const onSubmit = async () => {
    if (!orderId || tooShort || busy) return;
    setBusy(true);
    try {
      const d = await raiseOrderDispute(orderId, type, description);
      if (evidenceUrl.trim()) {
        try {
          await attachDisputeEvidence(d.id, evidenceUrl);
        } catch (e) {
          Alert.alert('Complaint sent', `Your complaint was filed, but the photo link could not be attached: ${toFoodError(e).message}`);
          goBack('/food/orders');
          return;
        }
      }
      Alert.alert('Complaint sent', "We've opened a dispute and will review it shortly.");
      goBack('/food/orders');
    } catch (e) {
      Alert.alert('Could not send complaint', toFoodError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.topBar}>
        <Pressable onPress={() => goBack('/food/orders')} style={s.iconButton} accessibilityLabel="Go back">
          <Icons.ArrowLeft size={22} color={Colors.primary} strokeWidth={2.2} />
        </Pressable>
        <Text style={s.topTitle}>Report a problem</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <View style={s.iconButton} />
          <HomeMenuButton />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>What went wrong?</Text>
        {DISPUTE_TYPES.map((t) => (
          <Pressable
            key={t.value}
            onPress={() => setType(t.value)}
            style={[s.option, type === t.value && s.optionOn]}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === t.value }}
          >
            <Text style={[s.optionText, type === t.value && s.optionTextOn]}>{t.label}</Text>
          </Pressable>
        ))}

        <Text style={s.label}>Tell us more</Text>
        <TextInput
          style={s.input}
          multiline
          value={description}
          onChangeText={setDescription}
          placeholder="Describe the problem (at least 20 characters)"
          placeholderTextColor={Colors.onSurfaceVariant}
        />
        <Text style={s.hint}>{description.trim().length}/{DISPUTE_MIN_DESCRIPTION} minimum</Text>

        <Text style={s.label}>Photo link (optional)</Text>
        <TextInput
          style={[s.input, { minHeight: 48 }]}
          value={evidenceUrl}
          onChangeText={setEvidenceUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://…"
          placeholderTextColor={Colors.onSurfaceVariant}
        />

        <PrimaryButton label="Submit complaint" onPress={onSubmit} loading={busy} disabled={tooShort || busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topBar: { height: 64, paddingHorizontal: Spacing.containerMargin, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: Colors.surfaceContainerHigh },
  iconButton: { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceContainerLow },
  topTitle: { ...Typography.titleLg, color: Colors.primary },
  content: { padding: Spacing.containerMargin, gap: Spacing.sm },
  label: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.md },
  option: { padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, backgroundColor: Colors.surfaceContainerLowest },
  optionOn: { borderColor: Colors.primary, backgroundColor: Colors.surfaceContainerLow },
  optionText: { ...Typography.bodyMd, color: Colors.onSurface },
  optionTextOn: { color: Colors.primary, fontWeight: '600' },
  input: { minHeight: 110, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, borderRadius: Radius.md, padding: Spacing.md, color: Colors.onSurface, textAlignVertical: 'top', backgroundColor: Colors.surfaceContainerLowest },
  hint: { ...Typography.labelSm, color: Colors.onSurfaceVariant },
});
