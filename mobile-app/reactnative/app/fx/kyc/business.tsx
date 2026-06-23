import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import ScreenHeader from '@/components/ScreenHeader';
import PrimaryButton from '@/components/PrimaryButton';
import TextInputField from '@/components/TextInputField';
import SelectField from '@/components/SelectField';
import { kycDraft } from '@/features/fx/utils/kycDraft';
import { BUSINESS_TYPES } from '@/features/fx/constants/fx.constants';

export default function KybBusinessScreen() {
  const b = kycDraft.current.business;
  const [legalName, setLegalName] = useState(b.legalName);
  const [rcNumber, setRcNumber] = useState(b.rcNumber);
  const [businessType, setBusinessType] = useState(b.businessType || BUSINESS_TYPES[0]);
  const [country, setCountry] = useState(b.country || 'Nigeria');
  const [address, setAddress] = useState(b.address);

  const ready = legalName.trim() && rcNumber.trim() && address.trim();

  const next = () => {
    kycDraft.current.business = { legalName, rcNumber, businessType, country, address };
    router.push('/fx/kyc/directors');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Business details" subtitle="KYB · 1 of 3" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TextInputField label="Registered legal name" value={legalName} onChangeText={setLegalName} placeholder="e.g. Acme Technologies Ltd" autoCapitalize="words" />
          <TextInputField label="Registration / RC number" value={rcNumber} onChangeText={setRcNumber} placeholder="e.g. RC-1234567" autoCapitalize="characters" />
          <SelectField label="Business type" value={businessType} options={BUSINESS_TYPES} searchable={false} onChange={setBusinessType} />
          <TextInputField label="Country of incorporation" value={country} onChangeText={setCountry} placeholder="Country" autoCapitalize="words" />
          <TextInputField label="Registered address" value={address} onChangeText={setAddress} placeholder="Street, city, state" autoCapitalize="words" multiline />
        </ScrollView>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <PrimaryButton label="Continue" onPress={next} disabled={!ready} />
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.containerMargin },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
});
