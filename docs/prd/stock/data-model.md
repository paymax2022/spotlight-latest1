# Data Model

## Entities (field lists)

**UserInvestmentProfile:** id · userId · kycTier · suitabilityProfileId · investmentEnabled · stockTradingEnabled · publicOfferEnabled · rightsIssueEnabled · riskCategory · country · residencyCountry · status · createdAt · updatedAt

**InvestmentAccount:** id · userId · accountNumber · brokerProviderId · brokerAccountId · cscsNumber · clearingHouseNumber · status · baseCurrency · createdAt · updatedAt

**StockAsset:** id · symbol · name · exchange · sector · board · isin · status · buyEnabled · sellEnabled · riskRating · minimumOrderAmount · maximumOrderAmount · countryAvailability · kycTierRequired · providerSymbol · logoUrl · description · createdAt · updatedAt

**Order:** id · userId · investmentAccountId · stockAssetId · side · orderType · amount · quantity · limitPrice · estimatedPrice · executedPrice · fees · totalAmount · status · provider · providerReference · idempotencyKey · failureReason · submittedAt · filledAt · settledAt · createdAt · updatedAt

**Position:** id · userId · investmentAccountId · stockAssetId · quantity · availableQuantity · lockedQuantity · averageCost · marketValue · unrealizedGainLoss · realizedGainLoss · createdAt · updatedAt

**PortfolioSnapshot:** id · userId · totalValue · cashBalance · investedValue · dailyGainLoss · totalGainLoss · pendingSettlement · createdAt

**LedgerEntry:** id · transactionId · debitAccount · creditAccount · amount · currency · type · status · reference · providerReference · createdAt

**Dividend:** id · stockAssetId · amountPerShare · currency · exDate · recordDate · paymentDate · status · source · createdAt

**CorporateAction:** id · stockAssetId · type · title · description · effectiveDate · recordDate · paymentDate · status · source · createdAt

**PublicOffer:** id · issuerName · symbol · offerPrice · minimumSubscription · openingDate · closingDate · prospectusUrl · status · providerReference · createdAt

**RightsIssue:** id · issuerName · symbol · ratio · offerPrice · qualificationDate · openingDate · closingDate · status · createdAt

**Watchlist:** id · userId · name · stockAssetIds · createdAt · updatedAt

**PriceAlert:** id · userId · stockAssetId · condition · targetPrice · status · triggeredAt · createdAt

**AdminAuditLog:** id · adminId · action · entityType · entityId · oldValue · newValue · reason · ipAddress · createdAt

---

## Status Enums

**Order:** Draft · PendingReview · AwaitingConfirmation · CashLocked · Submitted · Accepted · PartiallyFilled · Filled · PendingSettlement · Settled · CancelRequested · Cancelled · Rejected · Failed · ReversalPending · Reversed · ComplianceHold

**Public Offer:** Upcoming · Open · ClosingSoon · Closed · Processing · AllotmentPending · Allotted · PartiallyAllotted · RefundPending · Completed · Cancelled

**Rights Issue:** Announced · Open · ClosingSoon · Closed · Processing · Accepted · PartiallyAccepted · Lapsed · Completed

---

## Failed-order rules
Failed buy releases locked cash. Failed sell releases locked shares. User must see a reason; admin must see the provider error. Reconciliation flags unmatched status. Duplicate retry prevented by idempotency key.

---

## Investment wallet / ledger
The investment cash wallet is logically separated from the main Paymax wallet. Balances: available cash · invested value · pending orders · pending settlement · locked cash · withdrawable cash · total portfolio value.

**Every movement = double-entry record:** debit account · credit account · amount · currency · fee · reference · provider reference · userId · product · status · created/updated timestamps.

**Wallet transaction types:** investment deposit · investment withdrawal · stock purchase · stock sale · fee debit · fee refund · dividend credit · public-offer subscription · rights-issue payment · reversal · settlement release · manual adjustment (with approval).

**Funding sources:** Paymax main wallet · bank transfer · virtual account · debit card (where allowed) · internal Paymax transfer · group payout wallet (approved) · event earnings · creator earnings · referral reward (where eligible).
**Withdrawal destinations:** verified bank account · Paymax main wallet · approved payout account.

---

## Settlement (first-class, not "filled = done")
Buy: cash locked → submitted → filled → **pending settlement** → settled (shares credited). Sell: shares locked → submitted → filled → cash **pending settlement** → available after settlement (T+N cycle). Admin settlement surface: pending/settled/failed, broker settlement report, user cash release, user share credit, exception queue, settlement calendar.
