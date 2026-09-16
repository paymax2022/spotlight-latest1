import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link2, Copy, Check, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { showToast } from '@/store/toastStore';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import TextInputField from '@/components/TextInputField';
import PrimaryButton from '@/components/PrimaryButton';
import { DisclosureCard } from '@/features/referral/components';
import { useVanityLinks, useCreateVanityLink } from '@/features/referral/invite/hooks';
import type { VanityLink } from '@/features/referral/invite/types';

// M-INV-05 — Custom / vanity link & UTM source tags.
async function copyText(value: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    if (Clipboard?.setStringAsync) { await Clipboard.setStringAsync(value); return true; }
  } catch { /* fall through */ }
  try { await Share.share({ message: value }); return true; } catch { return false; }
}

export default function VanityLinkScreen() {
  const { data, isLoading, isError, refetch } = useVanityLinks();
  const create = useCreateVanityLink();
  const [alias, setAlias] = useState('');
  const [source, setSource] = useState('');
  const [campaign, setCampaign] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const aliasError = alias.length > 0 && !/^[a-zA-Z0-9-]{3,30}$/.test(alias)
    ? '3–30 letters, numbers or hyphens'
    : undefined;

  const onCreate = () => {
    if (!alias || aliasError) return;
    create.mutate(
      { alias, source: source || undefined, campaign: campaign || undefined },
      {
        onSuccess: () => { setAlias(''); setSource(''); setCampaign(''); },
        // Without this a failed create just left the form untouched, which reads
        // as "nothing happened" rather than "that didn't save".
        onError: () =>
          showToast({
            variant: 'error',
            title: 'Could not create that link',
            message: 'Check the alias and try again.',
          }),
      },
    );
  };

  const onCopy = async (link: VanityLink) => {
    const ok = await copyText(link.url);
    if (ok) { setCopiedId(link.id); setTimeout(() => setCopiedId(null), 1800); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Custom link" />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <DisclosureCard tone="info" body="Branded links and source tags help you see which channel actually brings real, active users." />

        <View style={styles.form}>
          <TextInputField label="Link alias" placeholder="e.g. chidi-lagos" value={alias} onChangeText={setAlias} autoCapitalize="none" error={aliasError} leftIcon={<Link2 size={16} color={Colors.onSurfaceVariant} strokeWidth={2} />} />
          <TextInputField label="Source (optional)" placeholder="e.g. instagram" value={source} onChangeText={setSource} autoCapitalize="none" />
          <TextInputField label="Campaign (optional)" placeholder="e.g. summer" value={campaign} onChangeText={setCampaign} autoCapitalize="none" />
          <PrimaryButton label="Create link" onPress={onCreate} disabled={!alias || !!aliasError} loading={create.isPending} />
        </View>

        <Text style={styles.sectionTitle}>Your links</Text>
        {isLoading ? (
          <StateView kind="loading" compact message="Loading links…" />
        ) : isError ? (
          <StateView kind="error" compact message="Couldn't load links." actionLabel="Retry" onAction={refetch} />
        ) : !data || data.length === 0 ? (
          <StateView kind="empty" compact icon="Link2" title="No custom links yet" message="Create one above to start tracking by source." />
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {data.map((l) => (
              <View key={l.id} style={styles.linkCard}>
                <View style={styles.linkHead}>
                  <Text style={styles.linkUrl} numberOfLines={1}>{l.url}</Text>
                  <Pressable onPress={() => onCopy(l)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy link">
                    {copiedId === l.id ? <Check size={18} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : <Copy size={18} color={Colors.primary} strokeWidth={2} />}
                  </Pressable>
                </View>
                <View style={styles.tagRow}>
                  {l.source && <Tag label={`source: ${l.source}`} />}
                  {l.campaign && <Tag label={`campaign: ${l.campaign}`} />}
                </View>
                <View style={styles.statRow}>
                  <TrendingUp size={14} color={Colors.onSurfaceVariant} strokeWidth={2} />
                  <Text style={styles.statText}>{l.clicks} clicks · {l.signups} signups</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tag({ label }: { label: string }) {
  return <View style={styles.tag}><Text style={styles.tagText}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 80, gap: Spacing.md },
  form: { gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: Colors.onSurface },
  linkCard: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: 8 },
  linkHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  linkUrl: { ...Typography.bodyMd, color: Colors.onSurface, flex: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  tagText: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statText: { ...Typography.bodySm, color: Colors.onSurfaceVariant },
});
