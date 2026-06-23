import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import ToggleRow from '@/features/doctor/components/ToggleRow';
import SummaryRow from '@/features/fx/components/SummaryRow';
import { useApiKeys, useRotateApiKey, useWebhookSettings, useToggleWebhook } from '@/features/fx/hooks/useFxAccount';
import { relativeTime } from '@/features/fx/utils/fxFormatters';

export default function DeveloperScreen() {
  const keys = useApiKeys();
  const rotate = useRotateApiKey();
  const webhooks = useWebhookSettings();
  const toggle = useToggleWebhook();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Developer" subtitle="API keys & webhooks" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={styles.section}>API keys</Text>
        {keys.isLoading ? <StateView kind="loading" compact /> : (keys.data ?? []).map((k) => (
          <View key={k.id} style={styles.card}>
            <View style={styles.keyHead}>
              <View>
                <Text style={styles.keyLabel}>{k.label}</Text>
                <View style={[styles.modePill, { backgroundColor: k.mode === 'live' ? Colors.iconBgTeal : Colors.iconBgBlue }]}>
                  <Text style={[styles.modeText, { color: k.mode === 'live' ? Colors.tertiaryContainer : Colors.secondary }]}>{k.mode}</Text>
                </View>
              </View>
              <Pressable style={styles.rotateBtn} onPress={() => rotate.mutate(k.id)} accessibilityRole="button" accessibilityLabel={`Rotate ${k.label} key`}>
                <RefreshCw size={15} color={Colors.secondary} strokeWidth={2} />
                <Text style={styles.rotateText}>Rotate</Text>
              </Pressable>
            </View>
            <SummaryRow label="Key" value={`${k.prefix}••••••••`} copyable />
            <SummaryRow label="Last used" value={k.lastUsed ? relativeTime(k.lastUsed) : 'Never'} />
          </View>
        ))}

        <Text style={styles.section}>Webhook endpoints</Text>
        {webhooks.isLoading ? <StateView kind="loading" compact /> : (webhooks.data ?? []).map((w) => (
          <View key={w.id} style={styles.card}>
            <SummaryRow label="URL" value={w.url} copyable />
            <Text style={styles.events}>Events: {w.events.join(', ')}</Text>
            <View style={styles.toggleWrap}>
              <ToggleRow label="Deliver events" description={w.enabled ? 'Active' : 'Paused'} value={w.enabled} onValueChange={(v) => toggle.mutate({ id: w.id, enabled: v })} />
            </View>
          </View>
        ))}
        <Text style={styles.note}>Webhooks are signed with Paymax-Signature and retried with backoff. Full secrets are shown once on creation only.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.containerMargin, paddingBottom: Spacing.xxl },
  section: { ...Typography.labelMd, color: Colors.onSurfaceVariant, marginTop: Spacing.md, marginBottom: Spacing.sm },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, marginBottom: Spacing.sm },
  keyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.xs },
  keyLabel: { ...Typography.labelLg, color: Colors.onSurface },
  modePill: { alignSelf: 'flex-start', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2, marginTop: 4 },
  modeText: { ...Typography.caption, fontWeight: '600', textTransform: 'uppercase' },
  rotateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: Colors.secondary, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  rotateText: { ...Typography.labelMd, color: Colors.secondary },
  events: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginVertical: Spacing.xs },
  toggleWrap: { marginHorizontal: -Spacing.sm },
  note: { ...Typography.labelSm, color: Colors.onSurfaceVariant, marginTop: Spacing.sm },
});
