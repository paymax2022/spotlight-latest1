import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Megaphone, Bell, Mail } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import StateView from '@/components/StateView';
import { useBroadcast } from '@/features/crowdfunding/hooks/useExtras';

export default function BroadcastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const broadcast = useBroadcast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(true);
  const [sent, setSent] = useState<number | null>(null);

  const valid = subject.trim().length > 3 && body.trim().length > 10 && (push || email);

  const submit = () => {
    broadcast.mutate(
      { campaignId: id, subject: subject.trim(), body: body.trim(), channelPush: push, channelEmail: email },
      { onSuccess: (res) => setSent(res.recipients) },
    );
  };

  if (sent != null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title="Message sent" showBack={false} />
        <StateView kind="empty" icon="MailCheck" title="Message sent" message={`Your message was delivered to ${sent.toLocaleString('en-NG')} contributors.`} actionLabel="Done" onAction={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Message contributors" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.banner}>
            <Megaphone size={16} color={Colors.primary} strokeWidth={2} />
            <Text style={styles.bannerText}>Send a one-time message to everyone who has backed this campaign. Keep it relevant — spam isn't allowed.</Text>
          </View>

          <TextInputField label="Subject" placeholder="e.g. We reached our first milestone!" value={subject} onChangeText={setSubject} />

          <Text style={styles.label}>Message</Text>
          <TextInput style={styles.editor} placeholder="Write your message to contributors…" placeholderTextColor={Colors.outline} value={body} onChangeText={setBody} multiline textAlignVertical="top" />

          <Text style={[styles.label, { marginTop: Spacing.lg }]}>Send via</Text>
          <Channel icon={<Bell size={18} color={Colors.primary} strokeWidth={2} />} label="Push notification" on={push} onToggle={() => setPush((v) => !v)} />
          <Channel icon={<Mail size={18} color={Colors.secondary} strokeWidth={2} />} label="Email" on={email} onToggle={() => setEmail((v) => !v)} />
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Send to contributors" onPress={submit} disabled={!valid} loading={broadcast.isPending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Channel({ icon, label, on, onToggle }: { icon: React.ReactNode; label: string; on: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.channel} onPress={onToggle} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <View style={styles.channelIcon}>{icon}</View>
      <Text style={styles.channelLabel}>{label}</Text>
      <View style={[styles.switch, on && styles.switchOn]}><View style={[styles.knob, on && styles.knobOn]} /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  body: { paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  banner: { flexDirection: 'row', gap: Spacing.sm, backgroundColor: Colors.iconBgPurple, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  bannerText: { ...Typography.bodySm, color: Colors.onSurface, flex: 1 },
  label: { ...Typography.labelMd, color: Colors.onSurface, marginBottom: Spacing.sm },
  editor: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.lg, padding: Spacing.md, minHeight: 120, ...Typography.bodyMd, color: Colors.onSurface },
  channel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  channelIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  channelLabel: { ...Typography.labelLg, color: Colors.onSurface, flex: 1 },
  switch: { width: 48, height: 28, borderRadius: Radius.full, backgroundColor: Colors.surfaceContainerHighest, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: Colors.secondary },
  knob: { width: 22, height: 22, borderRadius: Radius.full, backgroundColor: Colors.white },
  knobOn: { alignSelf: 'flex-end' },
  footer: { paddingHorizontal: Spacing.containerMargin, paddingBottom: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.surfaceContainerHigh },
});
