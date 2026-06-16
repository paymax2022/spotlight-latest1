# Bills Payment QA Test Data Required

Date: 2026-06-14

The Playwright suite uses mocks for repeatable local coverage. For staging/live QA, provide the following controlled test data.

## Users

- Funded user with at least NGN 150,000 wallet balance.
- Unfunded user with wallet balance below NGN 50.
- User with transaction PIN enabled.
- User configured for wrong-PIN attempts and lockout/cooldown validation.
- User with expired/refreshable session token.

## Identifiers

- Valid Nigerian phone numbers for MTN, Airtel, Glo, and 9mobile.
- Invalid phone numbers for short length, long length, non-numeric, and invalid Nigerian prefix.
- Valid prepaid meter number for each supported DISCO.
- Valid postpaid account/meter number for each supported DISCO.
- Invalid meter/account numbers that return clean validation failures.
- Valid DSTV, GOtv, StarTimes, and Showmax customer identifiers where applicable.
- Invalid smart card/IUC identifiers.

## Provider/Product States

- Provider with available airtime products.
- Provider with no products.
- Provider with expired/unavailable data bundle.
- Product where displayed price differs from confirmation price.
- Provider timeout response.
- Provider pending response.
- Provider success response with prepaid electricity token.
- Provider success response without token.
- Provider failed response before wallet debit.
- Provider failed response after wallet debit requiring reversal.
- Primary provider down with backup provider success.
- Primary and backup provider both down.

## Financial Scenarios

- Exact-balance purchase.
- Insufficient-balance purchase.
- Low-balance purchase.
- High-value purchase near product max.
- Decimal amount handling where supported.
- Wallet ledger entry for debit.
- Wallet ledger entry for reversal/refund.
- Idempotency replay using the same key.

## Environment

- Staging API base URL compatible with the mobile endpoints in `src/api/billing.api.ts`.
- Test provider credentials or sandbox provider enabled.
- Feature flags enabled for utility/bills payments.
- Admin access to inspect provider routing, provider attempts, reversals, and reconciliation reports.
