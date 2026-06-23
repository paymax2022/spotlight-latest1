# Utility Payment PRD & Claude Execution Brief

**File:** `utilitypayment-prd.md`  
**Product:** Spotlight Utility Bills Payment Module  
**Purpose:** This file is written for Claude Code / AI-assisted engineering execution. It converts the PRD into a build-ready implementation brief with architecture rules, modules, data models, APIs, workflows, failover logic, and acceptance criteria.

---

## 0. Claude Execution Instruction

You are implementing the **Spotlight Utility Bills Payment Module**.

Do **not** treat this as a simple bill payment screen. Build it as a **provider-agnostic utility commerce engine** that supports multiple external API providers, smart routing, failover, wallet debit/reservation, reconciliation, profit tracking, receipts, admin controls, and customer support workflows.

Before coding:

1. Inspect the existing repository structure.
2. Identify the backend framework, frontend/mobile framework, admin framework, database, wallet/ledger modules, auth/RBAC system, notification service, and existing transaction patterns.
3. Reuse existing project conventions, naming, validation style, error handling, logging, and database migration style.
4. If a required module does not exist, create it in a clean modular structure.
5. Do not hardcode a single utility API provider anywhere in the UI or business logic.
6. All utility providers must be integrated through adapters.
7. All customer-facing products must come from Spotlight’s unified internal catalogue, not directly from provider product names.
8. All successful transactions must record Spotlight’s gross profit.
9. All pending or ambiguous transactions must be safely re-queried before retrying or refunding.
10. Use idempotency keys for every provider-facing payment attempt.

---

## 1. Product Name

**Spotlight Utility Bills Payment**

---

## 2. Product Vision

Build a reliable, scalable, commission-based utility bills payment system that allows Spotlight users to:

- Buy airtime
- Buy data/internet bundles
- Pay electricity bills
  - Prepaid token purchase
  - Postpaid bill payment
- Pay cable TV subscriptions
- Pay internet service providers

The system must support **multiple API providers per service category**, allowing Spotlight to automatically or manually switch providers when a preferred provider is offline, unreliable, expensive, out of balance, or failing transactions.

Spotlight earns revenue through:

- Provider discounts
- Provider commissions
- Service markups
- Transaction/convenience fees
- Sponsored bundles
- Reseller margins

---

## 3. Core Business Objective

Spotlight is a digital reseller/payment aggregator, not the owner of telecom, electricity, cable, or ISP products.

Business flow:

1. Customer pays Spotlight the retail value of a utility product.
2. Spotlight fulfills the service through a configured API provider.
3. Provider supplies the service at discounted cost or commission.
4. Spotlight retains the margin.

Example:

- Customer buys data worth **₦1,000**
- Provider A gives Spotlight **5% discount**
- Provider cost = **₦950**
- Customer pays = **₦1,000**
- Spotlight gross profit = **₦50**
- Gross margin = **5%**

The system must automatically calculate and store:

- Customer amount
- Provider cost
- Provider discount/commission
- Convenience fee
- Spotlight gross profit
- Provider used
- Service category
- Product/biller
- Transaction date

---

## 4. Core Product Principle

> **One customer experience. Multiple providers behind the scenes. Smart routing. Reliable fulfillment. Clear profit tracking.**

The customer should not know or care which provider handled the payment. Spotlight must present a clean, consistent bill payment experience while the backend handles provider routing and failover.

---

## 5. In Scope

The MVP and core platform must support:

1. Airtime purchase
2. Data bundle purchase
3. Internet service payment
4. Electricity prepaid token purchase
5. Electricity postpaid payment
6. Cable TV subscription payment
7. Provider management
8. Product catalogue management
9. Provider product mapping
10. Dynamic pricing and commission engine
11. Provider routing and failover
12. Transaction lifecycle tracking
13. Wallet debit/reservation/reversal
14. Receipt generation
15. Electricity token handling
16. Customer support dispute workflow
17. Admin reporting
18. Provider reconciliation
19. Profit reporting
20. Status re-query workers

---

## 6. Out of Scope for MVP

Implement later unless already available in the codebase:

- Loan-based bill payment
- Scheduled recurring bill payment
- Family/group utility management
- Bill splitting
- Offline POS/agent network
- AI recommendation engine
- Cashback engine
- Loyalty points
- Utility bill credit scoring
- BNPL for bills

---

## 7. Target Users

### 7.1 Customer

A registered Spotlight user who can:

- Buy airtime
- Buy data
- Pay internet bills
- Pay electricity bills
- Pay cable TV subscriptions
- Save beneficiaries
- View transaction history
- Download/share receipts
- Report failed transactions

### 7.2 Admin

A Spotlight admin who can:

- Add/edit/disable API providers
- Configure provider category support
- Configure preferred/backup providers
- Manage billers and products
- Set commission and margin rules
- View provider health
- Monitor transactions
- Retry/re-query failed or pending payments
- Initiate reversals where allowed
- View profitability reports

### 7.3 Finance

Finance users can:

- View provider balances
- Track provider settlement
- Export transaction reports
- Monitor provider cost and profit
- Reconcile provider statements
- Track unresolved reversals/disputes

### 7.4 Customer Support

Support agents can:

- Search utility transactions
- View lifecycle/status
- See provider response payload summaries
- Trigger status re-query
- Confirm token/value delivery
- Escalate to provider
- Open/close dispute tickets

### 7.5 API Provider

Third-party external service provider that may support one or more categories:

- Airtime
- Data
- Electricity
- Cable TV
- Internet
- All services

---

## 8. Supported Utility Categories

### 8.1 Airtime

Networks:

- MTN
- Airtel
- Glo
- 9mobile

Inputs:

- Phone number
- Network
- Amount
- Payment source

Validations:

- Phone number format
- Minimum amount
- Maximum amount
- Network detection where available
- Wallet balance

### 8.2 Data Bundles

Networks:

- MTN
- Airtel
- Glo
- 9mobile

Product types:

- Daily bundles
- Weekly bundles
- Monthly bundles
- SME data
- Corporate gifting data
- Social bundles
- Promo bundles

Important requirement:

Customers see a unified product catalogue such as:

```text
MTN 1GB - 30 Days - ₦1,000
```

Backend maps it to provider-specific codes:

```text
Provider A: MTN_1GB_30DAYS
Provider B: mtn-1gb-monthly
Provider C: MTN-DATA-1024-30
```

### 8.3 Internet Service

Possible billers:

- Spectranet
- Smile
- Swift
- IPNX
- Tizeti
- Starlink, where available
- Other local ISPs

Inputs vary by biller:

- Customer ID
- Account number
- Phone number
- Device/smartcard ID
- Package
- Amount

Requirement:

Build dynamic biller fields. Do not assume all internet billers use the same identifier.

### 8.4 Electricity

Payment types:

- Prepaid meter token
- Postpaid bill

DISCOs:

- Ikeja Electric
- Eko Electric
- Abuja Electricity
- Ibadan Electricity
- Benin Electricity
- Enugu Electricity
- Jos Electricity
- Kano Electricity
- Kaduna Electricity
- Port Harcourt Electricity
- Yola Electricity

Inputs:

- Disco
- Meter/account number
- Payment type
- Amount
- Customer phone/email
- Payment source

Validation response should include where available:

- Customer name
- Address
- Meter number
- Meter type
- Disco
- Minimum payable amount
- Outstanding balance

Prepaid success must return:

- Token
- Units
- Amount paid
- Customer name
- Meter number
- Receipt number
- Tariff details where available

Postpaid success must return:

- Payment confirmation
- Account number
- Customer name
- Amount paid
- Receipt number

### 8.5 Cable TV

Supported providers:

- DStv
- GOtv
- StarTimes
- Others as needed

Inputs:

- Provider
- Smartcard/IUC number
- Bouquet/package
- Payment option
- Customer phone/email
- Payment source

Validation response should include:

- Customer name
- Smartcard/IUC number
- Current bouquet
- Due date where available
- Available packages
- Amount payable

Actions:

- Renew current package
- Change package
- Add-on package, future
- Event/box-office payment, future

---

## 9. Architecture Requirement

Build around a **Provider-Agnostic Billing Engine**.

Frontend/mobile/admin should call Spotlight internal APIs only:

```text
GET    /utility/categories
GET    /utility/billers
GET    /utility/products
POST   /utility/validate
POST   /utility/pay
GET    /utility/transactions/:id/status
GET    /utility/transactions/:id/receipt
POST   /utility/transactions/:id/requery
POST   /utility/transactions/:id/dispute
```

The frontend must never call external utility providers directly.

Behind the scenes:

```text
Customer App
→ Utility Billing API
→ Validation Engine
→ Wallet/Ledger Service
→ Provider Routing Engine
→ Provider Adapter Layer
→ External Provider API
→ Status Processor
→ Notification Service
→ Receipt/History
→ Reporting/Reconciliation
```

---

## 10. Provider Adapter Pattern

Every provider must be implemented through a standard adapter interface.

### Required adapter interface

Use equivalent structure in the project language:

```ts
interface UtilityProviderAdapter {
  providerCode: string;

  healthCheck(): Promise<ProviderHealthResult>;

  getBalance?(): Promise<ProviderBalanceResult>;

  getProducts?(category?: UtilityCategory): Promise<ProviderProduct[]>;

  validateCustomer(
    request: UtilityValidationRequest
  ): Promise<UtilityValidationResult>;

  purchase(
    request: UtilityPurchaseRequest
  ): Promise<UtilityPurchaseResult>;

  queryTransactionStatus(
    request: UtilityStatusQueryRequest
  ): Promise<UtilityStatusResult>;

  reverseTransaction?(
    request: UtilityReverseRequest
  ): Promise<UtilityReverseResult>;
}
```

### Adapter rules

- Each provider adapter must translate Spotlight’s internal request format into the provider’s API format.
- Each adapter must normalize provider responses back into Spotlight’s standard response format.
- Provider credentials must never be hardcoded.
- Provider credentials must be encrypted in storage and loaded from secure config.
- Provider-specific product codes must be mapped in database, not hardcoded in business logic.

---

## 11. Provider Routing and Failover

### 11.1 Provider types

A provider can be:

- `PRIMARY`
- `SECONDARY`
- `TERTIARY`
- `MANUAL_ONLY`
- `DISABLED`

### 11.2 Routing levels

Routing must support:

1. Category-level routing  
   Example: all electricity via Provider A

2. Biller-level routing  
   Example: Ikeja Electric via Provider A, Eko Electric via Provider B

3. Product-level routing  
   Example: MTN 1GB via Provider A, MTN 5GB via Provider B

4. Amount-based routing  
   Example: airtime below ₦1,000 via Provider A, above ₦1,000 via Provider B

5. Margin-based routing  
   Choose provider with best margin if healthy.

6. Availability-based routing  
   Choose provider with healthy status and acceptable latency.

### 11.3 Provider selection algorithm

When selecting a provider, check:

1. Provider is enabled.
2. Provider supports the category.
3. Provider supports the biller/product.
4. Provider has sufficient balance where balance is required.
5. Provider health is good.
6. Provider success rate is above configured threshold.
7. Provider latency is below threshold.
8. Provider margin is acceptable.
9. Provider transaction limits are not exceeded.
10. Admin has not overridden routing.

### 11.4 Failover rules

Failover can happen when:

- Provider API unreachable
- Timeout
- Provider returns system error
- Provider service unavailable
- Provider balance insufficient
- Provider success rate below threshold
- Provider manually placed in maintenance
- Provider fails health check

Failover must **not** happen blindly when:

- Provider status is unknown/pending
- Customer has already been debited and delivery may still happen
- Electricity prepaid token may still be generated
- Cable activation may still complete
- Customer details are invalid
- Customer wallet balance is insufficient

### 11.5 Failure classification

#### Hard failure

Provider clearly says transaction failed.

Action:

- Try backup provider if safe.
- Or reverse wallet/reservation and ask customer to retry.

#### Soft failure

Timeout, pending, or unknown response.

Action:

- Do not immediately retry with another provider.
- Mark as `PENDING_PROVIDER_CONFIRMATION`.
- Run scheduled status re-query.
- Retry/refund only after timeout policy confirms no value was delivered.

#### Business failure

Invalid meter, invalid smartcard, invalid package, invalid phone.

Action:

- Do not failover.
- Return validation error to customer.

---

## 12. Transaction Lifecycle

Use strict states:

```text
INITIATED
VALIDATION_PENDING
VALIDATED
WALLET_DEBIT_PENDING
WALLET_DEBITED
WALLET_RESERVED
PROVIDER_REQUEST_SENT
PENDING_PROVIDER_CONFIRMATION
SUCCESSFUL
FAILED
REVERSAL_PENDING
REVERSED
MANUAL_REVIEW
DISPUTED
RESOLVED
```

Every state transition must be auditable.

Store:

- Previous status
- New status
- Actor/system
- Timestamp
- Reason
- Provider response summary
- Internal notes where applicable

---

## 13. Wallet and Ledger Flow

### 13.1 Wallet-first model

Default flow:

1. Customer selects service.
2. System validates customer/biller where required.
3. System shows payment summary.
4. Customer confirms payment.
5. Wallet is debited or reserved.
6. Provider request is sent.
7. Provider returns success/failure/pending.
8. Transaction is updated.
9. Customer gets receipt/pending/failed notification.
10. Profit is recorded.

### 13.2 Wallet reservation model

Use for high-risk services:

- Electricity
- Cable TV
- Any provider with frequent pending responses

Reservation flow:

1. Lock/reserve customer amount.
2. Send provider request.
3. If successful, convert reservation to final debit.
4. If failed, release reservation.
5. If pending, keep reservation locked until resolved.

---

## 14. Pricing and Commission Engine

Support:

- Provider discount
- Fixed commission
- Percentage commission
- Customer markup
- Convenience fee
- Promo discount
- Future cashback
- Future agent commission

### 14.1 Example

Customer price = ₦1,000  
Provider discount = 5%  
Provider cost = ₦950  
Spotlight gross profit = ₦50

### 14.2 Formula

```text
provider_cost = customer_amount - provider_discount_value
spotlight_profit = customer_amount + customer_fee - provider_cost - promo_discount
```

### 14.3 Commission configuration levels

Admin can configure by:

- Category
- Provider
- Biller
- Product
- Amount range
- Customer segment
- Promotion period
- Channel
- User type

### 14.4 Profit record per successful transaction

Store:

- Customer amount
- Customer fee
- Total amount paid
- Provider cost
- Provider discount/commission
- Spotlight markup
- Promo discount
- Gross profit
- Net profit if charges exist
- Provider used
- Product sold
- Customer ID
- Timestamp

---

## 15. Data Model Requirements

Adapt naming to existing database conventions.

### 15.1 providers

```sql
provider_id
provider_name
provider_code
status
supported_categories
api_base_url
auth_type
encrypted_credentials
timeout_seconds
priority
health_status
last_health_check_at
success_rate
failure_rate
average_latency_ms
balance
daily_limit
metadata
created_at
updated_at
```

### 15.2 utility_billers

```sql
biller_id
category
biller_name
biller_code
logo_url
country
status
requires_validation
minimum_amount
maximum_amount
dynamic_fields_schema
metadata
created_at
updated_at
```

### 15.3 utility_products

```sql
product_id
category
biller_id
product_name
description
customer_price
validity
data_size
status
display_order
commission_type
commission_value
minimum_amount
maximum_amount
metadata
created_at
updated_at
```

### 15.4 provider_product_mappings

```sql
mapping_id
product_id
provider_id
provider_product_code
provider_product_name
provider_cost
provider_discount
priority
status
last_successful_transaction_at
last_failure_reason
metadata
created_at
updated_at
```

### 15.5 utility_transactions

```sql
transaction_id
customer_id
category
biller_id
product_id
beneficiary_identifier
customer_amount
fee
total_amount
provider_id
provider_cost
spotlight_profit
provider_reference
internal_reference
idempotency_key
status
provider_response_code
provider_response_message
token
units
receipt_data
failure_reason
created_at
updated_at
```

### 15.6 utility_transaction_events

```sql
event_id
transaction_id
previous_status
new_status
event_type
actor_type
actor_id
reason
provider_response_snapshot
created_at
```

### 15.7 saved_utility_beneficiaries

```sql
beneficiary_id
customer_id
category
biller_id
beneficiary_name
identifier
metadata
last_paid_amount
last_transaction_at
created_at
updated_at
```

### 15.8 utility_disputes

```sql
dispute_id
transaction_id
customer_id
issue_type
description
status
support_agent_id
resolution_note
created_at
updated_at
```

---

## 16. API Requirements

Use project conventions for route names, DTOs, auth middleware, validation, and response shape.

### 16.1 Customer APIs

```http
GET /utility/categories
GET /utility/billers?category=electricity
GET /utility/products?category=data&biller=MTN
POST /utility/validate
POST /utility/pay
GET /utility/transactions
GET /utility/transactions/:id
GET /utility/transactions/:id/receipt
POST /utility/transactions/:id/requery
POST /utility/transactions/:id/dispute
GET /utility/beneficiaries
POST /utility/beneficiaries
DELETE /utility/beneficiaries/:id
```

### 16.2 Admin APIs

```http
GET /admin/utility/providers
POST /admin/utility/providers
PATCH /admin/utility/providers/:id
POST /admin/utility/providers/:id/health-check
GET /admin/utility/billers
POST /admin/utility/billers
PATCH /admin/utility/billers/:id
GET /admin/utility/products
POST /admin/utility/products
PATCH /admin/utility/products/:id
POST /admin/utility/products/import
GET /admin/utility/routing-rules
POST /admin/utility/routing-rules
PATCH /admin/utility/routing-rules/:id
GET /admin/utility/transactions
GET /admin/utility/transactions/:id
POST /admin/utility/transactions/:id/requery
POST /admin/utility/transactions/:id/reverse
POST /admin/utility/transactions/:id/resolve
GET /admin/utility/reports/profitability
GET /admin/utility/reports/provider-performance
GET /admin/utility/reports/reconciliation
```

---

## 17. Request/Response Examples

### 17.1 Validate electricity customer

```json
{
  "category": "electricity",
  "billerId": "ikeja-electric",
  "paymentType": "prepaid",
  "identifier": "12345678901",
  "amount": 5000
}
```

Expected normalized response:

```json
{
  "valid": true,
  "customerName": "John Doe",
  "address": "12 Example Street, Lagos",
  "meterNumber": "12345678901",
  "meterType": "prepaid",
  "biller": "Ikeja Electric",
  "minimumAmount": 1000,
  "metadata": {}
}
```

### 17.2 Pay utility

```json
{
  "category": "data",
  "billerId": "mtn",
  "productId": "mtn-1gb-30days",
  "beneficiaryIdentifier": "08031234567",
  "amount": 1000,
  "paymentSource": "wallet",
  "saveBeneficiary": true
}
```

Expected response:

```json
{
  "transactionId": "UTL_123456789",
  "status": "SUCCESSFUL",
  "message": "Data purchase successful",
  "receipt": {
    "amount": 1000,
    "fee": 0,
    "totalAmount": 1000,
    "biller": "MTN",
    "product": "MTN 1GB - 30 Days",
    "beneficiary": "08031234567",
    "date": "2026-01-01T10:00:00Z"
  }
}
```

---

## 18. Electricity Token Rules

For prepaid electricity:

- Show token immediately after success.
- Store token permanently in receipt history.
- Send token by in-app notification and push.
- SMS/email optional if existing notification system supports it.
- Allow customer to retrieve token anytime.
- Do not duplicate purchase while provider status is pending.
- Support/admin must be able to re-query token.
- Admin can manually attach token if later received from provider.

---

## 19. Status Re-query

Implement worker/scheduler for pending transactions.

Recommended schedule:

```text
30 seconds
2 minutes
5 minutes
15 minutes
30 minutes final escalation
```

If still unresolved after final escalation:

- Mark as `MANUAL_REVIEW`
- Notify support/admin
- Keep customer informed

Support/admin manual actions:

- Re-query provider
- Confirm delivery
- Mark failed
- Initiate reversal
- Escalate to provider
- Resolve dispute

---

## 20. Refund and Reversal Rules

Refund automatically only when failure is confirmed.

Refund eligible:

- Provider confirms failed
- Wallet debited but provider request was not sent
- Provider rejected transaction
- Product unavailable before fulfillment
- Admin confirms no value delivered

Not immediately refundable:

- Provider status pending
- Electricity token may still be generated
- Cable subscription may activate later
- Airtime/data may be delayed
- Provider returned ambiguous response

---

## 21. Notifications

Use existing notification infrastructure if available.

Channels:

- In-app
- Push
- Email optional
- SMS optional
- WhatsApp future

Events:

- Payment successful
- Payment pending
- Payment failed
- Refund processed
- Token generated
- Cable activated
- Data successful
- Support ticket updated

---

## 22. Admin Portal Requirements

Admin must manage the utility engine without developer intervention.

### Provider management

Admin can:

- Add provider
- Edit provider
- Enable/disable provider
- Configure category support
- Configure credentials securely
- Set test/live environment
- Set timeout
- Set health endpoint
- Set transaction limits
- View uptime/success/failure
- View balance where available

### Category management

Admin can:

- Enable/disable airtime/data/internet/electricity/cable
- Set category-level commission
- Set availability messages
- Set customer limits

### Biller management

Admin can:

- Add/edit billers
- Enable/disable billers
- Set validation requirements
- Set logo/icon
- Set minimum/maximum amount
- Map billers to providers

### Product management

Admin can:

- Add/edit/import products
- Map products across providers
- Enable/disable products
- Set customer price
- Set provider cost
- Set commission
- Set visibility
- Set promotional pricing

### Transaction monitoring dashboard

Show:

- Total transactions
- Success count
- Failure count
- Pending count
- Reversal count
- Dispute count
- Gross transaction value
- Provider cost
- Gross profit
- Net profit
- Success rate by provider
- Success rate by service
- Provider latency
- Failure reasons
- Most profitable service
- Most used service

---

## 23. Customer UI Requirements

Customer utility home should show:

- Airtime
- Data
- Internet
- Electricity
- Cable TV
- Recent billers
- Saved beneficiaries
- Transaction history
- Promotions

Payment confirmation screen must show:

- Service selected
- Biller/network
- Beneficiary
- Validated customer name where applicable
- Amount
- Fee
- Total payable
- Estimated delivery time
- Wallet/payment method

Receipt must show:

- Spotlight transaction reference
- Provider reference
- Customer name where available
- Category
- Biller/network
- Amount
- Fee
- Total
- Date/time
- Status
- Token for prepaid electricity
- Package name for cable/data
- Support contact/action

---

## 24. Security and Compliance Requirements

Implement:

- Encrypted provider credentials
- Secure provider authentication
- Idempotency keys on all payment attempts
- Duplicate submission prevention
- Sensitive data masking
- Admin audit logs
- RBAC restriction for provider config
- Webhook authenticity validation
- Rate limiting
- IP whitelisting if required by provider
- Structured logging without exposing secrets
- Transaction event trail

---

## 25. Idempotency

Every payment attempt must generate and persist a unique idempotency key.

Example:

```text
UTILITY-{CUSTOMER_ID}-{CATEGORY}-{TIMESTAMP}-{RANDOM}
```

Purpose:

- Prevent duplicate airtime/data
- Prevent duplicate electricity tokens
- Prevent duplicate cable subscriptions
- Prevent double debit
- Allow safe retry after timeout

---

## 26. Reconciliation and Reporting

Reports must include:

### Business reports

- Gross revenue
- Gross transaction value
- Net revenue
- Provider cost
- Commission earned
- Profit by category
- Profit by provider
- Profit by product
- Daily/weekly/monthly sales

### Operational reports

- Success rate by provider
- Failure rate by provider
- Pending transactions
- Average fulfillment time
- Provider downtime
- Reversal count
- Dispute count

### Customer reports

- Repeat customers
- Top customers
- Saved beneficiaries
- Most used billers
- Transaction frequency
- Average spend per user

---

## 27. KPIs

Product KPIs:

- Total transaction value
- Number of successful transactions
- Success rate
- Average completion time
- Repeat usage rate
- Failed transaction rate
- Refund rate
- Dispute rate

Business KPIs:

- Gross profit
- Net profit
- Profit by category
- Profit by provider
- Customer lifetime utility spend
- ARPU
- Commission earned

Technical KPIs:

- Provider uptime
- Provider latency
- API timeout rate
- Re-query success rate
- Failover success rate
- Wallet reversal success rate

---

## 28. MVP Build Plan

### Sprint 1: Foundation

Implement:

- Utility category structure
- Provider model
- Biller model
- Product catalogue model
- Provider product mapping
- Transaction model
- Transaction event model
- Provider adapter interface
- Wallet integration hooks
- Idempotency service

### Sprint 2: Airtime and Data

Implement:

- Airtime purchase flow
- Data purchase flow
- Network billers
- Product mapping
- Provider routing
- Commission calculation
- Receipt generation

### Sprint 3: Electricity

Implement:

- DISCO billers
- Meter validation
- Prepaid token purchase
- Postpaid payment
- Token storage
- Status re-query
- Safe pending workflow

### Sprint 4: Cable TV and Internet

Implement:

- Smartcard validation
- Bouquet/package selection
- Cable subscription payment
- Internet biller support
- Dynamic biller fields

### Sprint 5: Admin and Reconciliation

Implement:

- Provider management UI/API
- Product catalogue management
- Routing rules
- Transaction monitoring
- Profit reports
- Reversal workflow
- Export reports

### Sprint 6: Reliability Optimization

Implement:

- Provider health checks
- Automated failover
- Provider scoring
- Alerts
- Notifications
- Saved beneficiaries
- Customer dispute workflow

---

## 29. Edge Cases to Handle

The system must handle:

- Wrong phone number
- Invalid meter number
- Invalid smartcard
- Provider timeout
- Provider pending response
- Provider debits Spotlight but customer does not receive value
- Wallet debited but provider request fails
- Provider product unavailable
- Provider balance insufficient
- Duplicate transaction attempt
- Network downtime
- DISCO validation unavailable
- Token generated late
- Cable activation delayed
- Customer requests refund after successful value delivery
- Admin disables provider during active transaction

---

## 30. Testing Requirements

Add tests based on project standards.

Minimum tests:

### Unit tests

- Commission calculation
- Provider selection algorithm
- Failover classification
- Transaction state transitions
- Product mapping lookup
- Idempotency handling
- Refund eligibility
- Electricity token handling

### Integration tests

- Successful airtime purchase
- Successful data purchase
- Electricity validation + prepaid token
- Electricity postpaid
- Cable validation + payment
- Provider timeout leading to pending
- Hard failure leading to refund
- Provider failover when primary is down

### Admin tests

- Add provider
- Disable provider
- Add product
- Map provider product
- Configure routing
- Re-query transaction
- Export reports

### Security tests

- Provider credentials are never exposed
- Duplicate payment is blocked
- Unauthorized admin cannot edit provider config
- Webhook signature validation where applicable

---

## 31. Acceptance Criteria

The module is complete when:

1. Customers can buy airtime.
2. Customers can buy data.
3. Customers can pay prepaid electricity and retrieve tokens.
4. Customers can pay postpaid electricity.
5. Customers can pay cable TV.
6. Customers can pay internet/ISP bills where configured.
7. Admin can configure multiple providers.
8. Admin can configure primary and backup providers.
9. System can route to backup provider safely.
10. Product catalogue is internal and provider-agnostic.
11. Provider-specific product codes are mapped, not hardcoded.
12. Wallet debit/reservation/reversal is safe.
13. Duplicate payments are prevented.
14. Profit is recorded per successful transaction.
15. Receipts are generated.
16. Pending transactions are re-queried.
17. Failed transactions are reversed safely.
18. Admin can monitor transactions and provider performance.
19. Finance can export reconciliation/profit reports.
20. A new provider adapter can be added without changing customer UI.
21. System can continue operating when one provider is offline.

---

## 32. Implementation Warnings

Do not:

- Hardcode Provider A as the only provider.
- Build product catalogue directly from one provider response.
- Retry ambiguous electricity transactions without re-query.
- Refund pending transactions too early.
- Store provider credentials in plain text.
- Lose provider reference numbers.
- Mark pending transactions as failed without confirmation.
- Mix wallet ledger records with utility transaction records without traceability.
- Show provider-specific error messages directly to customers if confusing.
- Expose raw provider payloads to customers.

Do:

- Normalize all provider responses.
- Persist raw provider response in secure/admin-only logs where useful.
- Store a transaction event trail.
- Use idempotency.
- Record margins/profit.
- Make admin configurations powerful but auditable.
- Design for future providers from day one.

---

## 33. Final Positioning

Spotlight Utility Bills Payment is a provider-agnostic, commission-driven digital bills engine that lets users pay everyday bills while Spotlight earns sustainable revenue from telecom, electricity, internet, and entertainment subscription services.

Build it to be:

- Reliable
- Profitable
- Configurable
- Auditable
- Provider-flexible
- Reconciliation-ready
- Resilient during provider downtime

Final product principle:

> **One customer experience. Multiple providers behind the scenes. Smart routing. Reliable fulfillment. Clear profit tracking.**

---

## 34. Claude Final Deliverable Checklist

At completion, provide:

1. Summary of implemented modules.
2. Database migrations created.
3. API endpoints created.
4. Admin screens/components created.
5. Customer screens/components created.
6. Provider adapter interface created.
7. Sample/mock provider adapter created.
8. Tests added.
9. Environment variables required.
10. Known limitations.
11. Next recommended sprint.
