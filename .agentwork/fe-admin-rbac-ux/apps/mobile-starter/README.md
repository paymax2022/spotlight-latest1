# Paymax Mobile Super App Starter (Expo SDK 54)

Production-ready React Native + Expo Router starter implementing a mobile-only Paymax fintech design system.

## What Was Implemented

- Expo SDK 54 + TypeScript + Expo Router + Zustand + React Hook Form + Zod + Axios + SecureStore
- Mobile-only Paymax design tokens (Trust Navy, Corporate Blue, Emerald, Gold)
- Reusable token-driven UI components and domain components
- Super-app tabs: Home, Wallet, Pay, Invest, More
- Auth-ready flow with mock login + protected routes
- Demo screens for confirmation, receipt, virtual card, bills, profile/settings, empty/error/loading states

## Folder Highlights

- `src/theme/*`: colors, spacing, radius, typography, shadows
- `src/components/ui/*`: `AppButton`, `AppInput`, `AppText`, `AppCard`, `AppScreen`, `AppHeader`, `AppLoader`, `AppError`, `AppEmptyState`, `AppBottomSheet`, `AppBadge`, `AppChip`, `AppAvatar`, `AppDivider`
- `src/components/domain/*`: `TransactionRow`, `WalletBalanceCard`, `QuickActionButton`, `AmountInput`, `PinInput`, `SearchInput`, `VirtualCard`, `SecurityBadge`
- `app/(protected)/(tabs)/*`: Home dashboard, Wallet, Pay, Invest, More
- `app/(protected)/demos/*`: confirmation, receipt, virtual-card, bills, profile, settings, empty, error, loading

## Run

```bash
cd apps/mobile-starter
npm install
npm run start
```

## Component Usage Examples

```tsx
import { AppButton } from '@/components/ui/AppButton';
import { WalletBalanceCard } from '@/components/domain/WalletBalanceCard';
import { TransactionRow } from '@/components/domain/TransactionRow';

<AppButton title="Confirm Payment" variant="primary" size="lg" />
<WalletBalanceCard amount={250000.5} />
<TransactionRow
  title="Transfer to Ada"
  amount={50000}
  date="May 15, 09:42"
  status="success"
  direction="debit"
/>
```

## Design System Summary

- Primary trust tone: `#071B3A` (navy)
- Positive financial actions: `#0E9F6E` (emerald)
- Premium accents only: `#D6A84F` (gold)
- Calm neutral surfaces with strong readability and clear spacing hierarchy
- Fintech-safe cards, buttons, inputs, badges, and transaction visual states

## Next Recommended Screens

1. Beneficiary management and recent recipients
2. Full FX conversion flow with rate lock timer
3. Card controls (limits, freeze, channel toggles)
4. Bill categories and provider selection flows
5. Investment product detail + risk profile onboarding
6. Savings goals and recurring debit setup
7. KYC document upload and verification status timeline
8. Security center (2FA, trusted devices, session management)
