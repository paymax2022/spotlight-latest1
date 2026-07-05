import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Icons from 'lucide-react-native';
import { Copy, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { DisclosureCard } from '@/features/referral/components';
import { useCreativeAssets } from '@/features/referral/ambassador/hooks';
import type { CreativeAsset } from '@/features/referral/ambassador/types';

// M-AMB-02 — Creative toolkit: banners, captions, vanity links, assets.
const KIND_LABEL: Record<string, string> = {
  banner: 'Banner', caption: 'Caption', vanity_link: 'Vanity link', video: 'Video',
};

export default function CreativeToolkitScreen() {
  const { data, isLoading, isError, refetch } = useCreativeAssets();
  const [copied, setCopied] = React.useState<string | null>(null);

  const onCopy = (a: CreativeAsset) => {
    setCopied(a.id);
    setTimeout(() => setCopied((c) => (c === a.id ? null : c)), 1500);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Creative toolkit" />
      {isLoading ? (
        <StateView kind="loading" message="Loading assets…" />
      ) : isError ? (
        <StateView kind="error" title="Couldn't load" message="Please try again." actionLabel="Retry" onAction={refetch} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <DisclosureCard
            tone="warn"
            title="Share approved assets only"
            body="Only assets marked approved are compliant. Never add income promises or exaggerated earning claims to any asset."
          />
          {data && data.length > 0 ? (
            data.map((a) => {
              const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[a.icon] ?? Icons.Image;
              return (
                <View key={a.id} style={styles.card}>
                  <View style={styles.head}>
                    <View style={styles.icon}><Icon size={20} color={Colors.primary} strokeWidth={2} /></View>
                    <View style={styles.headText}>
                      <Text style={styles.title} numberOfLines={1}>{a.title}</Text>
                      <Text style={styles.kind}>{KIND_LABEL[a.kind] ?? a.kind}</Text>
                    </View>
                    <View style={[styles.statusPill, a.approved ? styles.approved : styles.pending]}>
                      <Text style={[styles.statusText, { color: a.approved ? Colors.tertiaryContainer : Colors.onWarning }]}>{a.approved ? 'Approved' : 'In review'}</Text>
                    </View>
                  </View>
                  {a.content ? (
                    <View style={styles.contentBox}>
                      <Text style={styles.content} numberOfLines={4}>{a.content}</Text>
                      <Pressable
                        style={[styles.copyBtn, !a.approved && styles.copyDisabled]}
                        onPress={() => a.approved && onCopy(a)}
                        disabled={!a.approved}
                        accessibilityRole="button"
                      >
                        {copied === a.id ? <Check size={15} color={Colors.tertiaryContainer} strokeWidth={2.4} /> : <Copy size={15} color={Colors.primary} strokeWidth={2} />}
                        <Text style={styles.copyText}>{copied === a.id ? 'Copied' : 'Copy'}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.placeholder}><Text style={styles.placeholderText}>Tap to preview / download asset</Text></View>
                  )}
                </View>
              );
            })
          ) : (
            <StateView kind="empty" icon="Image" title="No assets yet" message="Approved creatives appear here." compact />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: Spacing.containerMargin, paddingBottom: 60, gap: Spacing.md },
  card: { backgroundColor: Colors.surfaceContainerLowest, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceContainerHigh, padding: Spacing.md, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: Colors.iconBgPurple, alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1 },
  title: { ...Typography.labelLg, color: Colors.onSurface },
  kind: { ...Typography.caption, color: Colors.onSurfaceVariant },
  statusPill: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.full },
  approved: { backgroundColor: Colors.iconBgTeal },
  pending: { backgroundColor: Colors.iconBgGold },
  statusText: { ...Typography.labelSm, fontWeight: '700' as const },
  contentBox: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, padding: Spacing.sm, gap: Spacing.sm },
  content: { ...Typography.bodySm, color: Colors.onSurface },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  copyDisabled: { opacity: 0.4 },
  copyText: { ...Typography.labelSm, color: Colors.primary, fontWeight: '700' as const },
  placeholder: { backgroundColor: Colors.surfaceContainerLow, borderRadius: Radius.md, paddingVertical: Spacing.lg, alignItems: 'center' },
  placeholderText: { ...Typography.caption, color: Colors.onSurfaceVariant },
});
