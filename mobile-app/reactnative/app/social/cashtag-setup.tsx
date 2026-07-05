import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { AtSign, CircleCheck } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import CashtagAvatar from '@/features/social/components/CashtagAvatar';
import { useMyCashtag, useSetupCashtag } from '@/features/social/hooks';
import { SocialColors, normalizeHandle, CASHTAG_REGEX } from '@/features/social/constants/social.constants';

export default function CashtagSetup() {
  const me = useMyCashtag();
  const setup = useSetupCashtag();
  const [handle, setHandle] = useState('');
  const [seeded, setSeeded] = useState(false);

  React.useEffect(() => {
    if (me.data?.handle && !seeded) { setHandle(me.data.handle.replace('@', '')); setSeeded(true); }
  }, [me.data, seeded]);

  if (me.isLoading) return <Shell><StateView kind="loading" message="Loading…" /></Shell>;
  if (me.isError) return <Shell><StateView kind="error" title="Couldn't load" actionLabel="Retry" onAction={() => me.refetch()} /></Shell>;

  const valid = CASHTAG_REGEX.test(handle);
  const preview = normalizeHandle(handle || 'yourname');

  const submit = async () => {
    if (!valid) return;
    try {
      await setup.mutateAsync(handle);
      router.back();
    } catch {
      Alert.alert('Could not save', 'That cashtag may be taken. Try another.');
    }
  };

  return (
    <Shell>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.previewCard}>
          <CashtagAvatar name={me.data?.displayName} handle={preview} color={me.data?.avatarColor ?? Colors.primary} size={56} verified />
          <Text style={styles.previewName}>{me.data?.displayName}</Text>
          <Text style={styles.previewHandle}>{preview}</Text>
        </View>

        <TextInputField
          label="Your cashtag"
          placeholder="yourname"
          autoCapitalize="none"
          autoCorrect={false}
          value={handle}
          onChangeText={setHandle}
          leftIcon={<AtSign size={18} color={SocialColors.muted} />}
        />
        <Text style={styles.hint}>3–20 characters: letters, numbers and underscore. This is your unique pay handle.</Text>

        {valid ? (
          <View style={styles.okRow}><CircleCheck size={16} color={SocialColors.ok} /><Text style={styles.okText}>{preview} looks good</Text></View>
        ) : handle.length > 0 ? (
          <Text style={styles.errText}>Use 3–20 letters, numbers or underscore.</Text>
        ) : null}

        <PrimaryButton label={me.data?.handle ? 'Update cashtag' : 'Claim cashtag'} onPress={submit} disabled={!valid} loading={setup.isPending} style={{ marginTop: Spacing.sm }} />
      </ScrollView>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Your cashtag" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, gap: Spacing.md },
  previewCard: { alignItems: 'center', gap: 6, backgroundColor: SocialColors.surface, borderRadius: Radius.lg, padding: Spacing.lg, ...shadow1 },
  previewName: { ...Typography.titleMd, color: Colors.onSurface, marginTop: Spacing.sm },
  previewHandle: { ...Typography.bodyLg, color: SocialColors.accent },
  hint: { ...Typography.bodySm, color: SocialColors.muted },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  okText: { ...Typography.bodySm, color: SocialColors.ok },
  errText: { ...Typography.bodySm, color: SocialColors.danger },
});
