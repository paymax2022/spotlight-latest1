# Paymax Super App (React Native)

## Existing Codebase Findings
- Framework: Expo + React Native + TypeScript + Expo Router
- Routing: file-based Expo Router routes
- State: Zustand stores (light usage before refactor)
- API pattern: Axios client with basic base URL
- Theme: tokenized Paymax colors/spacing/radius/typography/shadows already present
- Reusable components: foundational UI set existed, now extended with business components
- Auth/KYC/payment orchestration: mostly placeholder before this migration

## What Was Implemented
- Super app module architecture with clean feature boundaries
- Shared auth/session/permission layers
- Shared payment orchestration + commission engine
- Shared API endpoint groups and interceptor wiring
- Module registry and role/permission constants
- 20 first-phase production-ready module/home/payment screens
- Documentation for architecture, modules, payment flow, migration

## Run
```bash
cd mobile-app/reactnative
npm install
npx expo start
```

## Core Routes (Phase 1)
- `/super-app-home`
- `/services-hub`
- `/wallet-home`
- `/add-money`
- `/send-money`
- `/payment-review`
- `/payment-receipt`
- `/kyc-overview`
- `/merchant-onboarding`
- `/utility-bills-home`
- `/restaurant-home`
- `/transportation-home`
- `/fx-home`
- `/voting-home`
- `/estate-home`
- `/groups-home`
- `/schools-home`
- `/property-home`
- `/crowdfunding-home`
- `/events-home`
- `/utility-bills-pay`
- `/events-ticket-checkout`
- `/voting-package-select`
- `/schools-fee-checkout`
- `/crowdfunding-donate`
- `/transport-payment-checkout`
