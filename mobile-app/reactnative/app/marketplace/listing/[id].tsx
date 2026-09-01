// ── Screen 6 — Listing Detail ────────────────────────────────────────────────
// The conversion moment. Photo gallery, fair-price chip (server-computed band),
// PERMANENT seller trust card (never boost-gated), schema-driven attribute table,
// description, a fixed off-platform safety nudge (Paymax connects, never holds
// funds), and CTAs: Contact seller (opens the Deal Room) with Make Offer as a
// non-binding price proposal, plus tertiary tap-to-reveal Call. Sold/expired
// shows a banner over a dimmed gallery, never a 404.
import React, { useEffect, useState } from 'react';
import { Linking, View, Text, StyleSheet, Pressable, ScrollView, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/navigation';
import { ArrowLeft, Heart, Flag, ShieldAlert, Phone, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Typography } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radius } from '@/constants/radius';
import { shadow1 } from '@/constants/shadows';
import StateView from '@/components/StateView';
import PrimaryButton from '@/components/PrimaryButton';
import { useAuthStore } from '@/store/authStore';
import { revealSellerContact } from '@/features/marketplace/api/sell.api';
import { MarketColors, formatNaira, conditionLabel, fairPriceVerdict, FAIR_PRICE_LABEL, MEETUP_SAFETY_NUDGE } from '@/features/marketplace';
import { useListing } from '@/features/marketplace/hooks';
import * as accountApi from '@/features/marketplace/api/account.api';
import SellerTrustCard from '@/features/marketplace/components/SellerTrustCard';

const { width } = Dimensions.get('window');

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useListing(id!);
  const [saved, setSaved] = useState(false);
  const [revealedPhone, setRevealedPhone] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const currentUserId = useAuthStore((st) => st.user?.id);
  const [gallery, setGallery] = useState(0);

  // Reflect the server's saved state once the listing loads (hook stays above the
  // early returns so it runs unconditionally).
  useEffect(() => {
    if (listing.data) setSaved(Boolean(listing.data.savedByMe));
  }, [listing.data?.id]);

  if (listing.isLoading && !listing.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StateView kind="loading" message="Loading listing…" />
      </SafeAreaView>
    );
  }
  if (listing.isError || !listing.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.topRow}><Pressable onPress={() => goBack('/marketplace')} hitSlop={10}><ArrowLeft size={22} color={Colors.onSurface} /></Pressable></View>
        <StateView kind="error" title="Couldn't load listing" actionLabel="Retry" onAction={() => listing.refetch()} />
      </SafeAreaView>
    );
  }

  const l = listing.data;
  // Ownership decides which half of this screen a viewer gets.
  const isOwnListing = !!currentUserId && l.sellerId === currentUserId;

  // Reveal, then dial. A revealed number stays on screen rather than opening the
  // dialer immediately: the viewer asked to SEE it, and a second tap to call is
  // cheaper than an accidental call.
  const onRevealPhone = async () => {
    if (revealedPhone) {
      Linking.openURL(`tel:${revealedPhone.replace(/[^0-9+]/g, '')}`).catch(() => {});
      return;
    }
    setRevealing(true);
    setRevealError(null);
    try {
      const contact = await revealSellerContact(l.id);
      setRevealedPhone(contact.phone);
    } catch (err) {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })
        ?.response?.data?.error?.code;
      setRevealError(
        code === 'CONTACT_REVEAL_LIMIT'
          ? 'Too many numbers revealed this hour — try again later'
          : code === 'SELLER_HAS_NO_PHONE'
            ? 'This seller has not added a phone number'
            : "Couldn't reveal the number — tap to retry",
      );
    } finally {
      setRevealing(false);
    }
  };
  const media = l.media ?? [];
  const unavailable = l.status === 'sold' || l.status === 'expired' || l.status === 'removed_policy' || l.status === 'removed_user';
  const verdict = fairPriceVerdict(l.priceKobo, l.fairPriceBand);
  const attrs = Object.entries(l.attrs ?? {});

  // Wishlist toggle — optimistic local state, backed by the account API, reverts
  // on error so the heart never lies about the server outcome.
  const toggleSave = async () => {
    const next = !saved;
    setSaved(next);
    try {
      if (next) await accountApi.saveListing(l.id);
      else await accountApi.unsaveListing(l.id);
    } catch {
      setSaved(!next);
    }
  };

  const openReport = () =>
    router.push(
      `/marketplace/account/report?targetType=listing&targetId=${l.id}&targetName=${encodeURIComponent(l.title)}&sellerId=${l.sellerId}` as never,
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Floating top bar */}
      <View style={styles.topBar}>
        <Pressable style={styles.roundBtn} onPress={() => goBack('/marketplace')} hitSlop={8} accessibilityLabel="Back"><ArrowLeft size={20} color={Colors.onSurface} /></Pressable>
        <View style={styles.topBarRight}>
          <Pressable style={styles.roundBtn} onPress={toggleSave} hitSlop={8} accessibilityLabel="Save listing">
            <Heart size={18} color={saved ? MarketColors.danger : Colors.onSurface} fill={saved ? MarketColors.danger : 'transparent'} />
          </Pressable>
          <Pressable style={styles.roundBtn} onPress={openReport} hitSlop={8} accessibilityLabel="Report listing"><Flag size={18} color={Colors.onSurface} /></Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Gallery */}
        <View style={[styles.gallery, unavailable && styles.galleryDimmed]}>
          {media.length > 0 ? (
            <>
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setGallery(Math.round(e.nativeEvent.contentOffset.x / width))}>
                {media.map((m) => (
                  <View key={m.id} style={styles.slide}>
                    {m.urlFull ? <Image source={{ uri: m.urlFull }} style={StyleSheet.absoluteFill} /> : <View style={styles.slidePlaceholder} />}
                  </View>
                ))}
              </ScrollView>
              {media.length > 1 ? (
                <View style={styles.dots}>{media.map((_, i) => <View key={i} style={[styles.dot, i === gallery && styles.dotActive]} />)}</View>
              ) : null}
            </>
          ) : (
            <View style={styles.slidePlaceholder} />
          )}
          {unavailable ? (
            <View style={styles.soldBanner}><Text style={styles.soldBannerText}>{l.status === 'sold' ? 'Sold' : 'No longer available'}</Text></View>
          ) : null}
        </View>

        <View style={styles.body}>
          {/* Title + price + fair-price chip */}
          <Text style={styles.title}>{l.title}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatNaira(l.priceKobo)}</Text>
            {verdict !== 'unknown' ? (
              <View style={[styles.fairChip, verdict === 'above' && styles.fairChipWarn, verdict === 'below' && styles.fairChipGood]}>
                <Text style={[styles.fairChipText, verdict === 'above' && styles.fairChipTextWarn]}>{FAIR_PRICE_LABEL[verdict]}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.meta}>{conditionLabel(l.condition)} · {l.lga ? `${l.lga}, ${l.state}` : l.state}</Text>

          {/* Seller trust card (permanent badges) */}
          {l.seller ? (
            <View style={styles.section}>
              <SellerTrustCard seller={l.seller} onPress={() => router.push(`/marketplace/seller/${l.sellerId}` as never)} />
            </View>
          ) : null}

          {/* Attribute table (schema-driven) */}
          {attrs.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Details</Text>
              <View style={styles.attrTable}>
                {attrs.map(([k, v]) => (
                  <View key={k} style={styles.attrRow}>
                    <Text style={styles.attrKey}>{k.replace(/_/g, ' ')}</Text>
                    <Text style={styles.attrVal}>{String(v)}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{l.description}</Text>
          </View>

          {/* Off-platform safety nudge — fixed, non-dismissible. Paymax connects
              both parties but never holds funds for the deal (Meetup framing). */}
          <View style={[styles.safetyStrip, styles.safetyStripWarn]}>
            <ShieldAlert size={16} color={MarketColors.warnText} />
            <Text style={[styles.safetyText, styles.safetyTextWarn]}>{MEETUP_SAFETY_NUDGE}</Text>
          </View>

          {/* Tertiary: tap-to-reveal Call.
              This used to set a local boolean and relabel itself to "Call seller
              (revealed)" without ever fetching a number — there was nothing in
              the stack to fetch. It now calls POST /listings/:id/contact, which
              is budgeted at 10 distinct listings per hour per viewer and records
              each reveal so a seller can ask who was given their number. */}
          {!unavailable ? (
            <Pressable
              style={styles.callRow}
              disabled={revealing || !!revealedPhone}
              onPress={onRevealPhone}
              accessibilityRole="button"
              accessibilityLabel={revealedPhone ? `Call seller on ${revealedPhone}` : 'Reveal seller phone number'}
            >
              <Phone size={16} color={MarketColors.muted} />
              <Text style={styles.callText}>
                {revealing
                  ? 'Revealing…'
                  : revealedPhone
                    ? `Call ${revealedPhone}`
                    : revealError ?? 'Tap to reveal seller phone'}
              </Text>
              {!revealedPhone && !revealing ? <ChevronRight size={16} color={MarketColors.muted} /> : null}
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky CTA bar — Contact seller opens the Deal Room; Make Offer sends a
          non-binding price proposal. No escrow / checkout in the connect model. */}
      {isOwnListing ? (
        /* Your own listing. The buyer CTAs used to render here regardless, and
           both dead-ended: POST /threads answers 422 CANNOT_MESSAGE_SELF, which
           the deals screen swallowed, leaving you on an empty inbox with nothing
           explaining why. Offer the seller's own actions instead. */
        <View style={styles.ctaBar}>
          <Pressable
            style={styles.offerBtn}
            onPress={() => router.push(`/marketplace/boost/${l.id}` as never)}
            accessibilityLabel="Boost this listing"
          >
            <Text style={styles.offerBtnText}>Boost</Text>
          </Pressable>
          <View style={styles.ctaPrimary}>
            <PrimaryButton
              label="Edit listing"
              onPress={() => router.push(`/marketplace/sell/edit/${l.id}` as never)}
            />
          </View>
        </View>
      ) : !unavailable ? (
        <View style={styles.ctaBar}>
          <Pressable
            style={styles.offerBtn}
            onPress={() => router.push(`/marketplace/deals?listingId=${l.id}&offer=1` as never)}
            accessibilityLabel="Make an offer"
          >
            <Text style={styles.offerBtnText}>Make Offer</Text>
          </Pressable>
          <View style={styles.ctaPrimary}>
            <PrimaryButton
              label="Contact seller"
              onPress={() => router.push(`/marketplace/deals?listingId=${l.id}` as never)}
            />
          </View>
        </View>
      ) : (
        <View style={styles.ctaBar}>
          <View style={styles.ctaPrimary}>
            <PrimaryButton label="See similar listings" variant="secondary" onPress={() => router.push(`/marketplace/results?categoryId=${l.categoryId}` as never)} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  topRow: { paddingHorizontal: Spacing.containerMargin, paddingVertical: Spacing.sm },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.containerMargin, paddingTop: Spacing.md },
  topBarRight: { flexDirection: 'row', gap: Spacing.xs },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', ...shadow1 },
  scroll: { paddingBottom: 120 },
  gallery: { width, height: width * 0.9, backgroundColor: MarketColors.surfaceAlt },
  galleryDimmed: { opacity: 0.55 },
  slide: { width, height: width * 0.9 },
  slidePlaceholder: { width, height: width * 0.9, backgroundColor: MarketColors.surfaceAlt },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotActive: { backgroundColor: '#FFFFFF', width: 16 },
  soldBanner: { position: 'absolute', top: '45%', alignSelf: 'center', backgroundColor: Colors.onSurface, paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full },
  soldBannerText: { ...Typography.labelLg, color: Colors.surface, fontWeight: '800' },
  body: { padding: Spacing.containerMargin, gap: Spacing.xs },
  title: { ...Typography.headlineMd, color: MarketColors.text },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  price: { ...Typography.headlineLg, color: MarketColors.brand },
  fairChip: { backgroundColor: Colors.iconBgTeal, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  fairChipGood: { backgroundColor: Colors.iconBgGreen },
  fairChipWarn: { backgroundColor: MarketColors.warnBg },
  fairChipText: { ...Typography.labelSm, color: Colors.teal, fontWeight: '700' },
  fairChipTextWarn: { color: MarketColors.warnText },
  meta: { ...Typography.bodyMd, color: MarketColors.muted },
  section: { marginTop: Spacing.md, gap: Spacing.sm },
  sectionTitle: { ...Typography.titleMd, color: MarketColors.text },
  attrTable: { backgroundColor: MarketColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: MarketColors.border, overflow: 'hidden' },
  attrRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: MarketColors.border },
  attrKey: { ...Typography.bodyMd, color: MarketColors.muted, textTransform: 'capitalize' },
  attrVal: { ...Typography.bodyMd, color: MarketColors.text, fontWeight: '600' },
  description: { ...Typography.bodyMd, color: MarketColors.text, lineHeight: 22 },
  safetyStrip: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start', backgroundColor: MarketColors.okBg, borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg },
  safetyStripWarn: { backgroundColor: MarketColors.warnBg },
  safetyText: { ...Typography.labelMd, color: MarketColors.text, flex: 1 },
  safetyTextWarn: { color: MarketColors.warnText },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md, paddingVertical: Spacing.sm },
  callText: { ...Typography.labelMd, color: MarketColors.muted, flex: 1 },
  ctaBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: MarketColors.border },
  offerBtn: { height: 52, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: MarketColors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  offerBtnText: { ...Typography.labelLg, color: MarketColors.brand, fontWeight: '700' },
  ctaPrimary: { flex: 1 },
});
