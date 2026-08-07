import React from 'react';
import { Tabs } from 'expo-router';
import { Colors } from '@/constants/colors';
import { MarketplaceMenuProvider } from '@/features/marketplace/components/MarketplaceMenu';
import MarketTabBar from '@/features/marketplace/components/MarketTabBar';
import { useMarketplaceRealtime } from '@/features/marketplace/realtime/useMarketplaceRealtime';

// ── Marketplace nav shell ────────────────────────────────────────────────────
// The 3-tab bottom nav inside the Marketplace tab (connect model):
//   [ Discover ] [ Sell ] [ Deals ]
//
// The Deals tab is the conversation list (chat inbox). The old escrow "Orders"
// tab is gone — the connect model has no orders, so active deals ARE the
// conversations under Deals. Account + secondary pages live in the hamburger.
//
// Expo Router renders every route under app/marketplace/* through this layout.
// The three entries below are the bottom-nav tabs; every other route (detail
// screens like listing/[id], seller/[id], the Discover sub-screens search/
// results/map/category, and boost/[listingId]) is registered with `href: null`
// so it participates in this navigator (deep-linkable, stack-pushable) WITHOUT
// showing a tab-bar button.
//
// The footer itself is a CUSTOM bar (MarketTabBar) that draws exactly the four
// canonical tabs and ignores every other route in this navigator — so detail
// and account sub-pages can never leak a broken button into the footer. The
// `href: null` registrations below are kept purely as belt-and-suspenders (and
// to document intent); the custom bar is what guarantees the layout.

export default function MarketplaceLayout() {
  // Realtime SSE push for Deal Room chat. Single mount for the whole marketplace
  // section; inert unless EXPO_PUBLIC_REALTIME_ENABLED=true (falls back to polling).
  useMarketplaceRealtime();

  return (
    <MarketplaceMenuProvider>
    <Tabs
      tabBar={(props) => <MarketTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      {/* ── The four bottom-nav tabs (Account + secondary pages live in the
          hamburger side menu — see @/features/marketplace/components/MarketplaceMenu) ── */}
      <Tabs.Screen name="index" options={{ title: 'Discover' }} />
      <Tabs.Screen name="sell" options={{ title: 'Sell' }} />
      <Tabs.Screen name="deals" options={{ title: 'Deals' }} />

      {/* ── Account + sub-pages: reachable from the hamburger menu, not tabs ── */}
      <Tabs.Screen name="account" options={{ href: null }} />
      <Tabs.Screen name="account/blocked" options={{ href: null }} />
      <Tabs.Screen name="account/help" options={{ href: null }} />
      <Tabs.Screen name="account/notifications" options={{ href: null }} />
      <Tabs.Screen name="account/following" options={{ href: null }} />
      <Tabs.Screen name="account/report" options={{ href: null }} />

      {/* ── Discover sub-screens (not tabs; pushed from Discover) ── */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="results" options={{ href: null }} />
      <Tabs.Screen name="map" options={{ href: null }} />
      <Tabs.Screen name="saved-items" options={{ href: null }} />
      <Tabs.Screen name="saved-searches" options={{ href: null }} />
      <Tabs.Screen name="listing/[id]" options={{ href: null }} />
      <Tabs.Screen name="seller/[id]" options={{ href: null }} />
      <Tabs.Screen name="category/[id]" options={{ href: null }} />

      {/* ── Detail routes (not tabs; deep-linkable) ── */}
      <Tabs.Screen name="sell/compose" options={{ href: null }} />
      <Tabs.Screen name="sell/edit/[id]" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="deals/[threadId]" options={{ href: null }} />
      <Tabs.Screen name="boost/[listingId]" options={{ href: null }} />
    </Tabs>
    </MarketplaceMenuProvider>
  );
}
