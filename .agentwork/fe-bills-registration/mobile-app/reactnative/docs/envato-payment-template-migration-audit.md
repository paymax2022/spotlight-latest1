# Envato Payment Template Migration Audit

Date: 2026-06-14

## Todo List

- [x] Inspect the existing Spotlight React Native app architecture.
- [x] Inspect the Envato banking/payment donor template.
- [x] Compare navigation, dependencies, styling, assets, and state management.
- [x] Identify safe payment UX gaps to implement in the host app first.
- [x] Add host-owned routes for wallet funding, transfers, withdrawals, cards, and FX.
- [x] Replace static education utility demo state with API-backed checkout and confirmation flows.
- [x] Add automated host payment-route smoke coverage.
- [x] Update Playwright/Supabase mocks for education checkout E2E coverage.
- [x] Broaden the refreshed Supabase-aware Playwright harness across all utility checkout specs.
- [x] Apply donor-inspired transaction result polish to Spotlight receipt and transaction-detail screens.
- [ ] Decide which donor visual assets are legally approved for reuse before importing any images.
- [ ] Build deeper card/payment-method management once backend card APIs exist.
- [x] Add automated screen tests after the payment route set stabilizes.

## A. Spotlight App Summary

Framework: Expo SDK 54, React 19, React Native 0.81, TypeScript.

Navigation pattern: Expo Router file-based routes under `app/`, with grouped tabs in `app/(tabs)` and payment utility screens under `app/services`.

Folder structure: reusable UI in `src/components`, tokens in `src/constants`, API clients in `src/api`, domain types in `src/types`, voting feature code in `src/features/voting`, and utility-payment demo data in `src/data/billPayment.ts`.

Design system location: `src/constants/colors.ts`, `spacing.ts`, `typography.ts`, `radius.ts`, `shadows.ts`, plus documented Stitch guidance in `DESIGN.md`.

State management: Zustand for auth/session, TanStack Query for remote server state.

API client: `src/api/client.ts` with domain clients such as wallet, billing, transactions, dashboard, profile, and auth.

Existing payment modules: wallet balance and transactions, utility bill routes for airtime/data/electricity/cable/education, transaction list/detail, receipt, payment method selector, wallet funding API helper, and backend utility APIs in `frontend-web`.

Reusable components: `PrimaryButton`, `TextInputField`, `BalanceCard`, `PaymentScreen`, `PaymentMethodSelector`, `BillReviewSecurityPanel`, `RecentActivityCard`, `ModuleGrid`, `SearchBar`, and shared section/header components.

## B. Envato Template Summary

Framework: bare React Native 0.71, React 18, JavaScript.

Navigation pattern: React Navigation native stack and tabs from `src/navigation`, mounted by the donor `App.tsx`.

Folder structure: `src/screens`, `src/components`, `src/assets`, `src/constants`, `src/store`.

Design approach: standalone template theme, custom text primitives, custom SVG/icon files, local image assets, and Redux tab state.

Main screens: dashboard, payments, mobile payment, top-up payment, fund transfer, card menu/details, transaction details, payment success, payment failed, profile, onboarding, auth, loans, deposits, invoices, exchange rates, FAQ.

Main components: donor button/input/header/loader/text wrappers and custom safe-area/status-bar wrappers.

Assets: card images, banking/payment icons, background images, and custom SVG files.

Useful modules: payment success/failure patterns, fund transfer screen coverage, card/payment-method screen coverage, transaction detail structure, secure confirmation-style layout ideas.

Risky modules: root app, navigation containers, Redux store, donor auth screens, native iOS/Android projects, node_modules, template theme, bundled demo assets, and old dependency versions.

## C. Compatibility Report

Safe-to-use files: donor screen concepts only. Individual layout ideas from `FundTransfer.js`, `MobilePayment.js`, `TopUpPayment.js`, `CardMenu.js`, `CardDetails.js`, `TransactionDetails.js`, `PaymentSuccess.js`, and `PaymentFailed.js` can be reimplemented using Spotlight components.

Files needing refactor: any donor screen promoted into Spotlight must be converted from JavaScript to TypeScript, from React Navigation calls to Expo Router, from donor components to Spotlight components, and from mock data to Spotlight API or clearly labelled placeholder state.

Files to discard: donor `App.tsx`, `index.js`, `src/navigation`, `src/store`, native folders, package lock, node_modules, template auth screens, donor theme wrappers, and unrelated loans/deposits/invoice demo flows.

Dependencies to merge: none immediately. Spotlight already has Expo Router, safe-area, SVG, axios, TanStack Query, Zustand, and lucide icons.

Dependencies to avoid: donor React Native 0.71 stack, React Navigation 6, Redux Toolkit, `react-native-fast-image`, `react-native-linear-gradient`, image-progress packages, phone input, modal, picker, collapsible, and keyboard-aware scroll view unless a future route proves a hard need.

Naming conflicts: generic donor names such as `Button`, `Header`, `InputField`, `Loader`, `Profile`, `Payments`, and `TransactionDetails` conflict with Spotlight conventions and should not be copied directly.

Navigation conflicts: donor React Navigation root conflicts with Spotlight Expo Router. Spotlight remains the only app root.

Theme conflicts: donor theme colors and typography conflict with the Stitch-derived Spotlight tokens. All migrated UI must use `Colors`, `Typography`, `Spacing`, `Radius`, and `shadow*`.

Asset conflicts: donor assets are template-branded and need license confirmation before import. Prefer lucide icons and Spotlight brand assets.

TypeScript/JavaScript mismatches: donor is JavaScript. Host app is TypeScript with path aliases.

Expo compatibility issues: donor native packages and bare-RN assumptions can break Expo SDK 54. Avoid adding donor dependencies until each is validated against Expo.

## D. Migration Plan

Phase 1: Host-safe route coverage. Add missing Spotlight routes for wallet funding, send/transfer placeholder, withdrawal placeholder, cards/payment methods, and FX placeholder using existing components and tokens.

Phase 2: API-backed checkout. Convert bill payment screens from static demo summaries to form state, validation, confirmation, wallet payment, Paystack initiation, success/failure routing, and receipt linking.

Phase 3: Transaction polish. Merge donor-inspired transaction detail/success/failure patterns into the existing Spotlight transaction and receipt routes without changing the API contract. Completed with status summaries, repeat-payment routing, share receipt actions, failed/pending explanations, and education-aware transaction mapping.

Phase 4: Card/payment-method management. Add real saved cards/payment methods once backend endpoints exist. Until then, keep the cards screen explicit about current wallet/Paystack rails.

Phase 5: Asset review. Import only legally approved donor assets that add clear product value; otherwise use Spotlight icons and brand assets.

Phase 6: Validation. Add focused TypeScript checks and route smoke coverage for wallet, services, cards, transfer, and checkout flows.
