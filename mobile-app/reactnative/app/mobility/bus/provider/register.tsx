import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { STATE_NAMES } from '@/data/nigeria';
import { useRegisterProvider } from '@/features/mobility/hooks/useBusMarketplace';

export default function BusProviderRegisterScreen() {
  const [businessName, setBusinessName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [baseState, setBaseState] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const register = useRegisterProvider();

  const canSubmit =
    businessName.trim().length > 1 && contactPhone.trim().length >= 7 && Boolean(baseState);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      await register.mutateAsync({
        businessName: businessName.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim() || undefined,
        baseState,
        description: description.trim() || undefined,
      });
      router.replace('/mobility/bus/provider');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not register your business. Please try again.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Become a provider" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.note}>List your interstate bus business on the marketplace. Registration is free — you only pay nothing to publish; customers pay when they book a seat.</Text>
          <TextInputField label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="e.g. GIG Mobility" autoCapitalize="words" />
          <TextInputField label="Contact phone" value={contactPhone} onChangeText={setContactPhone} placeholder="+234…" keyboardType="phone-pad" />
          <TextInputField label="Contact email (optional)" value={contactEmail} onChangeText={setContactEmail} placeholder="ops@business.com" keyboardType="email-address" autoCapitalize="none" />
          <SelectField label="Base state" placeholder="Where you operate from" value={baseState} options={STATE_NAMES} onChange={setBaseState} />
          <TextInputField label="Description (optional)" value={description} onChangeText={setDescription} placeholder="Tell customers about your fleet & service" multiline numberOfLines={3} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="Register business" onPress={onSubmit} disabled={!canSubmit} loading={register.isPending} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.outlineVariant },
  note: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, lineHeight: 22, marginBottom: Spacing.md },
  error: { ...Typography.labelSm, color: Colors.error, marginTop: Spacing.xs },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.outlineVariant, backgroundColor: Colors.surfaceContainerLowest },
});
