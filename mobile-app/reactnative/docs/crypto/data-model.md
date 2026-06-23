# Data Model

## Entities (field lists)

**User:** id · firstName · lastName · email · phone · country · residencyCountry · dateOfBirth · status · kycTier · investmentEnabled · cryptoEnabled · stockEnabled · createdAt · updatedAt

**InvestmentAccount:** id · userId · accountNumber · status · brokerProvider · brokerAccountId · cryptoProvider · custodyAccountId · riskProfileId · baseCurrency · createdAt · updatedAt

**KYCProfile:** id · userId · status · tier · provider · providerReference · documentStatus · livenessStatus · addressStatus · sanctionsStatus · pepStatus · rejectionReason · reviewedBy · reviewedAt

**SuitabilityProfile:** id · userId · riskCategory · investmentExperience · cryptoKnowledge · stockKnowledge · lossTolerance · timeHorizon · objective · eligibleProducts · expiresAt · createdAt

**Asset:** id · type · symbol · name · exchange · network · contractAddress · riskRating · status · buyEnabled · sellEnabled · depositEnabled · withdrawalEnabled · minOrderAmount · maxOrderAmount · dailyLimit · monthlyLimit · countryAvailability · kycTierRequired · providerMapping · iconUrl · createdAt · updatedAt

**Order:** id · userId · investmentAccountId · assetId · assetType · side · orderType · amount · quantity · price · limitPrice · currency · fees · status · provider · providerReference · idempotencyKey · failureReason · submittedAt · filledAt · settledAt · createdAt · updatedAt

**CryptoQuote:** id · userId · assetId · side · fiatAmount · cryptoAmount · rate · spread · fee · provider · providerQuoteId · expiresAt · status · createdAt

**Position:** id · userId · investmentAccountId · assetId · quantity · averageCost · marketValue · unrealizedGainLoss · realizedGainLoss · currency · updatedAt

**LedgerEntry:** id · transactionId · debitAccount · creditAccount · amount · currency · fee · type · status · reference · providerReference · createdAt

**Transaction:** id · userId · type · product · amount · currency · status · orderId · walletId · provider · providerReference · createdAt

**Watchlist:** id · userId · name · assets · createdAt · updatedAt

**PriceAlert:** id · userId · assetId · condition · targetPrice · status · triggeredAt · createdAt

**CorporateAction:** id · assetId · type · title · description · recordDate · exDate · paymentDate · status · source · createdAt

**ComplianceCase:** id · userId · type · severity · status · assignedTo · notes · linkedTransactions · createdAt · closedAt

**AdminAuditLog:** id · adminId · action · entityType · entityId · oldValue · newValue · reason · ipAddress · deviceId · createdAt

---

## Status Enums

**Stock Order status:** Draft → PreCheckFailed · AwaitingUserConfirmation · Submitted · AcceptedByProvider · PartiallyFilled · Filled · PendingSettlement · Settled · CancelRequested · Cancelled · Rejected · Failed · ReversalPending · Reversed

**Crypto Transaction status:** QuoteRequested · QuoteExpired · QuoteAccepted · Processing · Filled · PartiallyFilled · Failed · Reversed · WithdrawalPendingReview · WithdrawalApproved · WithdrawalBroadcasting · WithdrawalConfirmed · WithdrawalFailed · DepositDetected · DepositConfirmed · ComplianceHold · ManualReview · Blocked

---

## Wallet / Ledger principles
Ledger-based architecture. **Never** rely on provider balances alone — every movement creates double-entry records. Each ledger entry: debit account · credit account · amount · currency · fee · provider reference · userId · product type · transaction type · status · reversal reference (if any) · timestamp · admin action (if any).

Wallet balance views: cash · available-to-invest · pending-settlement · locked · withdrawable · NGN · USD (where supported) · stablecoin (where supported). Failed trades **must** release locked funds.

**Asset-level controls (admin-set, per crypto asset):** symbol · name · network · contractAddress · riskRating · liquidityProvider · custodyProvider · trading/deposit/withdrawal/sell/buy enabled flags · min/max order · daily/monthly limit · spread · fee · user-tier eligibility · country eligibility · risk disclosure · icon · status.

**Crypto quote must include:** quoteId · asset · fiatCurrency · cryptoQuantity · rate · spread · paymaxFee · providerFee · networkFee (if any) · expiryTimestamp · providerReference · liquidityProvider · custodyProvider · riskScore · userConfirmationId.
