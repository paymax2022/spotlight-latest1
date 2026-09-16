// ── Association — Membership card sharing ─────────────────────────────────────
// The card screen's Share button used to open an Alert saying sharing was "not
// available in this preview build" — and on react-native-web a single-button
// Alert.alert is a silent no-op (see the module CLAUDE.md), so on the web build
// the button did visibly nothing at all.

import { Share } from 'react-native';
import type { MembershipCard } from '../types/association.types';

/**
 * Build the text shared for a membership card.
 *
 * DELIBERATELY OMITS card.qrPayload. That token is what /association/verify-card
 * accepts to confirm a membership, so anyone holding it can pass verification as
 * this member. Showing the QR to a person in front of you is a bounded
 * disclosure; pasting the token into a chat is not, and it would outlive the
 * conversation. The shared text is a claim of membership — verification stays
 * with the QR, in person.
 */
export function buildCardShareMessage(card: MembershipCard): string {
  const org = card.organisationAcronym
    ? `${card.organisationName} (${card.organisationAcronym})`
    : card.organisationName;

  const lines = [
    `${card.fullName} — ${org}`,
    `Member ID: ${card.memberId}`,
    `Category: ${card.categoryLabel}`,
  ];
  if (card.chapterName) lines.push(`Chapter: ${card.chapterName}`);
  lines.push(`Status: ${card.status}${card.paymentStanding ? ` · ${card.paymentStanding}` : ''}`);
  if (card.validThrough) {
    // validThrough is nullable and was once formatted unguarded, which printed
    // "Valid thru 1 Jan 1970" for a card with no expiry.
    const d = new Date(card.validThrough);
    if (!Number.isNaN(d.getTime())) {
      lines.push(`Valid through: ${d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    }
  }
  lines.push('', 'Scan the QR code on the card in the Spotlight app to verify this membership.');
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'failed';

/**
 * Share the card, falling back to the clipboard.
 *
 * The fallback is not defensive padding: on the web build React Native's Share
 * maps to navigator.share, which desktop Chrome does not implement, so without
 * it the button would still do nothing on the surface this is most often tested.
 * expo-clipboard is already a dependency and works everywhere.
 */
export async function shareMembershipCard(card: MembershipCard): Promise<ShareOutcome> {
  const message = buildCardShareMessage(card);
  try {
    const res = await Share.share({ message });
    if (res.action === Share.dismissedAction) return 'dismissed';
    return 'shared';
  } catch {
    try {
      const Clipboard = require('expo-clipboard');
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(message);
        return 'copied';
      }
    } catch { /* fall through */ }
    return 'failed';
  }
}
