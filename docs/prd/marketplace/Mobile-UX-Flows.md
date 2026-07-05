# PAYMAX MARKETPLACE — MOBILE UI/UX & WORKFLOW SPECIFICATION
### Extends Master PRD v4.0 §9 (screen inventory) into full screen-by-screen spec + end-to-end workflows

React Native · existing Paymax design system · ~14 of 34 screens are thin skins over existing components (flagged below as **[reuse]**) · offline-first per existing convention · escrow FSM never resolves to an ambiguous state

---

## 1. Information Architecture

**Entry point:** Marketplace is a tab within the Paymax super-app shell, not a separate app — it inherits the global wallet balance, KYC tier, and notification center.

**Four screen groups, one bottom nav inside the Marketplace tab:**

```
[ Discover ]   [ Sell ]   [ Chat/Deals ]   [ Orders ]   [ Account ]
```

- **Discover** → Discovery group (screens 1–9)
- **Sell** → Sell group (screens 10–17)
- **Chat/Deals** → the messaging half of Transact (18–20, 24)
- **Orders** → the order-lifecycle half of Transact (21–23, 25–27)
- **Account** → Trust & Account group (28–34)

This 5-tab split is deliberate: Jiji and most classifieds apps bury "my orders" and "my listings" inside a generic profile tab, which is exactly why buyers lose track of an in-flight escrow deal. Orders gets its own tab because it's the one place a live money-holding state must never be more than one tap away.

---

## 2. Screen-by-Screen Specification

Format per screen: **Purpose · Entry · Key UI · Primary actions · States · Exit**

### Discovery (9)

**1. Marketplace Home**
- *Purpose:* Zero-effort browsing; surfaces trust and value before search.
- *Entry:* Marketplace tab tap; deep link from push notification (price-drop, new-in-category).
- *Key UI:* Category grid (icon + label, 2 rows scrollable), "Near you" rail (distance-sorted cards), "Price drops" rail, "Escrow-eligible" badge rail — each card shows fair-price chip if applicable.
- *Primary actions:* Tap category → Category Landing; tap card → Listing Detail; pull-to-refresh; tap search bar → Search.
- *States:* Cold load (skeleton cards, not spinner — offline-first means cached last-seen results render instantly, then refresh silently); empty (new user, no location yet) shows category grid only with a location-permission prompt card; error (no network) shows cached content with a subtle "showing saved results" banner, not a blocking error screen.
- *Exit:* Category Landing, Search, Listing Detail, Saved Items.

**2. Search**
- *Purpose:* Fast intent capture.
- *Entry:* Tap search bar from Home or Results.
- *Key UI:* Text field with instant-suggest dropdown (category + query matches), recent searches chips, trending searches chips.
- *Primary actions:* Type → live suggestions; tap suggestion or submit → Results; tap recent chip → re-run.
- *States:* Empty (first-time user) shows trending only, no recents section rendered (not "no recent searches" placeholder — just omit the section).
- *Exit:* Results.

**3. Results**
- *Purpose:* Scan and filter a candidate set fast.
- *Entry:* From Search, Category Landing, or Saved Search alert tap.
- *Key UI:* List/grid toggle, facet bar (price range, condition, verified-seller-only, escrow-eligible-only, delivery available), "Trusted first" sort as default (not "newest first" — deliberate trust-over-recency default), map toggle top-right.
- *Primary actions:* Tap facet → refine in place (no full-screen filter modal for common facets — keep it inline); tap card → Listing Detail; tap map icon → Map View; save search (bell icon) → creates entry in Saved Searches.
- *States:* Loading (skeleton grid); zero results (suggest removing the tightest filter, not a dead end); partial results with a banner ("3 results outside your filters — view them?").
- *Exit:* Listing Detail, Map View, Saved Searches.

**4. Map View**
- *Purpose:* Location-driven browsing (property, vehicles, local services).
- *Entry:* Map toggle from Results.
- *Key UI:* Clustered pins (cluster count badge), bottom sheet showing the currently-visible-in-viewport listings as a horizontal card rail.
- *Primary actions:* Pinch/pan map → card rail updates to match viewport; tap pin/card → Listing Detail.
- *States:* Location permission denied → falls back to city-center default with a permission-request banner, not a blank map.
- *Exit:* Listing Detail, back to Results (list view).

**5. Category Landing**
- *Purpose:* Category-specific browsing with attribute quick filters relevant only to that category (e.g. bedrooms for Property, mileage for Vehicles).
- *Entry:* Tap category tile from Home.
- *Key UI:* Category hero banner, quick-filter chip row (category-specific, config-driven per category schema), sub-category tiles if applicable (e.g. Vehicles → Cars/Motorcycles/Parts).
- *Primary actions:* Tap chip → filtered Results; tap sub-category → nested Category Landing or direct Results.
- *States:* Same skeleton/empty pattern as Home.
- *Exit:* Results.

**6. Listing Detail**
- *Purpose:* The conversion moment — everything needed to trust and act on one listing.
- *Entry:* Any card tap across the app; deep link (shared listing URL); push notification.
- *Key UI:* Photo gallery (BlurHash placeholder while loading, swipeable, pinch-zoom), fair-price chip (below/at/above market, computed server-side), seller trust card (badges — **permanent, never boost-gated**, this is a deliberate correction of Jiji's pay-gated verification badge — response rate, response time, member-since), attribute table (schema-driven per category), description, safety strip (fixed, non-dismissible: "Never pay outside Paymax escrow" for escrow-eligible categories), similar-items rail at the bottom.
- *Primary actions:* Primary CTA = **Buy with Escrow** (if eligible) or **Make Offer**; secondary = **Chat**; tertiary = **Call seller** (revealed only after a short delay/tap-to-reveal, discouraging off-platform deals before any trust signal is exchanged); save (heart icon); report (flag icon, always accessible, never buried).
- *States:* Listing sold/expired shows a clear banner over a dimmed gallery, not a 404; seller-offline indicator on chat CTA.
- *Exit:* Deal Room (via Chat/Make Offer), Escrow Checkout (via Buy with Escrow), Seller Profile (tap seller card).

**7. Seller Profile**
- *Purpose:* Deeper trust verification before a buyer commits.
- *Entry:* Tap seller name/avatar from Listing Detail or Deal Room.
- *Key UI:* Avatar, tenure badge (ungameable — server-computed from account age + verified transaction count, cannot be purchased), verification tier icons, response stats, active listings grid, reviews section (**gated to real completed-order reviewers only** — structurally, a review row cannot exist without a `CONFIRMED`/released order behind it).
- *Primary actions:* Tap listing → Listing Detail; tap "Message" → Deal Room.
- *States:* New seller (no reviews yet) shows "New seller — 0 completed orders" plainly rather than hiding the section, since hiding a review section without a logged reason is a compliance-tracked anti-pattern in this build.
- *Exit:* Listing Detail, Deal Room.

**8. Saved Items**
- *Purpose:* Wishlist / return-later list.
- *Entry:* Heart icon anywhere; Account tab.
- *Key UI:* Grid of saved cards with a "price changed" badge if applicable since saving.
- *Primary actions:* Tap → Listing Detail; swipe to remove.
- *States:* Empty state = an invitation ("Save items you're considering — we'll tell you if the price drops") not just a blank grid.
- *Exit:* Listing Detail.

**9. Saved Searches + instant-alert manager [reuse: notification-preferences pattern]**
- *Purpose:* Passive discovery — let the market come to the buyer.
- *Entry:* Bell icon on Results; Account tab.
- *Key UI:* List of saved search queries, each with a toggle for instant/daily/off alert frequency.
- *Primary actions:* Tap query → Results (re-run); toggle frequency; delete.
- *Exit:* Results.

---

### Sell (8)

**10. Sell entry**
- *Purpose:* Zero-friction listing start.
- *Entry:* Sell tab; global "+" FAB.
- *Key UI:* Camera-first full-screen capture (not a form first) — camera opens immediately, gallery picker as a secondary tap target.
- *Primary actions:* Capture/select photos (up to category max) → Smart Composer.
- *States:* Camera permission denied → gallery-only fallback with a permission-request banner.
- *Exit:* Smart Composer.

**11. Smart Composer**
- *Purpose:* AI-assisted listing creation — this is the highest-leverage screen for conversion (abandoned listings are the #1 supply-side leak in every classifieds app studied).
- *Entry:* From Sell entry with photos attached.
- *Key UI:* Photo strip (reorderable, drag-to-front for cover photo), AI-prefilled category + title + attributes (editable, shown as suggestions the seller confirms rather than a blank form), description field with **real-time client-side validation** (word count, banned-content-pattern check, duplicate-photo warning) — this is a deliberate fix versus Jiji, which only rejects listings hours later at async moderation.
- *Primary actions:* Accept/edit AI suggestions; Next → Attribute form.
- *States:* AI prefill failure (model timeout) degrades gracefully to a blank form, never blocks listing creation.
- *Exit:* Attribute form.

**12. Attribute form**
- *Purpose:* Category-specific structured data capture (schema-driven, not hardcoded per category).
- *Entry:* From Smart Composer.
- *Key UI:* Dynamic form rendered from the category's attribute schema (e.g. Property → bedrooms/bathrooms/title-document-type; Vehicles → make/model/year/mileage/VIN).
- *Primary actions:* Fill required fields → Next.
- *States:* Required-field validation inline, never on-submit-only.
- *Exit:* Price screen.

**13. Price screen**
- *Purpose:* Guide toward a fair, escrow-friendly price.
- *Entry:* From Attribute form.
- *Key UI:* Price input with a live **fair-price band** overlay (computed from comparable active/sold listings), "Escrow-ready" toggle (on by default for eligible categories), delivery options selector (pickup / Paymax logistics / seller-arranged).
- *Primary actions:* Set price → Preview.
- *States:* Price far outside fair-price band shows a non-blocking nudge, not a hard stop (seller's price, seller's call).
- *Exit:* Preview & Publish.

**14. Preview & publish**
- *Purpose:* Final check before going live.
- *Entry:* From Price screen.
- *Key UI:* Full listing preview exactly as buyers will see it (Listing Detail layout).
- *Primary actions:* Edit (back to any prior step); Publish.
- *States:* Publish success shows immediate confirmation with live-in-under-5-minutes messaging for auto-approved categories (a stated SLA target versus Jiji's multi-hour moderation).
- *Exit:* My Listings dashboard.

**15. My Listings dashboard**
- *Purpose:* Seller's command center for all active/past listings.
- *Entry:* Sell tab (if listings exist); post-publish redirect.
- *Key UI:* Status chips (Live / Pending review / Paused / Sold / Expired), per-listing view/save/chat-count stats, quick actions (renew, pause, mark sold).
- *Primary actions:* Tap listing → edit or view; mark sold (prompts: sold via Paymax escrow, or sold elsewhere — feeds review-eligibility logic correctly either way); renew expiring listing.
- *States:* Empty state (no listings yet) → CTA straight into Sell entry.
- *Exit:* Boost purchase, Listing Detail (own listing preview), Sell entry.

**16. Boost purchase**
- *Purpose:* Monetization surface — transparent, wallet-native, no separate "ad credit" system to learn.
- *Entry:* From My Listings dashboard, per-listing "Boost" button.
- *Key UI:* Tiered boost options (duration/placement clearly compared side by side), price shown directly in Naira, wallet balance shown inline at point of decision.
- *Primary actions:* Select tier → Confirm → wallet debit → Boost status.
- *States:* Insufficient wallet balance → direct link to top-up, not a dead-end error.
- *Exit:* Boost status.

**17. Boost status [reuse: existing Paymax transaction-status pattern]**
- *Purpose:* Transparency on an active or rejected boost.
- *Entry:* From My Listings, from a boost-expiry notification.
- *Key UI:* Active boost countdown, performance delta (views since boost vs. baseline), or — if rejected — a **reason-coded rejection with instant automatic refund state**, never a silent decline.
- *Primary actions:* Renew; view listing.
- *Exit:* My Listings dashboard.

---

### Transact (10)

**18. Chat inbox [reuse: existing Paymax messaging shell]**
- *Purpose:* Central hub for all buyer/seller conversations.
- *Entry:* Chat/Deals tab.
- *Key UI:* Conversation list with listing thumbnail context on each row, unread badges, deal-stage chip (e.g. "Offer pending", "Escrow funded") inline per conversation — buyers/sellers shouldn't need to open a chat to know where a deal stands.
- *Primary actions:* Tap conversation → Deal Room.
- *Exit:* Deal Room.

**19. Deal Room**
- *Purpose:* Where negotiation and trust-building happen before money moves — the single most important screen for scam prevention.
- *Entry:* From Chat inbox, from Listing Detail "Chat".
- *Key UI:* Offer bubbles (structured, not free-text — an offer is a first-class object with a price and status, not a chat message that can be misread), counter-offer bottom sheet, **Escrow CTA pinned to the top of the screen** (always visible, never scrolled away), scam-language warning banner (triggered by patterns like "pay outside the app", "send gift card"), a "continue safely" bridge for sellers who want to move to a call/WhatsApp only after this warning has been shown at least once.
- *Primary actions:* Send offer/counter; tap pinned Escrow CTA → Escrow checkout; tap Make Offer sheet.
- *States:* Deal expired/listing sold mid-negotiation → clear banner, conversation archived not deleted.
- *Exit:* Escrow checkout, Make Offer sheet.

**20. Make Offer sheet**
- *Purpose:* Structured offer capture.
- *Entry:* From Listing Detail or Deal Room.
- *Key UI:* Bottom sheet, price input pre-filled at asking price, optional message field.
- *Primary actions:* Submit offer → posts as a structured offer bubble in Deal Room.
- *Exit:* Deal Room.

**21. Escrow checkout**
- *Purpose:* The trust-conversion moment — must feel at least as safe as it structurally is.
- *Entry:* Pinned CTA in Deal Room or Listing Detail direct-buy.
- *Key UI:* Payment method selector (wallet primary, card, bank transfer), full fee breakdown (no hidden fees — itemized: item price, escrow fee, delivery fee), a plain-language "hold explainer" (what happens to the money, when it's released, what happens if something goes wrong) — not buried in T&Cs.
- *Primary actions:* Confirm payment → funds move to escrow hold → Order Tracker.
- *States:* Payment failure → clear reason (insufficient funds, card declined) with a direct retry path, order never created in a half-funded state (this is the release-gate invariant: a debit without a confirmed hold auto-reverses).
- *Exit:* Order Tracker.

**22. Order Tracker**
- *Purpose:* Live visibility into a guarded state machine — this screen IS the escrow FSM made visible to the user.
- *Entry:* From Escrow checkout confirmation; My Orders; order-status push notification.
- *Key UI:* Timeline component: **Funded → Accepted → Rider assigned (live map, if delivery) → Delivered → Inspection countdown → Released**. Each stage has a plain-language description, not just a status label.
- *Primary actions:* Message seller/rider; during Inspection countdown, primary CTA becomes "Inspect & Confirm".
- *States:* Every terminal state is one of exactly four: released, refunded, disputed, or (auto-)cancelled before funding — never an ambiguous "processing" state that persists.
- *Exit:* Inspect & Confirm, Dispute Wizard, Review Composer.

**23. Inspect & Confirm**
- *Purpose:* The buyer's structured confirmation gate — the T+48h auto-release window lives here.
- *Entry:* From Order Tracker once marked Delivered.
- *Key UI:* Countdown timer to auto-release, photo capture of received item, two clear buttons: **Release funds** / **Open dispute**.
- *Primary actions:* Release → order Confirmed, unlocks Review Composer; Dispute → Dispute Wizard.
- *States:* No action taken before countdown expires → auto-releases (matches the Vinted-validated T+48h pattern), buyer notified in advance at T-4h.
- *Exit:* Review Composer, Dispute Wizard.

**24. Dispute Wizard**
- *Purpose:* Structured evidence capture, not a free-text complaint box.
- *Entry:* From Order Tracker or Inspect & Confirm.
- *Key UI:* Reason selector (item not as described, not delivered, damaged, other), evidence upload (photos/video), a set-expectations screen (target resolution window, what happens to the held funds meanwhile — they stay in escrow, never released to either party unilaterally).
- *Primary actions:* Submit → Dispute Status.
- *Exit:* Dispute Status.

**25. Dispute Status**
- *Purpose:* Ongoing transparency during resolution.
- *Entry:* From Dispute Wizard submission; My Orders.
- *Key UI:* Case timeline, evidence submitted by both sides (visible to both — no secret evidence), admin decision when reached.
- *Primary actions:* Add further evidence if requested; accept resolution.
- *Exit:* My Orders (case closed), Review Composer (if resolution results in a completed order).

**26. Review Composer**
- *Purpose:* Trust-signal generation — structurally guaranteed to exist for every completed order, never optional-to-the-point-of-absent.
- *Entry:* Auto-prompted after Release (either manual or auto-release), only after a real completed order.
- *Key UI:* Star rating, structured tags (fast shipping, as described, good communication), optional free-text.
- *Primary actions:* Submit → posts to Seller Profile; skip (allowed, but the prompt reappears once more before expiring, since reviews are the trust backbone of the whole system).
- *Exit:* Order Tracker / My Orders.

**27. Meetup Mode**
- *Purpose:* Safety net for the (permitted) non-escrow path — cash/in-person deals still happen and shouldn't be abandoned to pure risk.
- *Entry:* From Deal Room, for non-escrow-eligible categories or buyer/seller choice.
- *Key UI:* Suggested verified-safe-spot locations (partner locations — police station forecourts, bank branches, well-lit public spots), trip-share toggle (share live location with a trusted contact), check-in timer with an SOS shortcut.
- *Primary actions:* Confirm meetup location/time; start trip-share; check in on arrival.
- *States:* Missed check-in triggers a trusted-contact alert, not a silent timeout.
- *Exit:* Review Composer (self-reported completion, since there's no escrow FSM to confirm it).

---

### Trust & Account (7)

**28. Verification Center [reuse: existing KYC flow shell]**
- *Purpose:* Show and progress verification tier — feeds the trust badge shown everywhere else, and this badge is never boost-gated.
- *Entry:* Account tab; prompted contextually (e.g. before high-value listing publish).
- *Key UI:* Tier progress bar, per-document status, benefits-of-next-tier explainer (higher listing limits, badge upgrade).
- *Primary actions:* Start/continue verification step (reuses existing KYC document capture flow).
- *Exit:* Account tab.

**29. My Orders [reuse: existing Paymax order-history pattern]**
- *Purpose:* All-orders view, both roles.
- *Entry:* Orders tab.
- *Key UI:* Buying/Selling tab toggle, status-filtered list.
- *Primary actions:* Tap order → Order Tracker or Dispute Status depending on state.
- *Exit:* Order Tracker.

**30. Wallet hand-off [reuse: existing Paymax wallet screen, unmodified]**
- *Purpose:* Top-up/withdraw without leaving the marketplace context.
- *Entry:* From Escrow checkout insufficient-balance prompt; Account tab.
- *Exit:* Back to originating screen (Escrow checkout resumes where it left off, doesn't restart).

**31. Report flow**
- *Purpose:* Always-accessible safety valve, never buried.
- *Entry:* Flag icon on Listing Detail, Seller Profile, Chat.
- *Key UI:* Reason selector, evidence upload, optional block-user toggle.
- *Primary actions:* Submit → confirmation with expected review timeframe.
- *Exit:* Originating screen.

**32. Blocked users**
- *Purpose:* User-controlled safety list.
- *Entry:* Account tab.
- *Key UI:* List of blocked accounts, unblock action.
- *Exit:* Account tab.

**33. Notification Preferences**
- *Purpose:* Granular control, avoiding the all-or-nothing notification fatigue that drives app-level opt-outs.
- *Entry:* Account tab.
- *Key UI:* Per-category toggles: new offer, price-drop on saved item, order status change, boost expiry, promotional.
- *Exit:* Account tab.

**34. Help & Support Center**
- *Purpose:* Self-serve resolution before escalating to a human — closes the loop for the Trust & Account group.
- *Entry:* Account tab.
- *Key UI:* Searchable FAQ (escrow explainer, dispute process, fee schedule), "Contact support" entry that pre-attaches context (active order/listing if opened from that context) rather than a blank support form.
- *Primary actions:* Search FAQ; open a support ticket (routes into the existing Paymax support/CRM system).
- *Exit:* Account tab; Dispute Status (if the query is order-specific).

---

## 3. Cross-Cutting End-to-End Workflows

### Workflow A — Discovery to purchase (escrow path)
```
Home/Search → Results → Listing Detail → [Chat or Buy with Escrow]
   → (if Chat) Deal Room → Make Offer → Escrow checkout
   → Order Tracker (Funded → Accepted → Rider assigned → Delivered)
   → Inspect & Confirm → Release → Review Composer
```
**Never-ambiguous rule:** every screen in this chain either advances the FSM or explicitly branches to Dispute Wizard — there is no state where the buyer's money sits without a visible, named status.

### Workflow B — Listing creation
```
Sell entry (camera) → Smart Composer (AI prefill + real-time validation)
   → Attribute form → Price screen (fair-price band) → Preview & Publish
   → My Listings (status: Pending review or Live within 5 min for auto-approved categories)
```
**Leak point this fixes:** Jiji's async-only moderation rejects listings hours after submission with no upfront warning — validation here happens at the Smart Composer step, before the seller has moved on, cutting abandoned/rejected listings sharply.

### Workflow C — Dispute resolution
```
Order Tracker or Inspect & Confirm → Dispute Wizard (reason + evidence)
   → Dispute Status (both parties see all evidence) → admin decision
   → Order Tracker (resolved: refunded/released) or escalation
```
**Guardrail:** funds remain in escrow — untouched by either party — for the entire duration of this workflow. No screen in this chain has a "release to me" shortcut.

### Workflow D — Boost/monetization
```
My Listings → Boost purchase (tiered, wallet-native) → wallet debit
   → Boost status (active countdown OR reason-coded rejection + instant refund)
```
**Guardrail:** a rejected boost always resolves to an automatic refund in the same workflow — never a "contact support for your refund" dead end.

### Workflow E — Non-escrow meetup (cash deals)
```
Deal Room → Meetup Mode (safe-spot suggestion + trip-share + check-in timer)
   → self-reported completion → Review Composer
```
**Explicit tradeoff surfaced to the user:** Meetup Mode screens should always show a one-line comparison nudge ("This deal isn't covered by Escrow buyer protection") so the safety difference is visible in the moment, not just in the terms of service.

### Workflow F — Trust signal accumulation (system-level, spans everything)
```
Verification Center (tier up) → badge shown on Seller Profile + Listing Detail (permanent, never boost-gated)
Completed order → Review Composer (structurally guaranteed) → Seller Profile review count
Both feed → "Trusted first" default sort in Results
```
This is the workflow that has no single screen of its own — it's the reason the other five workflows exist. Every completed, honest transaction should make the next buyer's decision easier, and no seller should be able to buy their way past it.

---

## 4. Global State & Interaction Conventions

- **Loading:** skeleton screens everywhere, never spinners on content areas — offline-first means the last-known-good state should render instantly while a refresh happens silently underneath.
- **Empty states:** always an invitation with a clear next action, never a bare "nothing here."
- **Errors:** plain language, always paired with a next step (retry, top-up, contact support) — never a dead end.
- **Reviews/trust:** never hidden without a logged, dual-visible reason — this is a hard compliance metric in this build, not just a UX nicety.
- **Money states:** every escrow order resolves to exactly one of four terminal states (released, refunded, disputed→resolved, or pre-funding cancelled). No screen should ever be able to show an order stuck in limbo.
- **Offline:** browsing (Discovery group) works fully from cache; anything that writes money or a listing queues and syncs with a visible "pending sync" indicator rather than silently failing.

---

## 5. Reuse vs. Net-New Summary

**Reused wholesale [4]:** Chat inbox shell, Verification Center (KYC flow), My Orders pattern, Wallet hand-off screen.
**Reused pattern, new content [10]:** Notification Preferences, Boost status (transaction-status pattern), Saved Searches (alert-manager pattern), and 7 others across Discovery/Trust that adapt existing Paymax list/card/badge components to marketplace data.
**Net-new [20]:** everything in Sell and Transact that doesn't exist anywhere else in Paymax today — Smart Composer, Deal Room, Escrow checkout, Order Tracker, Dispute Wizard, Meetup Mode, and the rest of the money-and-negotiation surface that is unique to marketplace.

This keeps net-new build surface to the screens that actually carry new product risk (money movement, negotiation, dispute) while the lower-risk surrounding screens (browsing, account settings) ride on infrastructure that's already shipped and battle-tested elsewhere in the app.
