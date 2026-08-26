import React, { useState } from 'react';
import PhoneNumberInput from '@/components/PhoneNumberInput';
import { ScrollView, View, Text, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';

export default function ProfileSettings() {
  const [name, setName] = useState('Adaeze Okonkwo');
  const [phone, setPhone] = useState('0803 123 4567');
  const [email, setEmail] = useState('adaeze@example.com');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Profile settings" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}><Text style={styles.initial}>{name.charAt(0)}</Text></View>
            <Pressable style={styles.camBtn} accessibilityLabel="Change photo"><Camera size={16} color={Colors.onPrimary} strokeWidth={2} /></Pressable>
          </View>

          <TextInputField label="Full name" value={name} onChangeText={setName} />
          <PhoneNumberInput label="Phone number" value={phone} onChange={({ e164, nsn }) => (setPhone)(e164 || nsn)} />
          <TextInputField label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Save changes" onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  avatarWrap: { alignSelf: 'center', marginBottom: Spacing.lg },
  avatar: { width: 88, height: 88, borderRadius: Radius.full, backgroundColor: Colors.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  initial: { ...Typography.headlineMd, color: Colors.primary },
  camBtn: { position: 'absolute', bottom: 0, right: 0, width: 32, height: 32, borderRadius: Radius.full, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.background },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
