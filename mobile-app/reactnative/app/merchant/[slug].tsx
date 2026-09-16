import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Store, PackageOpen, LockKeyhole } from 'lucide-react-native';

import ScreenHeader from '@/components/ScreenHeader';
import StateView from '@/components/StateView';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { useCapabilities } from '@/features/merchant/hooks/useMerchant';
import { resolveWorkspace } from '@/features/merchant/workspace';

/**
 * The route the server has been handing out all along.
 *
 * On approval the onboarding service writes
 * `workspace_route = "/merchant/<merchant-type-slug>"`, and every capability row
 * links there — but the route did not exist, because `app/(merchant)` is a route
 * GROUP and parentheses are not a path segment. Approved merchants tapped their
 * capability and landed nowhere.
 *
 * This resolves the slug against the caller's own capabilities and forwards them
 * to the tools for that merchant type. It is a junction, not a destination:
 * `router.replace` keeps it out of the back stack, so Back from Manage Store
 * returns where the merchant came from rather than bouncing through here.
 */
export default function MerchantWorkspaceScreen() {
  const { slug: rawSlug } = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof rawSlug === 'string' ? rawSlug : '';
  const caps = useCapabilities();

  const resolution = caps.data ? resolveWorkspace(slug, caps.data.merchants) : null;
  const target = resolution?.kind === 'workspace' ? resolution.route : null;

  // Forward in an effect, never during render — navigating while rendering warns
  // and can fire twice under Strict Mode.
  useEffect(() => {
    if (target) router.replace(target as never);
  }, [target]);

  if (caps.isLoading) {
    return (
      <Shell>
        <StateView kind="loading" title="Opening your workspace" />
      </Shell>
    );
  }

  if (caps.isError) {
    return (
      <Shell>
        <StateView
          kind="error"
          title="Couldn’t load your account"
          message="We couldn’t check which businesses you manage."
          actionLabel="Retry"
          onAction={() => caps.refetch()}
        />
      </Shell>
    );
  }

  // Forwarding: show a spinner for the frame between the effect and the replace,
  // rather than flashing an empty screen.
  if (target) {
    return (
      <Shell>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </Shell>
    );
  }

  if (resolution?.kind === 'not-built') {
    return (
      <Shell>
        <Empty
          icon={<PackageOpen size={30} color={Colors.onSurfaceVariant} strokeWidth={1.8} />}
          title={`${resolution.label} tools are on the way`}
          body={`Your ${resolution.label.toLowerCase()} is approved and active. The screens for managing it aren’t in the app yet — we’ll let you know the moment they land.`}
          primary={{ label: 'Back to my businesses', to: '/(merchant)' }}
        />
      </Shell>
    );
  }

  if (resolution?.kind === 'not-a-merchant') {
    return (
      <Shell>
        <Empty
          icon={<LockKeyhole size={30} color={Colors.onSurfaceVariant} strokeWidth={1.8} />}
          title={`You don’t manage a ${resolution.label.toLowerCase()} yet`}
          // Deliberately not phrased as a permission error: the usual reason is
          // an application still in review, or a link opened on the wrong account.
          body="If you’ve applied, this opens as soon as it’s approved. You can check the status of your applications, or apply now."
          primary={{ label: 'My businesses', to: '/(merchant)' }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Empty
        icon={<Store size={30} color={Colors.onSurfaceVariant} strokeWidth={1.8} />}
        title="Workspace not found"
        body="That link doesn’t point to a business we recognise. It may be from an older version of the app."
        primary={{ label: 'My businesses', to: '/(merchant)' }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="Business" />
      {children}
    </SafeAreaView>
  );
}

function Empty({
  icon, title, body, primary,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  primary: { label: string; to: string };
}) {
  return (
    <View style={styles.body}>
      <View style={styles.iconWrap}>{icon}</View>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.bodyText}>{body}</Text>
      <Pressable
        style={styles.primaryBtn}
        onPress={() => router.replace(primary.to as never)}
        accessibilityRole="button"
        accessibilityLabel={primary.label}
      >
        <Text style={styles.primaryText}>{primary.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  iconWrap: {
    width: 68, height: 68, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerLow, marginBottom: Spacing.sm,
  },
  title: { ...Typography.headlineMd, color: Colors.onSurface, textAlign: 'center' },
  bodyText: { ...Typography.bodyMd, color: Colors.onSurfaceVariant, textAlign: 'center', marginBottom: Spacing.lg },
  primaryBtn: {
    height: 48, borderRadius: Radius.full, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch',
  },
  primaryText: { ...Typography.labelLg, color: Colors.onPrimary },
});
